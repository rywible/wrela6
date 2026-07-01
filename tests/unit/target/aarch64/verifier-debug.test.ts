import { describe, expect, test } from "bun:test";
import { optIrFactId } from "../../../../src/opt-ir/ids";
import { dumpAArch64MachineProgramDeterministically } from "../../../../src/target/aarch64/debug/deterministic-dump";
import { aarch64MachineFactId } from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import { emptyAArch64ProvenanceMap } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import {
  aarch64MachineBlock,
  aarch64MachineBlockId,
  aarch64MachineFunction,
  aarch64MachineFunctionId,
  aarch64MachineProgramId,
  aarch64SymbolId,
} from "../../../../src/target/aarch64";
import { verifyAArch64Abi } from "../../../../src/target/aarch64/verify/abi-verifier";
import { verifyAArch64FactPreservation } from "../../../../src/target/aarch64/verify/fact-preservation-verifier";
import { verifyAArch64Superselection } from "../../../../src/target/aarch64/verify/superselection-verifier";
import { verifyAArch64Tiling } from "../../../../src/target/aarch64/verify/tiling-verifier";
import { makeAArch64MachineVerifierDiagnostic } from "../../../../src/target/aarch64/verify/verifier-suite";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 verifier and debug output", () => {
  test("ABI verifier rejects narrowed external vector clobbers", () => {
    const machineFunction = aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(1),
      symbol: aarch64SymbolId("abi.test"),
      virtualRegisters: [],
      parameters: [],
      returns: [],
      frameObjects: [],
      blocks: [
        aarch64MachineBlock({
          blockId: aarch64MachineBlockId(0),
          frequency: { kind: "entry" },
          instructions: [],
        }),
      ],
      callClobbers: [
        {
          callKey: "call:external",
          registers: { convention: "aapcs64", gpr: ["x0", "x1"], vector: ["v0", "v1"] },
          memoryEffects: [],
        },
      ],
    });

    expect(
      verifyAArch64Abi({
        machineFunction,
        context: verifierContextForTest(),
      }).map((diagnostic) => diagnostic.stableDetail),
    ).toContain("aapcs64-clobber-missing:v16");
  });

  test("fact verifier rejects resurrected dropped facts", () => {
    const preservedFacts = aarch64PreservedFactSet({
      records: [
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(1),
          subject: { kind: "machineFunction", functionId: 1 },
          lineage: { optIrFactIds: [optIrFactId(7)], targetDeclarationKeys: ["target:test"] },
        }),
      ],
      targetDeclarations: ["target:test"],
    });

    expect(
      verifyAArch64FactPreservation({
        preservedFacts,
        preservedOptIrFactIds: [],
        context: verifierContextForTest(),
      }).map((diagnostic) => diagnostic.stableDetail),
    ).toEqual(["resurrected-fact:optIrFact:7"]);
  });

  test("superselection verifier rejects hidden live-outs", () => {
    expect(
      verifyAArch64Superselection({
        candidate: {
          patternId: "semantic.hidden",
          consumedOperations: [1],
          liveOuts: ["unexpected"],
          effects: [],
        },
        manifestLiveOuts: [],
        context: verifierContextForTest(),
      }).map((diagnostic) => diagnostic.stableDetail),
    ).toEqual(["semantic-boundary:hidden-live-out"]);
  });

  test("superselection verifier rejects missing and mismatched consumed operations", () => {
    const missing = verifyAArch64Superselection({
      candidate: {
        patternId: "semantic.checksum-crc32",
        consumedOperations: [99],
        liveOuts: ["crc"],
        effects: [],
        factsUsed: [1],
      },
      manifestLiveOuts: ["crc"],
      context: {
        ...verifierContextForTest(),
        semanticOperationKindsById: { 14: "semanticChecksum" },
      },
    });
    const mismatched = verifyAArch64Superselection({
      candidate: {
        patternId: "semantic.checksum-crc32",
        consumedOperations: [14],
        liveOuts: ["crc"],
        effects: [],
        factsUsed: [1],
      },
      manifestLiveOuts: ["crc"],
      context: { ...verifierContextForTest(), semanticOperationKindsById: { 14: "integerBinary" } },
    });

    expect(missing.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "semantic-boundary:missing-consumed-operation:99",
    ]);
    expect(mismatched.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "semantic-boundary:operation-kind-mismatch:14:integerBinary",
    ]);
  });

  test("tiling verifier rejects forged manifest gates and malformed coverage", () => {
    const diagnostics = verifyAArch64Tiling({
      candidates: [
        {
          patternId: "memory.pair-load-store",
          covers: [10, 10],
          tier: "local",
          cost: 1,
          factsUsed: [],
          emittedOpcodes: [],
        },
      ],
      requiredCoverage: [10],
      context: { ...verifierContextForTest(), targetProfileFeatures: [] },
    }).map((diagnostic) => diagnostic.stableDetail);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        "selection-candidate:tier-mismatch:local:window",
        "selection-candidate:missing-required-facts:footprint,noalias",
        "selection-candidate:missing-profile-feature:BASE_A64",
        "duplicated-consumed-operation:10",
        "overlapping-consumed-operation:10",
        "selection-candidate:missing-emitted-opcodes",
      ]),
    );
  });

  test("superselection verifier rejects forged fact gates and hidden effects", () => {
    const diagnostics = verifyAArch64Superselection({
      candidate: {
        patternId: "semantic.virtio-ring-publish",
        consumedOperations: [7, 7],
        liveOuts: [],
        effects: ["descriptorWrites", "descriptorWrites", "hiddenDma"],
        factsUsed: [],
      },
      manifestLiveOuts: [],
      context: {
        ...verifierContextForTest(),
        semanticOperationKindsById: { 7: "semanticFence" },
        targetProfileFeatures: [],
      },
    }).map((diagnostic) => diagnostic.stableDetail);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        "semantic-boundary:missing-required-facts:memory-order",
        "semantic-boundary:missing-profile-feature:BASE_A64",
        "semantic-boundary:duplicated-consumed-operation:7",
        "semantic-boundary:duplicated-effect",
        "semantic-boundary:hidden-effect",
      ]),
    );
  });

  test("machine IR dump is deterministic", () => {
    const program = programForDumpTest();
    const dump = dumpAArch64MachineProgramDeterministically({ program });
    expect(dumpAArch64MachineProgramDeterministically({ program })).toBe(dump);
    expect(dump).toContain("program 1 target=target:fingerprint");
  });
});

function verifierContextForTest() {
  return {
    program: programForDumpTest(),
    options: {},
    abi: fakeAArch64TargetSurface().abi,
    makeDiagnostic: makeAArch64MachineVerifierDiagnostic,
  };
}

function programForDumpTest() {
  const symbol = aarch64SymbolId("dump.test");
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(1),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol,
        virtualRegisters: [],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [],
          }),
        ],
      }),
    ],
    globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
    entrySymbol: symbol,
    targetFingerprint: "target:fingerprint",
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}

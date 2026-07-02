import { describe, expect, test } from "bun:test";

import { verifyAArch64BackendInputContract } from "../../../../../src/target/aarch64/backend/verify/input-contract-verifier";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64MachineFactId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64AddForTest,
  aarch64CallForTest,
  aarch64IndirectCallForTest,
  aarch64LdrUnsignedImmediateForTest,
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../../../tests/support/target/aarch64/machine-ir/builders";
import {
  backendInputForTest,
  machineProgramForTest,
  staleBackendTargetSurfaceForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend input contract", () => {
  test("rejects stale target fingerprints before backend stages run", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest(),
        target: staleBackendTargetSurfaceForTest(),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale target error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:stale-target:50f07ea064366f24:stale:target",
    ]);
  });

  test("rejects facts without target declaration lineage", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [aarch64MachineFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(1),
              extensionKey: "validated-region-shape",
              subject: { kind: "region", regionKey: "packet" },
              payload: { endian: "big" },
              upstreamVerifierKey: "proof.layout",
              targetDeclarationKeys: [],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing target declaration");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:fact-missing-target-declaration:validated-region-shape:region:packet",
      "input-contract:fact-schema:backend-fact-import:missing-target-declaration:validated-region-shape:region:packet:target.region",
    ]);
  });

  test("rejects facts whose target declarations were not issued by the fact set", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [aarch64MachineFunctionForTest()],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: [],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(7),
              extensionKey: "security.no-spill",
              subject: { kind: "virtualRegister", vreg: 0 },
              payload: { label: "secret" },
              upstreamVerifierKey: "proof.security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected undeclared target declaration");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:fact-undeclared-target-declaration:security.no-spill:vreg:0:target.security",
      "input-contract:fact-schema:backend-fact-import:undeclared-target-declaration:security.no-spill:vreg:0:target.security",
    ]);
  });

  test("rejects fact subjects that do not exist in the machine program", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.security"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(2),
              extensionKey: "security.no-spill",
              subject: { kind: "virtualRegister", vreg: 99 },
              payload: { label: "secret" },
              upstreamVerifierKey: "proof.security",
              targetDeclarationKeys: ["target.security"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected subject index error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:unknown-fact-vreg:vreg:99",
    ]);
  });

  test("rejects ambiguous machine identities even without facts", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [
                aarch64MovzForTest({ instructionId: 1, value: 1n }),
                aarch64AddForTest({ instructionId: 1 }),
              ],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate instruction identity");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:ambiguous-machine-instruction:instruction:1",
    ]);
  });

  test("indexes global symbol fact subjects by symbol id", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [aarch64MachineFunctionForTest()],
          globalSymbols: [
            {
              symbol: aarch64SymbolId("extern.helper"),
              visibility: "external",
            },
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.linkage"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(3),
              extensionKey: "final-linkage-and-visibility",
              subject: { kind: "symbol", symbol: "extern.helper" },
              payload: { kind: "visibility", visibility: "external" },
              upstreamVerifierKey: "closed-image",
              targetDeclarationKeys: ["target.linkage"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("ok");
  });

  test("resolves call-site fact subjects from machine calls", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64CallForTest({ instructionId: 11, callee: "helper" })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.call"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(4),
              extensionKey: "internal-call-eligibility",
              subject: { kind: "callSite", callKey: "call:fixture.function:helper:insn:11" },
              payload: { kind: "closed-image-candidate" },
              upstreamVerifierKey: "proof.closed-image",
              targetDeclarationKeys: ["target.call"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("ok");
  });

  test("resolves indirect call-site fact subjects from machine calls", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64IndirectCallForTest({ instructionId: 12, targetVreg: 0 })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.call"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(5),
              extensionKey: "internal-call-eligibility",
              subject: {
                kind: "callSite",
                callKey: "call:fixture.function:indirect:12:insn:12",
              },
              payload: { kind: "closed-image-candidate" },
              upstreamVerifierKey: "proof.closed-image",
              targetDeclarationKeys: ["target.call"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("ok");
  });

  test("rejects fact subjects that resolve to multiple machine instructions", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              functionId: 1,
              symbol: "first",
              instructions: [aarch64MovzForTest({ instructionId: 42, value: 1n })],
            }),
            aarch64MachineFunctionForTest({
              functionId: 2,
              symbol: "second",
              instructions: [aarch64MovzForTest({ instructionId: 42, value: 2n })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.remat"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(5),
              extensionKey: "rematerialization-authority",
              subject: {
                kind: "machineInstruction",
                instructionId: 42,
              },
              payload: { kind: "constant-remat", value: 1n },
              upstreamVerifierKey: "proof.remat",
              targetDeclarationKeys: ["target.remat"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected ambiguous instruction");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:ambiguous-fact-instruction:instruction:42",
    ]);
  });

  test("rejects fact subjects that resolve to multiple memory operands", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              functionId: 1,
              symbol: "first",
              instructions: [aarch64LdrUnsignedImmediateForTest({ instructionId: 7 })],
            }),
            aarch64MachineFunctionForTest({
              functionId: 2,
              symbol: "second",
              instructions: [aarch64LdrUnsignedImmediateForTest({ instructionId: 7 })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.memory-order"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(6),
              extensionKey: "memory-order-and-region-type",
              subject: { kind: "memoryOperand", instructionId: 7, operandIndex: 1 },
              payload: { region: "packet", order: "acquire", regionType: "device" },
              upstreamVerifierKey: "proof.memory-order",
              targetDeclarationKeys: ["target.memory-order"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected ambiguous memory operand");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:ambiguous-fact-memory-operand:memory:7:1",
    ]);
  });

  test("rejects memory operand fact subjects for non-address operands", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64LdrUnsignedImmediateForTest({ instructionId: 8 })],
            }),
          ],
        }),
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.memory-order"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(7),
              extensionKey: "memory-order-and-region-type",
              subject: { kind: "memoryOperand", instructionId: 8, operandIndex: 0 },
              payload: { region: "packet", order: "acquire", regionType: "device" },
              upstreamVerifierKey: "proof.memory-order",
              targetDeclarationKeys: ["target.memory-order"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected non-address memory operand error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:unknown-fact-memory-operand:memory:8:0",
    ]);
  });

  test("rejects unknown target-declaration fact subjects", () => {
    const result = verifyAArch64BackendInputContract(
      backendInputForTest({
        preservedFacts: aarch64PreservedFactSet({
          targetDeclarations: ["target.linkage"],
          records: [
            aarch64MachineFactRecord({
              factId: aarch64MachineFactId(6),
              extensionKey: "final-linkage-and-visibility",
              subject: { kind: "targetDeclaration", targetDeclarationKey: "target.missing" },
              payload: { kind: "visibility" },
              upstreamVerifierKey: "closed-image",
              targetDeclarationKeys: ["target.linkage"],
            }),
          ],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing target declaration subject");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:fact-schema:backend-fact-import:wrong-subject:final-linkage-and-visibility:targetDeclaration",
      "input-contract:unknown-fact-target-declaration:target-declaration:target.missing",
    ]);
  });
});

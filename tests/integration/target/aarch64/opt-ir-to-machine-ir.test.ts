import { describe, expect, test } from "bun:test";
import { optIrCfgEdgeTable } from "../../../../src/opt-ir/cfg";
import {
  emptyOptIrFactSet,
  optIrFactSetFromRecords,
} from "../../../../src/opt-ir/facts/fact-index";
import { fpNumericFactRecord } from "../../../../src/opt-ir/facts/fp-numeric-facts";
import { memoryOrderFactRecord } from "../../../../src/opt-ir/facts/memory-order-facts";
import { securityFactRecord } from "../../../../src/opt-ir/facts/security-facts";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFactId,
  optIrOperationId,
  optIrRegionId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import {
  aarch64MemoryOrderFactSetForTest,
  aarch64RegionMemoryTypeFactSetForTest,
  aarch64SecurityFactSetForValueForTest,
  aarch64VectorPolicyFactSetForTest,
  aarch64VirtioReleaseFactSetForTest,
} from "../../../support/target/aarch64/facts/opt-ir-facts";
import {
  optimizedOptIrProgramWithAcquireLoadForAArch64Test,
  optimizedOptIrProgramWithEndianDecodeForAArch64Test,
  optimizedOptIrProgramWithEntryParameterForAArch64Test,
  optimizedOptIrProgramWithFpNumericForAArch64Test,
  optimizedOptIrProgramWithJumpArgumentForAArch64Test,
  optimizedOptIrProgramWithNineEntryParametersForAArch64Test,
  optimizedOptIrProgramWithOneFunctionForAArch64Test,
  optimizedOptIrProgramWithOutOfRangeU32ConstantForAArch64Test,
  optimizedOptIrProgramWithPlatformCallForAArch64Test,
  optimizedOptIrProgramWithProofErasedMarkerForAArch64Test,
  optimizedOptIrProgramWithSemanticAtomicForAArch64Test,
  optimizedOptIrProgramWithSourceCallArgumentsForAArch64Test,
  optimizedOptIrProgramWithSourceCallForAArch64Test,
  optimizedOptIrProgramWithValidatedBufferForAArch64Test,
  optimizedOptIrProgramWithVectorReturnSourceCallForAArch64Test,
  optimizedOptIrProgramWithVectorLoadForAArch64Test,
  optimizedOptIrProgramWithVectorStoreForAArch64Test,
  optimizedOptIrProgramWithVectorStackCallArgumentsForAArch64Test,
  optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test,
} from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("OptIR to AArch64 machine IR integration", () => {
  test("one-function optimized OptIR lowers through every production stage without unsupported diagnostics", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: { debugTrace: true, deterministicDump: true },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(result.machineProgram.functions.entries()).toHaveLength(1);
    const machineFunction = result.machineProgram.functions.entries()[0];
    const entryBlock = machineFunction?.blocks[0];
    expect(machineFunction?.virtualRegisters.length).toBeGreaterThan(0);
    expect(
      machineFunction?.schedulePlan.some((entry) => entry.startsWith("dependency-graph:")),
    ).toBe(true);
    expect(machineFunction?.schedulePlan.some((entry) => entry.startsWith("schedule:block:"))).toBe(
      true,
    );
    expect(entryBlock?.instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "movz",
      "movz",
      "add-shifted-register",
      "str-unsigned-immediate",
      "ldr-unsigned-immediate",
      "cmp-shifted-register",
      "cset",
      "add-immediate",
    ]);
    const foldedMemoryInstructions =
      entryBlock?.instructions.filter(
        (instruction) =>
          String(instruction.opcode) === "str-unsigned-immediate" ||
          String(instruction.opcode) === "ldr-unsigned-immediate",
      ) ?? [];
    expect(
      foldedMemoryInstructions.map(
        (instruction) =>
          instruction.operands.find(
            (operand) => operand.role === "use" && operand.operand.kind === "immediate",
          )?.operand,
      ),
    ).toEqual([
      { kind: "immediate", value: 32n },
      { kind: "immediate", value: 32n },
    ]);
    const regionFrame = machineFunction?.frameObjects.find(
      (frameObject) => frameObject.kind === "regionBacked" && frameObject.regionKey === "region:1",
    );
    if (regionFrame === undefined) throw new Error("expected region-backed frame object");
    expect(regionFrame).toEqual(
      expect.objectContaining({
        kind: "regionBacked",
        regionKey: "region:1",
        size: 40,
        alignment: 8,
      }),
    );
    expect(
      foldedMemoryInstructions.map(
        (instruction) =>
          instruction.operands.find((operand) => operand.role === "memoryBase")?.operand,
      ),
    ).toEqual([
      { kind: "frameObject", frameObject: regionFrame?.frameObjectId },
      { kind: "frameObject", frameObject: regionFrame?.frameObjectId },
    ]);
    expect(String(entryBlock?.terminator?.opcode)).toBe("ret");
    expect(machineFunction?.parameters).toEqual([
      { valueKey: "uefi.imageHandle", location: { kind: "intReg", index: 0 } },
      { valueKey: "uefi.systemTable", location: { kind: "intReg", index: 1 } },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.debugOutput?.stageTrace).toContain("build-debug-output");
    expect(result.debugOutput?.deterministicDump).toContain("program 1");
    expect(result.debugOutput?.explanations.length).toBeGreaterThan(0);
    expect(result.provenance.origins.length).toBeGreaterThan(0);
    expect(result.preservedFacts.targetDeclarations).toContain("wrela-uefi-aarch64-rpi5-v1");
    expect(String(result.machineProgram.entrySymbol)).toBe("wrela.image.boot");
    expect(result.machineProgram.globalSymbols.map((symbol) => String(symbol.symbol))).toContain(
      "wrela.image.entry_shim",
    );
  });

  test("referenced OptIR operation ids without definitions are rejected before machine IR leaves the pipeline", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing operation table to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "input-contract:operation-missing:1:1",
    );
  });

  test("entry block parameters are ABI-bound and usable by lowered instructions", () => {
    const fixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    const machineFunction = result.machineProgram.functions.entries()[0];
    expect(machineFunction?.parameters).toEqual([
      { valueKey: "uefi.imageHandle", location: { kind: "intReg", index: 0 } },
      { valueKey: "uefi.systemTable", location: { kind: "intReg", index: 1 } },
      { valueKey: "optir.value:10", location: { kind: "intReg", index: 2 } },
    ]);
    expect(opcodes(result)).toContain("add-shifted-register");
  });

  test("stack-passed entry parameters allocate an incoming argument frame area", () => {
    const fixture = optimizedOptIrProgramWithNineEntryParametersForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    const machineFunction = result.machineProgram.functions.entries()[0];
    expect(machineFunction?.parameters).toContainEqual({
      valueKey: "optir.value:206",
      location: { kind: "stackArg", ordinal: 0, offsetBytes: 0, size: 8, alignment: 8 },
    });
    expect(machineFunction?.frameObjects).toContainEqual(
      expect.objectContaining({ kind: "incomingArg", size: 32, alignment: 16 }),
    );
  });

  test("scalar returns are copied into ABI return placeholders before ret", () => {
    const fixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    const returnCopy = allInstructions(result).find(
      (instruction) =>
        instruction.origin.kind === "syntheticLowering" &&
        instruction.origin.stableKey.includes("abi-return:intReg:0"),
    );
    expect(String(returnCopy?.opcode)).toBe("add-immediate");
    expect(
      String(result.machineProgram.functions.entries()[0]?.blocks[0]?.terminator?.opcode),
    ).toBe("ret");
  });

  test("proof-erased markers are rejected by the operation matrix on the public path", () => {
    const fixture = optimizedOptIrProgramWithProofErasedMarkerForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected proof-erased marker rejection");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
    );
  });

  test("source calls lower to direct symbolic calls with ABI clobbers", () => {
    const fixture = optimizedOptIrProgramWithSourceCallForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(opcodes(result)).toContain("bl");
    expect(opcodes(result)).not.toContain("blr");
    expect(result.machineProgram.globalSymbols.map((symbol) => String(symbol.symbol))).toContain(
      "optir.source.callee",
    );
    expect(result.machineProgram.functions.entries()[0]?.relocationReferences).toEqual([
      expect.objectContaining({ kind: "CALL26", symbol: "optir.source.callee", addend: 0n }),
    ]);
    expect(result.machineProgram.functions.entries()[0]?.callClobbers[0]?.callKey).toBe("call:1");
  });

  test("source calls with vector returns lower through ABI return copies without throwing", () => {
    const fixture = optimizedOptIrProgramWithVectorReturnSourceCallForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector-return call lowering success");
    expect(opcodes(result)).toContain("bl");
    expect(opcodes(result)).toContain("mov-vector");
    expect(result.machineProgram.functions.entries()[0]?.relocationReferences).toEqual([
      expect.objectContaining({ kind: "CALL26", symbol: "optir.source.callee.vector" }),
    ]);
  });

  test("source call arguments are marshalled into register and stack ABI locations", () => {
    const fixture = optimizedOptIrProgramWithSourceCallArgumentsForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected call argument lowering success");
    const loweredOpcodes = opcodes(result);
    expect(loweredOpcodes).toContain("str-unsigned-immediate");
    const call = allInstructions(result).find((instruction) => String(instruction.opcode) === "bl");
    expect(call?.operands.filter((operand) => operand.operand.kind === "vreg")).toHaveLength(8);
    expect(result.machineProgram.functions.entries()[0]?.frameObjects).toContainEqual(
      expect.objectContaining({ kind: "outgoingArgArea", size: 16, alignment: 16 }),
    );
  });

  test("source call vector stack arguments use non-overlapping 16-byte slots", () => {
    const fixture = optimizedOptIrProgramWithVectorStackCallArgumentsForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector stack argument lowering success");
    const stackStores = allInstructions(result).filter(
      (instruction) => String(instruction.opcode) === "st1",
    );
    expect(stackStores).toHaveLength(2);
    expect(
      stackStores.map((instruction) =>
        instruction.operands.find(
          (operand) => operand.role === "use" && operand.operand.kind === "immediate",
        ),
      ),
    ).toEqual([
      expect.objectContaining({ operand: { kind: "immediate", value: 0n } }),
      expect.objectContaining({ operand: { kind: "immediate", value: 16n } }),
    ]);
    expect(result.machineProgram.functions.entries()[0]?.frameObjects).toContainEqual(
      expect.objectContaining({ kind: "outgoingArgArea", size: 32, alignment: 16 }),
    );
  });

  test("platform calls load an authenticated function pointer before blr", () => {
    const fixture = optimizedOptIrProgramWithPlatformCallForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected platform call lowering success");
    const loweredOpcodes = opcodes(result);
    const adrpIndex = loweredOpcodes.indexOf("adrp");
    const pageoffIndex = loweredOpcodes.indexOf("add-pageoff");
    const loadIndex = loweredOpcodes.indexOf("ldr-unsigned-immediate");
    const branchIndex = loweredOpcodes.indexOf("blr");
    expect(adrpIndex).toBeGreaterThanOrEqual(0);
    expect(pageoffIndex).toBeGreaterThan(adrpIndex);
    expect(loadIndex).toBeGreaterThan(pageoffIndex);
    expect(branchIndex).toBeGreaterThan(loadIndex);
  });

  test("semantic atomics require contract address and memory-order facts", () => {
    const fixture = optimizedOptIrProgramWithSemanticAtomicForAArch64Test();
    const relaxed = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "relaxed",
      }),
      target: fakeAArch64TargetSurface(),
    });
    const acquireRelease = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "acquireRelease",
      }),
      target: fakeAArch64TargetSurface(),
    });
    const acquire = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "acquire",
      }),
      target: fakeAArch64TargetSurface(),
    });
    const release = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "release",
      }),
      target: fakeAArch64TargetSurface(),
    });
    const sequentiallyConsistent = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "sequentiallyConsistent",
      }),
      target: fakeAArch64TargetSurface(),
    });
    const missingContract = optimizedOptIrProgramWithSemanticAtomicForAArch64Test({
      semanticContract: { valueSourceIndex: 1, regionMemoryType: "normalCacheable" },
    });
    const missingContractResult = lowerOptIrToAArch64({
      program: missingContract.program,
      operations: missingContract.operations,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(17),
        accessKind: "readModifyWrite",
        order: "acquireRelease",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(relaxed.kind).toBe("ok");
    expect(acquireRelease.kind).toBe("ok");
    expect(acquire.kind).toBe("ok");
    expect(release.kind).toBe("ok");
    expect(sequentiallyConsistent.kind).toBe("ok");
    expect(missingContractResult.kind).toBe("error");
    if (
      relaxed.kind !== "ok" ||
      acquireRelease.kind !== "ok" ||
      acquire.kind !== "ok" ||
      release.kind !== "ok" ||
      sequentiallyConsistent.kind !== "ok"
    ) {
      throw new Error("expected semantic atomic lowering success");
    }
    if (missingContractResult.kind !== "error") {
      throw new Error("expected missing semantic atomic contract to fail");
    }
    expect(opcodes(relaxed)).toContain("ldadd");
    expect(opcodes(acquire)).toContain("ldadda");
    expect(opcodes(release)).toContain("ldaddl");
    expect(opcodes(relaxed)).not.toContain("ldaddal");
    expect(opcodes(acquireRelease)).toContain("ldaddal");
    expect(opcodes(sequentiallyConsistent)).toContain("ldaddal");
    expect(
      allInstructions(acquireRelease)
        .find((instruction) => String(instruction.opcode) === "ldaddal")
        ?.operands.some(
          (operand) =>
            operand.role === "memoryBase" &&
            operand.operand.kind === "vreg" &&
            operand.operand.register.origin?.kind === "synthetic" &&
            operand.operand.register.origin.stableKey.includes("semantic-atomic-address"),
        ),
    ).toBe(false);
    expect(
      missingContractResult.diagnostics.map((diagnostic) => diagnostic.stableDetail),
    ).toContain("semantic-atomic:missing-address-source:17");
  });

  test("security facts propagate to lowered virtual registers and instructions", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64SecurityFactSetForValueForTest({
        valueId: optIrValueId(10),
        labels: ["secret", "noSpill"],
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    const machineFunction = result.machineProgram.functions.entries()[0];
    const secretRegister = machineFunction?.virtualRegisters.find(
      (register) => register.vreg === 10,
    );
    const definingInstruction = allInstructions(result).find((instruction) =>
      instruction.operands.some(
        (operand) => operand.operand.kind === "vreg" && operand.operand.register.vreg === 10,
      ),
    );
    expect(secretRegister?.securityLabels.map((label) => label.kind).sort()).toEqual([
      "noSpill",
      "secret",
    ]);
    expect(definingInstruction?.security?.spillPolicy).toBe("noSpill");
    expect(definingInstruction?.security?.constantTime).toBe(true);
  });

  test("operation-level secret facts reject secret-dependent branches on the public path", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const sourceFunction = fixture.program.functions.entries()[0];
    const entryBlock = sourceFunction?.blocks[0];
    if (sourceFunction === undefined || entryBlock === undefined) {
      throw new Error("expected one-function fixture");
    }
    const branchedProgram = {
      ...fixture.program,
      functions: {
        ...fixture.program.functions,
        entries: () => [
          {
            ...sourceFunction,
            blocks: [
              {
                ...entryBlock,
                terminator: {
                  kind: "branch" as const,
                  operationId: optIrOperationId(199),
                  condition: optIrValueId(14),
                  trueEdge: optIrEdgeId(1),
                  falseEdge: optIrEdgeId(2),
                  originId: entryBlock.originId,
                },
              },
              {
                ...entryBlock,
                blockId: optIrBlockId(2),
                operations: [],
                terminator: {
                  kind: "return" as const,
                  operationId: optIrOperationId(200),
                  values: [optIrValueId(13)],
                  originId: entryBlock.originId,
                },
              },
              {
                ...entryBlock,
                blockId: optIrBlockId(3),
                operations: [],
                terminator: {
                  kind: "return" as const,
                  operationId: optIrOperationId(201),
                  values: [optIrValueId(12)],
                  originId: entryBlock.originId,
                },
              },
            ],
            edges: optIrCfgEdgeTable([
              {
                edgeId: optIrEdgeId(1),
                from: entryBlock.blockId,
                toBlock: optIrBlockId(2),
                ordinal: 0,
                kind: "branchTrue",
                arguments: [],
                originId: entryBlock.originId,
              },
              {
                edgeId: optIrEdgeId(2),
                from: entryBlock.blockId,
                toBlock: optIrBlockId(3),
                ordinal: 1,
                kind: "branchFalse",
                arguments: [],
                originId: entryBlock.originId,
              },
            ]),
          },
        ],
      },
    };
    const result = lowerOptIrToAArch64({
      program: branchedProgram,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        securityFactRecord({
          factId: optIrFactId(33),
          operationId: optIrOperationId(6),
          labels: ["secret", "constantTimeRequired"],
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected secret branch rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "secret-dependent-control:branch",
    );
  });

  test("edge arguments lower to machine block-parameter copies on the public path", () => {
    const fixture = optimizedOptIrProgramWithJumpArgumentForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected edge argument lowering success");
    const machineFunction = result.machineProgram.functions.entries()[0];
    expect(machineFunction?.blocks.some((block) => Number(block.blockId) >= 4_000_000_000)).toBe(
      true,
    );
    expect(opcodes(result)).toContain("add-immediate");
  });

  test("smart endian selection emits width-specific byte swaps on the public path", () => {
    const fixture = optimizedOptIrProgramWithEndianDecodeForAArch64Test(16);
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(opcodes(result)).toContain("rev16");
  });

  test("memory-order facts select acquire loads with machine ordering metadata", () => {
    const fixture = optimizedOptIrProgramWithAcquireLoadForAArch64Test({ byteOffset: 8n });
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(5),
        accessKind: "load",
        order: "acquire",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    const load = allInstructions(result).find(
      (instruction) => String(instruction.opcode) === "ldar",
    );
    expect(load?.memoryOrdering?.order).toBe("acquire");
    expect(load?.operands.map((operand) => operand.role)).toEqual(["def", "memoryBase"]);
    expect(opcodes(result).slice(0, opcodes(result).indexOf("ldar"))).toContain("frame-address");
    expect(result.preservedFacts.records.map((record) => record.subject.kind)).toContain(
      "memoryOperand",
    );
    expect(
      result.preservedFacts.records.some(
        (record) =>
          record.subject.kind === "machineInstruction" &&
          record.lineage.optIrFactIds.map(Number).includes(2),
      ),
    ).toBe(false);
  });

  test("virtio release store emits store-release then barrier through the public path", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: aarch64VirtioReleaseFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(opcodes(result)).toContain("stlr");
    const storeRelease = allInstructions(result).find(
      (instruction) => String(instruction.opcode) === "stlr",
    );
    expect(storeRelease?.operands.map((operand) => operand.role)).toEqual(["use", "memoryBase"]);
    const storeReleaseIndex = opcodes(result).indexOf("stlr");
    expect(opcodes(result).slice(storeReleaseIndex, storeReleaseIndex + 2)).toEqual([
      "stlr",
      "dmb",
    ]);
  });

  test("image-device regions derive device memory type without region memory-type facts", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: aarch64MemoryOrderFactSetForTest({
        operationId: optIrOperationId(9),
        accessKind: "store",
        order: "release",
        publicationShape: "virtioAvailIndexPublication",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected image-device lowering success");
    const storeRelease = allInstructions(result).find(
      (instruction) => String(instruction.opcode) === "stlr",
    );
    expect(storeRelease?.memoryOrdering?.regionMemoryType).toBe("deviceMmio");
    expect(
      storeRelease?.operands.some(
        (operand) => operand.role === "memoryBase" && operand.operand.kind === "frameObject",
      ),
    ).toBe(false);
  });

  test("device publication without required memory-order fact is a public lowering error", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(3),
        memoryType: "deviceMmio",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected lowering error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "memory-order:missing-required-fact:operation:9",
    );
  });

  test("image-device regions reject relaxed fallback when all memory facts are absent", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected image-device ordering error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "memory-order:missing-required-fact:operation:9",
    );
  });

  test("unaligned device memory accesses are rejected on the public path", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test({ alignment: 1 });
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      optimizationRegions: fixture.optimizationRegions,
      facts: aarch64VirtioReleaseFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unaligned device access to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "device-memory-unaligned-access:operation:9:1:8",
    );
  });

  test("validated-buffer memory access remains direct and records zero-copy provenance", () => {
    const fixture = optimizedOptIrProgramWithValidatedBufferForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(4),
        memoryType: "validatedPayload",
        backingRegion: optIrRegionId(1),
        certifiedOffset: 32n,
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(opcodes(result)).toContain("ldr-unsigned-immediate");
    expect(opcodes(result)).not.toContain("blr");
    const memoryInstruction = allInstructions(result).find(
      (instruction) => String(instruction.opcode) === "ldr-unsigned-immediate",
    );
    const memoryBase = memoryInstruction?.operands.find(
      (operand) => operand.role === "memoryBase",
    )?.operand;
    const foldedOffset = memoryInstruction?.operands.find(
      (operand) => operand.role === "use" && operand.operand.kind === "immediate",
    )?.operand;
    const byteOffset = foldedOffset?.kind === "immediate" ? foldedOffset.value : undefined;
    const regionFrame = result.machineProgram.functions
      .entries()[0]
      ?.frameObjects.find(
        (frameObject) =>
          frameObject.kind === "regionBacked" && frameObject.regionKey === "region:1",
      );
    if (regionFrame === undefined) throw new Error("expected backing region frame object");
    expect(regionFrame).toEqual(
      expect.objectContaining({
        kind: "regionBacked",
        regionKey: "region:1",
        size: 56,
        alignment: 8,
      }),
    );
    expect(memoryBase).toEqual({
      kind: "frameObject",
      frameObject: regionFrame?.frameObjectId,
    });
    expect(byteOffset).toBe(48n);
    expect(memoryInstruction?.memoryOrdering?.regionMemoryType).toBe("validatedPayload");
  });

  test("malformed validated-payload region evidence is rejected on the public path", () => {
    const fixture = optimizedOptIrProgramWithValidatedBufferForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(4),
        memoryType: "validatedPayload",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed region evidence to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "validated-payload:missing-backing",
    );
  });

  test("validated-buffer access without backing evidence is rejected on the public path", () => {
    const fixture = optimizedOptIrProgramWithValidatedBufferForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing validated backing to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "validated-payload:missing-backing",
    );
  });

  test("validated-buffer access with only generic region memory facts is rejected", () => {
    const fixture = optimizedOptIrProgramWithValidatedBufferForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(4),
        memoryType: "normalCacheable",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("expected generic memory facts not to satisfy validated backing");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "validated-payload:missing-backing",
    );
  });

  test("device-mmio regions without provenance are rejected on the public path", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(1),
        memoryType: "deviceMmio",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing device provenance to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "device-mmio:missing-provenance",
    );
  });

  test("vector policy controls direct AdvSIMD emission on the public path", () => {
    const fixture = optimizedOptIrProgramWithVectorLoadForAArch64Test();
    const scalarOnly = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "scalarOnly" }),
      target: fakeAArch64TargetSurface(),
    });
    const direct = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" }),
      target: fakeAArch64TargetSurface(),
    });

    expect(scalarOnly.kind).toBe("error");
    expect(direct.kind).toBe("ok");
    if (scalarOnly.kind !== "error" || direct.kind !== "ok")
      throw new Error("expected scalar rejection and direct success");
    expect(scalarOnly.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-helper-lowering-required:8:scalar-helper:load",
    );
    expect(opcodes(direct)).toContain("ld1");
  });

  test("public vector64 memory operations fail closed instead of throwing from opcode construction", () => {
    const loadFixture = optimizedOptIrProgramWithVectorLoadForAArch64Test({ laneCount: 8 });
    const storeFixture = optimizedOptIrProgramWithVectorStoreForAArch64Test({ laneCount: 8 });

    const load = lowerOptIrToAArch64({
      program: loadFixture.program,
      operations: loadFixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" }),
      target: fakeAArch64TargetSurface(),
    });
    const store = lowerOptIrToAArch64({
      program: storeFixture.program,
      operations: storeFixture.operations,
      facts: aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" }),
      target: fakeAArch64TargetSurface(),
    });

    expect(load.kind).toBe("error");
    expect(store.kind).toBe("error");
    if (load.kind !== "error" || store.kind !== "error") {
      throw new Error("expected vector64 memory lowering to fail closed");
    }
    expect(load.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-memory-width:unsupported-direct-access:8:vectorLoad:vector64:ld1",
    );
    expect(store.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-memory-width:unsupported-direct-access:8:vectorStore:vector64:st1",
    );
  });

  test("ordered vector memory operations fail closed instead of constructing scalar acquire forms", () => {
    const fixture = optimizedOptIrProgramWithVectorLoadForAArch64Test();
    const vectorFacts = aarch64VectorPolicyFactSetForTest({ mode: "ownsVectorState" });
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        ...vectorFacts.records,
        memoryOrderFactRecord({
          factId: optIrFactId(70),
          operationId: optIrOperationId(8),
          accessKind: "load",
          order: "acquire",
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected ordered vector memory rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "vector-memory-order:unsupported-ordered-access:8:vectorLoad:acquire",
    );
  });

  test("vector operations without vector-state authorization fail before materialization", () => {
    const fixture = optimizedOptIrProgramWithVectorLoadForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected vector matrix rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "operation-matrix:fact-gated:missing-fact:8:vectorLoad:vector-state",
    );
  });

  test("fpNumeric with integer OptIR values returns a deterministic diagnostic instead of throwing", () => {
    const fixture = optimizedOptIrProgramWithFpNumericForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: optIrFactSetFromRecords([
        fpNumericFactRecord({
          factId: optIrFactId(45),
          operationId: optIrOperationId(45),
          contraction: "allowed",
          rounding: "nearestTiesToEven",
          exceptionFlagsObservable: false,
        }),
      ]),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected fpNumeric lowering to fail closed");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "fp-numeric:register-class-mismatch:45:fmadd:0:expected:fpScalar:actual:gpr64",
    );
  });

  test("u32 constants cannot emit illegal 64-bit move-wide shifts", () => {
    const fixture = optimizedOptIrProgramWithOutOfRangeU32ConstantForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected u32 constant lowering success");
    const emitted = opcodes(result);
    expect(emitted).toContain("movz");
    expect(emitted).not.toContain("movk");
  });
});

function opcodes(result: Extract<ReturnType<typeof lowerOptIrToAArch64>, { readonly kind: "ok" }>) {
  return allInstructions(result).map((instruction) => String(instruction.opcode));
}

function allInstructions(
  result: Extract<ReturnType<typeof lowerOptIrToAArch64>, { readonly kind: "ok" }>,
) {
  return result.machineProgram.functions
    .entries()
    .flatMap((func) =>
      func.blocks.flatMap((block) => [
        ...block.instructions,
        ...(block.terminator === undefined ? [] : [block.terminator]),
      ]),
    );
}

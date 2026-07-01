import { describe, expect, test } from "bun:test";
import { targetId } from "../../../../src/semantic/ids";
import { optIrCfgEdgeTable } from "../../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../../src/opt-ir/constants";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { optIrConstantOperation } from "../../../../src/opt-ir/operations";
import { optIrVectorType } from "../../../../src/opt-ir/vector-types";
import { lowerOptIrToAArch64 as lowerOptIrToAArch64FromTargetRoot } from "../../../../src/target";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineProgramId,
  aarch64SymbolId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import { emptyAArch64ProvenanceMap } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import type { OptIrOperation } from "../../../../src/opt-ir/operations";
import {
  AARCH64_LOWERING_STAGE_KEYS,
  appendAArch64StageTrace,
  buildAArch64LoweringPipelineForTest,
  defaultAArch64LoweringPipeline,
  lowerOptIrToAArch64,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineStage,
} from "../../../../src/target/aarch64";
import { lowerOptIrToAArch64Program } from "../../../../src/target/aarch64/lower/lower-program";
import { aarch64ProductionStage } from "../../../../src/target/aarch64/lower/stage-helpers";
import { verifyMachineIrStage } from "../../../../src/target/aarch64/lower/stages/verify-machine-ir";
import {
  fakeAArch64ProductionProfile,
  fakeAArch64TargetSurface,
} from "../../../support/target/aarch64/target-surface/fakes";
import {
  edgeForTest,
  optIrBlockForTest,
  optIrFunctionForTest,
} from "../../../support/opt-ir/cfg-fakes";

describe("AArch64 public lowering API", () => {
  test("default pipeline mechanically follows the canonical stage keys", () => {
    expect(defaultAArch64LoweringPipeline.map((stage) => stage.stageKey)).toEqual([
      ...AARCH64_LOWERING_STAGE_KEYS,
    ]);
    expect(lowerOptIrToAArch64FromTargetRoot).toBe(lowerOptIrToAArch64);
  });

  test("target authentication runs before machine lowering", () => {
    const result = lowerOptIrToAArch64({
      program: emptyOptimizedOptIrProgramForTest(),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface({
        profile: fakeAArch64ProductionProfile({ architecture: "Armv8.0-A" }),
      }),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "AARCH64_PROFILE_REJECTED",
    ]);
  });

  test("empty programs lower to a verified target-fingerprinted machine program", () => {
    const result = lowerOptIrToAArch64({
      program: emptyOptimizedOptIrProgramForTest(),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected lowering success");
    expect(result.machineProgram.functions.entries()).toEqual([]);
    expect(result.machineProgram.targetFingerprint).toContain("wrela-uefi-aarch64-rpi5-v1");
    expect(result.diagnostics).toEqual([]);
  });

  test("input contract failures return diagnostics instead of throwing", () => {
    const unauthenticatedAuthStage: AArch64LoweringPipelineStage = {
      stageKey: "authenticate-target",
      run(input) {
        return okAArch64LoweringStage(appendAArch64StageTrace(input.state, "authenticate-target"));
      },
    };
    const result = lowerOptIrToAArch64Program({
      program: emptyOptimizedOptIrProgramForTest(),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      pipeline: buildAArch64LoweringPipelineForTest({
        stageOverrides: { "authenticate-target": unauthenticatedAuthStage },
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input contract error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:target-not-authenticated",
    ]);
  });

  test("array operation input rejects duplicate operation ids before map normalization", () => {
    const firstOperation = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(10),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 1n,
      }),
      originId: optIrOriginId(1),
    });
    const duplicateOperation = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(11),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(2),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 2n,
      }),
      originId: optIrOriginId(2),
    });

    const result = lowerOptIrToAArch64({
      program: emptyOptimizedOptIrProgramForTest(),
      operations: [firstOperation, duplicateOperation],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate operation id error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:duplicate-operation-id:1",
    ]);
  });

  test("input contract owns operation table and CFG shape diagnostics", () => {
    const operation = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(10),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 1n,
      }),
      originId: optIrOriginId(1),
    });
    const malformedBlock = optIrBlockForTest({
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [optIrOperationId(1), optIrOperationId(2)],
      originId: optIrOriginId(1),
    });
    const malformedProgram = optIrProgram({
      ...emptyOptimizedOptIrProgramForTest(),
      functions: optIrFunctionTable([
        optIrFunctionForTest({
          blocks: [malformedBlock],
          entryBlock: optIrBlockId(99),
          edges: optIrCfgEdgeTable([
            {
              edgeId: optIrEdgeId(5),
              from: optIrBlockId(1),
              toBlock: optIrBlockId(2),
              ordinal: 0,
              kind: "normal",
              arguments: [optIrValueId(10)],
              originId: optIrOriginId(1),
            },
          ]),
          originId: optIrOriginId(1),
        }),
      ]),
    });
    const mismatchedOperation = { ...operation, operationId: optIrOperationId(7) };
    const result = lowerOptIrToAArch64({
      program: malformedProgram,
      operations: new Map([[optIrOperationId(1), mismatchedOperation]]),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input contract error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "input-contract:cfg-edge-target-missing:1:5:2",
      "input-contract:edge-argument-arity:1:5:1:0",
      "input-contract:entry-block-missing:1:99",
      "input-contract:operation-id-mismatch:1:7",
      "input-contract:operation-missing:1:2",
    ]);
  });

  test("input contract rejects malformed OptIR operation arity before materialization", () => {
    const originId = optIrOriginId(1);
    const operationId = optIrOperationId(1);
    const validConstant = optIrConstantOperation({
      operationId,
      resultId: optIrValueId(10),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 1n,
      }),
      originId,
    });
    const malformedConstant = {
      ...validConstant,
      resultIds: [],
      resultTypes: [],
    } as OptIrOperation;
    const block = optIrBlockForTest({
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [],
        originId,
      },
      originId,
    });
    const program = optIrProgram({
      ...emptyOptimizedOptIrProgramForTest(),
      functions: optIrFunctionTable([
        optIrFunctionForTest({
          blocks: [block],
          entryBlock: block.blockId,
          externalRoot: { reason: "imageEntry", originId },
          originId,
        }),
      ]),
      provenance: { originIds: [originId] },
    });
    const result = lowerOptIrToAArch64({
      program,
      operations: new Map([[operationId, malformedConstant]]),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed operation to fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "input-contract:opt-ir:result-count:constant:0:1",
    );
  });

  test("public lowering accepts legal vector64 constants", () => {
    const originId = optIrOriginId(7);
    const resultId = optIrValueId(70);
    const operationId = optIrOperationId(7);
    const vectorType = optIrVectorType(optIrUnsignedIntegerType(8), 8);
    const vectorConstant = optIrConstantOperation({
      operationId,
      resultId,
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(7),
        type: vectorType,
        normalizedValue: -1n,
      }),
      originId,
    });
    const block = optIrBlockForTest({
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [resultId],
        originId,
      },
      originId,
    });
    const program = optIrProgram({
      ...emptyOptimizedOptIrProgramForTest(),
      functions: optIrFunctionTable([
        optIrFunctionForTest({
          blocks: [block],
          entryBlock: block.blockId,
          externalRoot: { reason: "imageEntry", originId },
          originId,
        }),
      ]),
      provenance: { originIds: [originId] },
    });
    const result = lowerOptIrToAArch64({
      program,
      operations: new Map([[operationId, vectorConstant]]),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected vector64 constant lowering success");
    const movi = result.machineProgram.functions
      .entries()
      .flatMap((func) => func.blocks.flatMap((machineBlock) => machineBlock.instructions))
      .find((instruction) => String(instruction.opcode) === "movi");
    expect(movi?.operands[0]).toEqual(
      expect.objectContaining({
        role: "def",
        operand: expect.objectContaining({
          kind: "vreg",
          register: expect.objectContaining({ registerClass: "vector64" }),
        }),
      }),
    );
    expect(movi?.operands[1]).toEqual(
      expect.objectContaining({ operand: { kind: "immediate", value: BigInt.asUintN(64, -1n) } }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("public lowering accepts entry blocks whose numeric id sorts after successors", () => {
    const originId = optIrOriginId(8);
    const resultId = optIrValueId(80);
    const operationId = optIrOperationId(8);
    const constant = optIrConstantOperation({
      operationId,
      resultId,
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(8),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 42n,
      }),
      originId,
    });
    const returnBlock = optIrBlockForTest({
      blockId: optIrBlockId(0),
      parameters: [],
      operations: [],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(98),
        values: [resultId],
        originId,
      },
      originId,
    });
    const entryBlock = optIrBlockForTest({
      blockId: optIrBlockId(9),
      parameters: [],
      operations: [operationId],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(99),
        edge: optIrEdgeId(9),
        originId,
      },
      originId,
    });
    const program = optIrProgram({
      ...emptyOptimizedOptIrProgramForTest(),
      functions: optIrFunctionTable([
        optIrFunctionForTest({
          blocks: [returnBlock, entryBlock],
          edges: optIrCfgEdgeTable([
            edgeForTest({
              edgeId: optIrEdgeId(9),
              from: entryBlock.blockId,
              toBlock: returnBlock.blockId,
              originId,
            }),
          ]),
          entryBlock: entryBlock.blockId,
          externalRoot: { reason: "imageEntry", originId },
          originId,
        }),
      ]),
      provenance: { originIds: [originId] },
    });

    const result = lowerOptIrToAArch64({
      program,
      operations: new Map([[operationId, constant]]),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected non-sorted entry lowering success");
    expect(result.diagnostics).toEqual([]);
    expect(
      result.machineProgram.functions.entries()[0]?.blocks.map((block) => Number(block.blockId)),
    ).toEqual([0, 9]);
  });

  test("verify-machine-ir stage propagates default-suite verifier diagnostics", () => {
    const injectInvalidMachineIrStage: AArch64LoweringPipelineStage = {
      stageKey: "lower-function-shells",
      run(input) {
        return okAArch64LoweringStage({
          ...appendAArch64StageTrace(input.state, "lower-function-shells"),
          machineProgram: invalidAbiMachineProgramForTest(),
          semanticCandidates: [
            {
              patternId: "semantic.hidden",
              consumedOperations: [1],
              liveOuts: ["unexpected"],
              effects: [],
            },
          ],
          semanticManifestLiveOuts: { "semantic.hidden": [] },
        });
      },
    };
    const result = lowerOptIrToAArch64Program({
      program: emptyOptimizedOptIrProgramForTest(),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      pipeline: [injectInvalidMachineIrStage, verifyMachineIrStage],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected verifier diagnostics");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      expect.arrayContaining([
        "parameter-int-reg-out-of-range:x8",
        "semantic-boundary:hidden-live-out",
      ]),
    );
  });

  test("production stage exceptions return deterministic diagnostics", () => {
    const throwingStage = aarch64ProductionStage({
      stageKey: "plan-pairs-prefetch-barriers-schedule",
      run() {
        throw new RangeError("fixture-incomplete-schedule");
      },
    });
    const result = lowerOptIrToAArch64Program({
      program: emptyOptimizedOptIrProgramForTest(),
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      pipeline: [throwingStage],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected production stage diagnostic");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "stage-exception:plan-pairs-prefetch-barriers-schedule:fixture-incomplete-schedule",
    ]);
  });
});

function emptyOptimizedOptIrProgramForTest() {
  return optIrProgram({
    programId: optIrProgramId(0),
    targetId: targetId("wrela-uefi-aarch64-rpi5-v1"),
    functions: optIrFunctionTable([]),
    regions: optIrRegionTable([]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [] },
  });
}

function invalidAbiMachineProgramForTest() {
  const symbol = aarch64SymbolId("test.invalid");
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(1),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol,
        virtualRegisters: [],
        parameters: [{ valueKey: "arg0", location: { kind: "intReg", index: 8 } }],
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
    targetFingerprint: "target:test",
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}

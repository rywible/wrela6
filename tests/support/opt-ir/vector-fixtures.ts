import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import type { OptIrLoopLoadPackCandidate } from "../../../src/opt-ir/passes/loop-vectorization";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrBranchTerminator } from "../../../src/opt-ir/terminators";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";

export function loopVectorizationCandidateForTest(
  overrides: Partial<OptIrLoopLoadPackCandidate> = {},
): OptIrLoopLoadPackCandidate {
  return {
    loopId: "loop:payload-copy",
    headerBlockId: optIrBlockId(10),
    latchBlockIds: [optIrBlockId(12)],
    bodyBlockIds: [optIrBlockId(10), optIrBlockId(11), optIrBlockId(12)],
    scalarOperationIds: [optIrOperationId(1)],
    nextOperationId: 100,
    nextValueId: 200,
    originId: optIrOriginId(1),
    laneType: optIrUnsignedIntegerType(8),
    lanes: 4,
    tripCount: { kind: "certifiedExact", iterations: 16 },
    tailPlan: { kind: "certifiedMultiple" },
    laneBounds: [{ operationId: optIrOperationId(1), proven: true }],
    memoryAccesses: [
      {
        operationId: optIrOperationId(1),
        kind: "load",
        region: optIrRegionId(1),
        byteOffset: 0n,
        byteWidth: 4,
        vectorByteWidth: 4,
        alignment: 4,
        sourceValueIds: [],
        boundsAuthority: { kind: "targetContract", authorityKey: "loop-vector-load" },
        memoryVersionBefore: 0,
        memoryVersionAfter: 0,
      },
    ],
    memoryIndependenceProven: true,
    effectSafety: {
      safe: true,
      carriedValues: [
        { valueId: optIrValueId(30), kind: "scalarRecurrence" },
        { valueId: optIrValueId(31), kind: "recognizedReduction" },
        { valueId: optIrValueId(32), kind: "preservedRegionToken" },
        { valueId: optIrValueId(33), kind: "preservedEffectToken" },
      ],
      blockedEffects: [],
      vectorPermittedEffects: [],
    },
    targetOperationKinds: ["vectorLoad"],
    estimatedLiveVectorRegisters: 1,
    ...overrides,
  };
}

export function discoveredLoadLoopProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
} {
  const originId = optIrOriginId(10);
  const entry = optIrBlockId(10);
  const header = optIrBlockId(11);
  const body = optIrBlockId(12);
  const exit = optIrBlockId(13);
  const region = optIrRegionId(10);
  const indexType = optIrUnsignedIntegerType(32);
  const laneType = optIrUnsignedIntegerType(8);

  const initConst = optIrConstantOperation({
    operationId: optIrOperationId(10),
    resultId: optIrValueId(100),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(10),
      type: indexType,
      normalizedValue: 0n,
    }),
    originId,
  });
  const boundConst = optIrConstantOperation({
    operationId: optIrOperationId(11),
    resultId: optIrValueId(101),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(11),
      type: indexType,
      normalizedValue: 16n,
    }),
    originId,
  });
  const compare = optIrIntegerCompareOperation({
    operationId: optIrOperationId(12),
    left: optIrValueId(200),
    right: optIrValueId(101),
    operator: "unsignedLessThan",
    resultId: optIrValueId(102),
    originId,
  });
  const stepConst = optIrConstantOperation({
    operationId: optIrOperationId(13),
    resultId: optIrValueId(103),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(12),
      type: indexType,
      normalizedValue: 1n,
    }),
    originId,
  });
  const loadResult = optIrMemoryLoadOperation({
    operationId: optIrOperationId(14),
    resultId: optIrValueId(300),
    region,
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: laneType,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "constructionSize" },
    originId,
  });
  if (loadResult.kind === "error") {
    throw new Error("Expected discovered loop load fixture to be valid.");
  }
  const increment = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(15),
    left: optIrValueId(200),
    right: optIrValueId(103),
    operator: "add",
    resultId: optIrValueId(201),
    resultType: indexType,
    originId,
  });

  const entryToHeader = optIrEdgeId(10);
  const headerTrue = optIrEdgeId(11);
  const headerFalse = optIrEdgeId(12);
  const bodyToHeader = optIrEdgeId(13);
  const function_: OptIrFunction = {
    functionId: optIrFunctionId(10),
    monoInstanceId: monoInstanceId("test::discovered-load-loop"),
    signature: {} as MonoFunctionSignature,
    entryBlock: entry,
    originId,
    blocks: [
      {
        blockId: entry,
        parameters: [],
        operations: [initConst.operationId],
        originId,
      },
      {
        blockId: header,
        parameters: [
          optIrBlockParameter({
            valueId: optIrValueId(200),
            type: indexType,
            incomingRole: "loopCarried",
            originId,
          }),
        ],
        operations: [boundConst.operationId, compare.operationId],
        terminator: optIrBranchTerminator({
          operationId: optIrOperationId(20),
          condition: compare.resultIds[0]!,
          trueEdge: headerTrue,
          falseEdge: headerFalse,
          originId,
        }),
        originId,
      },
      {
        blockId: body,
        parameters: [],
        operations: [
          stepConst.operationId,
          loadResult.operation.operationId,
          increment.operationId,
        ],
        originId,
      },
      {
        blockId: exit,
        parameters: [],
        operations: [],
        terminator: {
          kind: "return",
          operationId: optIrOperationId(21),
          values: [],
          originId,
        },
        originId,
      },
    ],
    edges: optIrCfgEdgeTable([
      {
        edgeId: entryToHeader,
        from: entry,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [initConst.resultIds[0]!],
        originId,
      },
      {
        edgeId: headerTrue,
        from: header,
        toBlock: body,
        ordinal: 0,
        kind: "branchTrue",
        arguments: [],
        originId,
      },
      {
        edgeId: headerFalse,
        from: header,
        toBlock: exit,
        ordinal: 1,
        kind: "branchFalse",
        arguments: [],
        originId,
      },
      {
        edgeId: bodyToHeader,
        from: body,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [increment.resultIds[0]!],
        originId,
      },
    ]),
  };
  const operations = [initConst, boundConst, compare, stepConst, loadResult.operation, increment];

  return {
    program: optIrProgram({
      programId: optIrProgramId(10),
      targetId: targetId("test-target"),
      functions: optIrFunctionTable([function_]),
      regions: optIrRegionTable([{ regionId: region, originId }]),
      constants: { get: () => undefined, has: () => false, entries: () => [] },
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    operations,
  };
}

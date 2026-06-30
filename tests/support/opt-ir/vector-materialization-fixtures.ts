import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrBlockId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

export function eightLoadProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly blockId: ReturnType<typeof optIrBlockId>;
} {
  const laneType = optIrUnsignedIntegerType(8);
  const loadResults = Array.from({ length: 8 }, (_unused, index) => optIrValueId(11 + index));
  const loads = loadResults.map((resultId, index) =>
    requireMemoryLoad({
      operationId: optIrOperationId(index + 1),
      resultId,
      byteOffset: BigInt(index),
      byteWidth: 1,
      valueType: laneType,
    }),
  );
  const blockId = optIrBlockId(2);
  const block: OptIrBlock = {
    blockId,
    parameters: [],
    operations: loads.map((load) => load.operationId),
    terminator: {
      kind: "return",
      operationId: optIrOperationId(199),
      values: loadResults,
      originId: optIrOriginId(2),
    },
    originId: optIrOriginId(2),
  };
  const func = functionForMaterializationTest({ blocks: [block], entryBlock: blockId });
  return {
    program: programForMaterializationTest(func),
    operations: loads,
    blockId,
  };
}

export function adjacentLoadProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly blockId: ReturnType<typeof optIrBlockId>;
  readonly firstLoadResult: ReturnType<typeof optIrValueId>;
  readonly secondLoadResult: ReturnType<typeof optIrValueId>;
} {
  const laneType = optIrUnsignedIntegerType(8);
  const loadResults = [
    optIrValueId(11),
    optIrValueId(12),
    optIrValueId(13),
    optIrValueId(14),
  ] as const;
  const loads = loadResults.map((resultId, index) =>
    requireMemoryLoad({
      operationId: optIrOperationId(index + 1),
      resultId,
      byteOffset: BigInt(index),
      byteWidth: 1,
      valueType: laneType,
    }),
  );
  const blockId = optIrBlockId(1);
  const block: OptIrBlock = {
    blockId,
    parameters: [],
    operations: loads.map((load) => load.operationId),
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [...loadResults],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  const func = functionForMaterializationTest({ blocks: [block], entryBlock: blockId });
  return {
    program: programForMaterializationTest(func),
    operations: loads,
    blockId,
    firstLoadResult: loadResults[0]!,
    secondLoadResult: loadResults[1]!,
  };
}

export function splitBlockAdjacentLoadProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
} {
  const laneType = optIrUnsignedIntegerType(8);
  const firstLoad = requireMemoryLoad({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(11),
    byteOffset: 0n,
    byteWidth: 1,
    valueType: laneType,
  });
  const secondLoad = requireMemoryLoad({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(12),
    byteOffset: 1n,
    byteWidth: 1,
    valueType: laneType,
  });
  const firstBlock: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [firstLoad.operationId],
    originId: optIrOriginId(1),
  };
  const secondBlock: OptIrBlock = {
    blockId: optIrBlockId(2),
    parameters: [],
    operations: [secondLoad.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(11), optIrValueId(12)],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  const func = functionForMaterializationTest({
    blocks: [firstBlock, secondBlock],
    entryBlock: firstBlock.blockId,
  });
  return {
    program: programForMaterializationTest(func),
    operations: [firstLoad, secondLoad],
  };
}

export function interleavedAdjacentLoadProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
} {
  const laneType = optIrUnsignedIntegerType(8);
  const firstLoad = requireMemoryLoad({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(11),
    byteOffset: 0n,
    byteWidth: 1,
    valueType: laneType,
  });
  const separator = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(99),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(2),
      type: laneType,
      normalizedValue: 0n,
    }),
    originId: optIrOriginId(1),
  });
  const secondLoad = requireMemoryLoad({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(12),
    byteOffset: 1n,
    byteWidth: 1,
    valueType: laneType,
  });
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [firstLoad.operationId, separator.operationId, secondLoad.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(11), optIrValueId(12)],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  const func = functionForMaterializationTest({ blocks: [block], entryBlock: block.blockId });
  return {
    program: programForMaterializationTest(func),
    operations: [firstLoad, separator, secondLoad],
  };
}

export function loopMemoryProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly blockId: ReturnType<typeof optIrBlockId>;
  readonly loadResult: ReturnType<typeof optIrValueId>;
} {
  const laneType = optIrUnsignedIntegerType(8);
  const loadResult = optIrValueId(20);
  const load = requireMemoryLoad({
    operationId: optIrOperationId(1),
    resultId: loadResult,
    byteOffset: 0n,
    byteWidth: 4,
    valueType: laneType,
  });
  const store = requireMemoryStore({
    operationId: optIrOperationId(2),
    storeValue: loadResult,
    byteOffset: 0n,
    byteWidth: 4,
    valueType: laneType,
  });
  const helper = requireMemoryLoad({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(22),
    byteOffset: 8n,
    byteWidth: 1,
    valueType: laneType,
  });
  const blockId = optIrBlockId(10);
  const block: OptIrBlock = {
    blockId,
    parameters: [],
    operations: [load.operationId, store.operationId, helper.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(20)],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  const func = functionForMaterializationTest({ blocks: [block], entryBlock: blockId });
  return {
    program: programForMaterializationTest(func),
    operations: [load, store, helper],
    blockId,
    loadResult,
  };
}

function requireMemoryLoad(input: {
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly resultId: ReturnType<typeof optIrValueId>;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly valueType: ReturnType<typeof optIrUnsignedIntegerType>;
}): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: input.operationId,
    region: optIrRegionId(1),
    byteOffset: input.byteOffset,
    byteWidth: input.byteWidth,
    alignment: input.byteWidth,
    valueType: input.valueType,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "vector-materialization-test" },
    resultId: input.resultId,
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("fixture memory load must be valid");
  }
  return result.operation;
}

function requireMemoryStore(input: {
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly storeValue: ReturnType<typeof optIrValueId>;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly valueType: ReturnType<typeof optIrUnsignedIntegerType>;
}): OptIrOperation {
  const result = optIrMemoryStoreOperation({
    operationId: input.operationId,
    region: optIrRegionId(2),
    byteOffset: input.byteOffset,
    byteWidth: input.byteWidth,
    alignment: input.byteWidth,
    valueType: input.valueType,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "vector-materialization-test" },
    storeValue: input.storeValue,
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("fixture memory store must be valid");
  }
  return result.operation;
}

function functionForMaterializationTest(input: Partial<OptIrFunction> = {}): OptIrFunction {
  return {
    functionId: input.functionId ?? optIrFunctionId(1),
    monoInstanceId: input.monoInstanceId ?? monoInstanceId("test::vector-materialization"),
    signature: input.signature ?? ({} as MonoFunctionSignature),
    blocks: input.blocks ?? [],
    edges: input.edges ?? optIrCfgEdgeTable([]),
    entryBlock: input.entryBlock ?? optIrBlockId(1),
    summary: input.summary,
    originId: input.originId ?? optIrOriginId(1),
  };
}

function programForMaterializationTest(func: OptIrFunction): OptIrProgram {
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("test-target"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable([
      { regionId: optIrRegionId(1), originId: optIrOriginId(1) },
      { regionId: optIrRegionId(2), originId: optIrOriginId(1) },
    ]),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [optIrOriginId(1)] },
  });
}

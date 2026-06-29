import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import type { OptIrBlock, OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
  type OptIrRegionId,
  type OptIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  type OptIrMemoryAccessDescriptor,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType, type OptIrType } from "../../../src/opt-ir/types";
import type {
  OptIrInterpreterEffectTrace,
  OptIrInterpreterMemory,
  OptIrInterpreterSlice,
  OptIrRuntimeValue,
} from "../../../src/opt-ir/interpreter";

export function optIrIntegerValueForTest(width: number, value: bigint): OptIrRuntimeValue {
  return { type: optIrUnsignedIntegerType(width), value };
}

export function optIrReturnOfAddForTest(input: {
  readonly left: bigint;
  readonly right: bigint;
  readonly width: number;
}): OptIrInterpreterSlice {
  const type = optIrUnsignedIntegerType(input.width);
  const operations = [
    constantOperationForTest(0, 0, type, input.left),
    constantOperationForTest(1, 1, type, input.right),
    optIrIntegerBinaryOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(2),
      left: optIrValueId(0),
      right: optIrValueId(1),
      operator: "add",
      resultType: type,
      originId: optIrOriginId(0),
    }),
  ];

  return linearSliceForTest(operations, [optIrValueId(2)]);
}

export function optIrBranchingCompareForTest(input: {
  readonly left: bigint;
  readonly right: bigint;
  readonly width: number;
}): OptIrInterpreterSlice {
  const type = optIrUnsignedIntegerType(input.width);
  const operations = [
    constantOperationForTest(0, 0, type, input.left),
    constantOperationForTest(1, 1, type, input.right),
    optIrIntegerCompareOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(2),
      left: optIrValueId(0),
      right: optIrValueId(1),
      operator: "unsignedLessThan",
      originId: optIrOriginId(0),
    }),
  ];

  const trueEdge = edgeForTest(0, 0, 1, "branchTrue", [optIrValueId(0)]);
  const falseEdge = edgeForTest(1, 0, 2, "branchFalse", [optIrValueId(1)]);
  return {
    entryBlock: optIrBlockId(0),
    blocks: [
      {
        blockId: optIrBlockId(0),
        parameters: [],
        operations: operations.map((operation) => operation.operationId),
        terminator: {
          kind: "branch",
          operationId: optIrOperationId(3),
          condition: optIrValueId(2),
          trueEdge: trueEdge.edgeId,
          falseEdge: falseEdge.edgeId,
          originId: optIrOriginId(0),
        },
        originId: optIrOriginId(0),
      },
      returnBlockForTest(1, [optIrValueId(0)]),
      returnBlockForTest(2, [optIrValueId(1)]),
    ],
    edges: optIrCfgEdgeTable([trueEdge, falseEdge]),
    operations,
  };
}

export function optIrMemoryLoadStoreSliceForTest(input: {
  readonly region?: OptIrRegionId;
  readonly stored: bigint;
  readonly width: number;
}): OptIrInterpreterSlice {
  const region = input.region ?? optIrRegionId(0);
  const type = optIrUnsignedIntegerType(input.width);
  const access = memoryAccessForTest(region, type, input.width / 8);
  const storeValue = constantOperationForTest(0, 0, type, input.stored);
  const store = optIrMemoryStoreOperation({
    operationId: optIrOperationId(1),
    storeValue: optIrValueId(0),
    ...access,
    originId: optIrOriginId(0),
  });
  const load = optIrMemoryLoadOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(1),
    ...access,
    originId: optIrOriginId(0),
  });
  if (store.kind !== "ok" || load.kind !== "ok") {
    throw new Error("Expected memory operations to be constructible.");
  }
  return linearSliceForTest([storeValue, store.operation, load.operation], [optIrValueId(1)]);
}

export function fakeOptIrMemoryForTest(): OptIrInterpreterMemory {
  const regions = new Map<string, OptIrRuntimeValue>();
  return {
    load(access) {
      const value = regions.get(memoryKey(access));
      if (value === undefined) {
        return { kind: "trap", reason: `uninitialized-memory:${memoryKey(access)}` };
      }
      return { kind: "ok", value };
    },
    store(access, value) {
      regions.set(memoryKey(access), value);
      return { kind: "ok" };
    },
    snapshot() {
      return [...regions.entries()].sort(([left], [right]) => left.localeCompare(right));
    },
  };
}

export function fakeOptIrEffectTraceForTest(): OptIrInterpreterEffectTrace {
  const events: string[] = [];
  return {
    record(event) {
      events.push(`${event.kind}:${event.operationId}:${event.region}:${event.byteOffset}`);
    },
    snapshot() {
      return events.slice();
    },
  };
}

export function constantOperationForTest(
  operation: number,
  result: number,
  type: OptIrType,
  value: bigint,
): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operation),
      type,
      normalizedValue: value,
    }),
    originId: optIrOriginId(0),
  });
}

export function linearSliceForTest(
  operations: readonly OptIrOperation[],
  returnedValues: readonly OptIrValueId[],
): OptIrInterpreterSlice {
  return {
    entryBlock: optIrBlockId(0),
    blocks: [
      {
        blockId: optIrBlockId(0),
        parameters: [],
        operations: operations.map((operation) => operation.operationId),
        terminator: {
          kind: "return",
          operationId: optIrOperationId(999),
          values: returnedValues,
          originId: optIrOriginId(0),
        },
        originId: optIrOriginId(0),
      },
    ],
    edges: optIrCfgEdgeTable([]),
    operations,
  };
}

function returnBlockForTest(block: number, values: readonly OptIrValueId[]): OptIrBlock {
  return {
    blockId: optIrBlockId(block),
    parameters: [],
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(100 + block),
      values,
      originId: optIrOriginId(0),
    },
    originId: optIrOriginId(0),
  };
}

function edgeForTest(
  edge: number,
  from: number,
  target: number,
  kind: OptIrEdge["kind"],
  argumentIds: readonly OptIrValueId[],
): OptIrEdge {
  return {
    edgeId: optIrEdgeId(edge),
    from: optIrBlockId(from),
    toBlock: optIrBlockId(target),
    ordinal: edge,
    kind,
    arguments: argumentIds,
    originId: optIrOriginId(0),
  };
}

function memoryAccessForTest(
  region: OptIrRegionId,
  valueType: OptIrType,
  byteWidth: number,
): OptIrMemoryAccessDescriptor {
  return {
    region,
    byteOffset: 0n,
    byteWidth,
    alignment: byteWidth,
    valueType,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "test-bounds" },
  };
}

function memoryKey(access: OptIrMemoryAccessDescriptor): string {
  return `${access.region}:${access.byteOffset}:${access.byteWidth}`;
}

import { describe, expect, test } from "bun:test";

import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import {
  optIrBlockId,
  optIrCallId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
  type OptIrOperationId,
} from "../../../src/opt-ir/ids";
import {
  optIrIntegerBinaryOperation,
  optIrMemoryLoadOperation,
  optIrPlatformCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { runDeadCodeElimination } from "../../../src/opt-ir/passes/dce";
import { coreTypeId, functionId, itemId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";

const integer32 = optIrSignedIntegerType(32);

describe("OptIR cleanup dce", () => {
  test("dce removes recursively unused pure operations while preserving survivor order", () => {
    const used = addOperation(1, 10, 1, 2);
    const unusedRoot = addOperation(2, 11, 3, 4);
    const unusedDependency = addOperation(3, 3, 5, 6);
    const laterUsed = addOperation(4, 12, 10, 7);
    const functionInput = functionWithOperations([
      used.operationId,
      unusedRoot.operationId,
      unusedDependency.operationId,
      laterUsed.operationId,
    ]);

    const result = runDeadCodeElimination({
      function: functionInput,
      operations: operationTable([used, unusedRoot, unusedDependency, laterUsed]),
      liveOutValues: [optIrValueId(12)],
    });

    expect(blockOperations(result.function)).toEqual([used.operationId, laterUsed.operationId]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      used.operationId,
      laterUsed.operationId,
    ]);
    expect(result.removedOperationIds).toEqual([
      unusedRoot.operationId,
      unusedDependency.operationId,
    ]);
  });

  test("dce preserves effectful operations and volatile loads even when their results are unused", () => {
    const volatileLoad = loadOperation({ operationId: 1, resultId: 10, volatility: "volatile" });
    const platformCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(1),
      target: { kind: "platform", platformKey: "platform.poll" },
      argumentIds: [],
      resultIds: [optIrValueId(11)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const unusedPure = addOperation(3, 12, 20, 21);
    const functionInput = functionWithOperations([
      volatileLoad.operationId,
      platformCall.operationId,
      unusedPure.operationId,
    ]);

    const result = runDeadCodeElimination({
      function: functionInput,
      operations: operationTable([volatileLoad, platformCall, unusedPure]),
      liveOutValues: [],
    });

    expect(blockOperations(result.function)).toEqual([
      volatileLoad.operationId,
      platformCall.operationId,
    ]);
    expect(result.removedOperationIds).toEqual([unusedPure.operationId]);
  });

  test("dce preserves operations with fact or rewrite obligations that cannot be proven preserved", () => {
    const removable = addOperation(1, 10, 1, 2);
    const obligated = addOperation(2, 11, 3, 4);
    const functionInput = functionWithOperations([removable.operationId, obligated.operationId]);

    const result = runDeadCodeElimination({
      function: functionInput,
      operations: operationTable([removable, obligated]),
      liveOutValues: [],
      canRemoveOperation(operation) {
        return operation.operationId !== obligated.operationId;
      },
    });

    expect(blockOperations(result.function)).toEqual([obligated.operationId]);
    expect(result.removedOperationIds).toEqual([removable.operationId]);
  });

  test("dce preserves operations whose results flow through CFG edge arguments", () => {
    const edgeArgumentProducer = addOperation(1, 10, 1, 2);
    const unused = addOperation(2, 11, 3, 4);
    const functionInput = functionWithOperations(
      [edgeArgumentProducer.operationId, unused.operationId],
      [edgeToBlockArgument(optIrValueId(10))],
    );

    const result = runDeadCodeElimination({
      function: functionInput,
      operations: operationTable([edgeArgumentProducer, unused]),
      liveOutValues: [],
    });

    expect(blockOperations(result.function)).toEqual([edgeArgumentProducer.operationId]);
    expect(result.removedOperationIds).toEqual([unused.operationId]);
  });
});

function addOperation(
  operationId: number,
  resultId: number,
  left: number,
  right: number,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator: "add",
    resultType: integer32,
    originId: optIrOriginId(1),
  });
}

function loadOperation(input: {
  readonly operationId: number;
  readonly resultId: number;
  readonly volatility: "nonVolatile" | "volatile";
}): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(input.operationId),
    resultId: optIrValueId(input.resultId),
    region: optIrRegionId(1),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: integer32,
    endian: "little",
    volatility: input.volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: "test-region" },
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("Expected load fixture to construct.");
  }
  return result.operation;
}

function functionWithOperations(
  operationIds: readonly OptIrOperationId[],
  edges: readonly OptIrEdge[] = [],
): OptIrFunction {
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operationIds,
    originId: optIrOriginId(1),
  };
  return {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: [block],
    edges: optIrCfgEdgeTable(edges),
    entryBlock: block.blockId,
    originId: optIrOriginId(1),
  };
}

function edgeToBlockArgument(argumentId: ReturnType<typeof optIrValueId>): OptIrEdge {
  return {
    edgeId: optIrEdgeId(1),
    from: optIrBlockId(1),
    toBlock: optIrBlockId(2),
    ordinal: 0,
    kind: "normal",
    arguments: [argumentId],
    originId: optIrOriginId(1),
  };
}

function signatureForTest(): MonoFunctionSignature {
  return {
    functionId: functionId(1),
    itemId: itemId(1),
    parameters: [],
    returnType: monoCheckedTypeForTest("Never"),
    returnKind: "Never",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}

function monoCheckedTypeForTest(name: string): MonoCheckedType {
  return coreCheckedType(coreTypeId(name)) as MonoCheckedType;
}

function operationTable(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function blockOperations(functionOutput: OptIrFunction): readonly OptIrOperationId[] {
  return functionOutput.blocks.flatMap((block) => block.operations);
}

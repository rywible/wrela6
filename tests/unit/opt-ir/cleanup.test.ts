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
import { runCopyPropagation } from "../../../src/opt-ir/passes/copy-propagation";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
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

describe("OptIR cleanup copy propagation", () => {
  test("copy propagation rewrites operation operands, terminal values, and CFG edge arguments", () => {
    const copiedValue = optIrValueId(40);
    const sourceValue = optIrValueId(7);
    const usedOperation = addOperation(1, 10, 40, 2);
    const functionInput = functionWithOperations(
      [usedOperation.operationId],
      [edgeToBlockArgument(copiedValue)],
    );
    const functionWithReturn: OptIrFunction = {
      ...functionInput,
      blocks: functionInput.blocks.map((block) => ({
        ...block,
        terminator: {
          kind: "return",
          operationId: optIrOperationId(50),
          values: [copiedValue],
          originId: optIrOriginId(1),
        },
      })),
    };

    const result = runCopyPropagation({
      function: functionWithReturn,
      operations: operationTable([usedOperation]),
      valueCopies: [[copiedValue, sourceValue]],
    });

    const rewrittenOperation = requireOperation(result.operations, usedOperation.operationId);
    expect(rewrittenOperation.operandIds).toEqual([sourceValue, optIrValueId(2)]);
    expect(result.function.blocks[0]?.terminator).toEqual({
      kind: "return",
      operationId: optIrOperationId(50),
      values: [sourceValue],
      originId: optIrOriginId(1),
    });
    expect(result.function.edges.entries()[0]?.arguments).toEqual([sourceValue]);
    expect(result.subjectRemap.entries).toEqual([
      {
        source: { kind: "value", valueId: copiedValue },
        target: { kind: "value", valueId: sourceValue },
      },
    ]);

    const idempotent = runCopyPropagation({
      function: result.function,
      operations: operationTable(result.operations),
      valueCopies: [[copiedValue, sourceValue]],
    });
    expect(idempotent.rewrittenValueIds).toEqual([]);
    expect(idempotent.function.blocks).toEqual(result.function.blocks);
    expect(idempotent.function.edges.entries()).toEqual(result.function.edges.entries());
  });

  test("copy propagation simplifies a block argument when every incoming edge passes the same value", () => {
    const incomingValue = optIrValueId(5);
    const blockParameter = optIrBlockParameter({
      valueId: optIrValueId(20),
      type: integer32,
      incomingRole: "phi",
      originId: optIrOriginId(1),
    });
    const consumer = addOperation(1, 30, 20, 8);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [blockParameter],
          operations: [consumer.operationId],
          originId: optIrOriginId(1),
        },
      ],
      edges: [
        {
          edgeId: optIrEdgeId(1),
          from: optIrBlockId(1),
          toBlock: optIrBlockId(2),
          ordinal: 0,
          kind: "normal",
          arguments: [incomingValue],
          originId: optIrOriginId(1),
        },
        {
          edgeId: optIrEdgeId(2),
          from: optIrBlockId(1),
          toBlock: optIrBlockId(2),
          ordinal: 1,
          kind: "normal",
          arguments: [incomingValue],
          originId: optIrOriginId(1),
        },
      ],
    });

    const result = runCopyPropagation({
      function: functionInput,
      operations: operationTable([consumer]),
    });

    expect(result.function.blocks[1]?.parameters).toEqual([]);
    expect(result.function.edges.entries().map((edge) => edge.arguments)).toEqual([[], []]);
    expect(requireOperation(result.operations, consumer.operationId).operandIds).toEqual([
      incomingValue,
      optIrValueId(8),
    ]);
    expect(result.removedBlockParameterValueIds).toEqual([blockParameter.valueId]);
    expect(result.subjectRemap.entries).toEqual([
      {
        source: { kind: "value", valueId: blockParameter.valueId },
        target: { kind: "value", valueId: incomingValue },
      },
    ]);
  });

  test("copy propagation rewrites branch and switch terminal control values", () => {
    const copiedBranchCondition = optIrValueId(40);
    const branchCondition = optIrValueId(7);
    const copiedSwitchScrutinee = optIrValueId(41);
    const switchScrutinee = optIrValueId(8);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          terminator: {
            kind: "branch",
            operationId: optIrOperationId(50),
            condition: copiedBranchCondition,
            trueEdge: optIrEdgeId(1),
            falseEdge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [],
          operations: [],
          terminator: {
            kind: "switch",
            operationId: optIrOperationId(51),
            scrutinee: copiedSwitchScrutinee,
            cases: [{ label: "ready", edge: optIrEdgeId(3) }],
            defaultEdge: optIrEdgeId(4),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
      ],
    });

    const result = runCopyPropagation({
      function: functionInput,
      operations: operationTable([]),
      valueCopies: [
        [copiedBranchCondition, branchCondition],
        [copiedSwitchScrutinee, switchScrutinee],
      ],
    });

    expect(result.function.blocks[0]?.terminator).toEqual({
      kind: "branch",
      operationId: optIrOperationId(50),
      condition: branchCondition,
      trueEdge: optIrEdgeId(1),
      falseEdge: optIrEdgeId(2),
      originId: optIrOriginId(1),
    });
    expect(result.function.blocks[1]?.terminator).toEqual({
      kind: "switch",
      operationId: optIrOperationId(51),
      scrutinee: switchScrutinee,
      cases: [{ label: "ready", edge: optIrEdgeId(3) }],
      defaultEdge: optIrEdgeId(4),
      originId: optIrOriginId(1),
    });
  });

  test("copy propagation keeps block arguments when predecessor values differ", () => {
    const blockParameter = optIrBlockParameter({
      valueId: optIrValueId(20),
      type: integer32,
      incomingRole: "phi",
      originId: optIrOriginId(1),
    });
    const consumer = addOperation(1, 30, 20, 8);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [blockParameter],
          operations: [consumer.operationId],
          originId: optIrOriginId(1),
        },
      ],
      edges: [
        edgeIntoBlock(optIrEdgeId(1), optIrBlockId(2), [optIrValueId(5)]),
        edgeIntoBlock(optIrEdgeId(2), optIrBlockId(2), [optIrValueId(6)]),
      ],
    });

    const result = runCopyPropagation({
      function: functionInput,
      operations: operationTable([consumer]),
    });

    expect(result.function.blocks[1]?.parameters).toEqual([blockParameter]);
    expect(result.function.edges.entries().map((edge) => edge.arguments)).toEqual([
      [optIrValueId(5)],
      [optIrValueId(6)],
    ]);
    expect(requireOperation(result.operations, consumer.operationId).operandIds).toEqual([
      blockParameter.valueId,
      optIrValueId(8),
    ]);
    expect(result.subjectRemap.entries).toEqual([]);
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

function functionWithBlocks(input: {
  readonly blocks: readonly OptIrBlock[];
  readonly edges?: readonly OptIrEdge[];
}): OptIrFunction {
  return {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: input.blocks,
    edges: optIrCfgEdgeTable(input.edges ?? []),
    entryBlock: input.blocks[0]?.blockId ?? optIrBlockId(1),
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

function edgeIntoBlock(
  edgeId: ReturnType<typeof optIrEdgeId>,
  toBlock: ReturnType<typeof optIrBlockId>,
  argumentIds: readonly ReturnType<typeof optIrValueId>[],
): OptIrEdge {
  return {
    edgeId,
    from: optIrBlockId(1),
    toBlock,
    ordinal: Number(edgeId),
    kind: "normal",
    arguments: argumentIds,
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

function requireOperation(
  operations: readonly OptIrOperation[],
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) {
    throw new Error(`Expected operation ${operationId}.`);
  }
  return operation;
}

function blockOperations(functionOutput: OptIrFunction): readonly OptIrOperationId[] {
  return functionOutput.blocks.flatMap((block) => block.operations);
}

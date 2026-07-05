import { describe, expect, test } from "bun:test";

import type { OptIrBlock, OptIrEdge } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrCallId } from "../../../src/opt-ir/ids";
import { optIrPlatformCallOperation } from "../../../src/opt-ir/operations";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { runDeadCodeElimination } from "../../../src/opt-ir/passes/dce";
import { runCopyPropagation } from "../../../src/opt-ir/passes/copy-propagation";
import { runCfgSimplification } from "../../../src/opt-ir/passes/cfg-simplification";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  addOperation,
  blockOperations,
  blockWithReturn,
  booleanConstantOperation,
  edgeBetween,
  edgeIntoBlock,
  edgeToBlockArgument,
  functionWithBlocks,
  functionWithOperations,
  integer32,
  loadOperation,
  operationTable,
  requireOperation,
} from "../../support/opt-ir/cleanup-fixtures";

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
    const volatileLoad = loadOperation({
      operationId: 1,
      resultId: 10,
      volatility: "volatile",
    });
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

  test("dce uses CFG liveness instead of block list order", () => {
    const producer = addOperation(1, 10, 1, 2);
    const unused = addOperation(2, 11, 3, 4);
    const parameter = optIrBlockParameter({
      valueId: optIrValueId(20),
      type: integer32,
      incomingRole: "phi",
      originId: optIrOriginId(1),
    });
    const consumer = addOperation(3, 30, 20, 5);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(2),
          parameters: [parameter],
          operations: [consumer.operationId],
          terminator: {
            kind: "return",
            operationId: optIrOperationId(50),
            values: [consumer.resultIds[0]!],
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [producer.operationId, unused.operationId],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(51),
            edge: optIrEdgeId(1),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
      ],
      edges: [edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), [optIrValueId(10)])],
    });

    const result = runDeadCodeElimination({
      function: { ...functionInput, entryBlock: optIrBlockId(1) },
      operations: operationTable([producer, unused, consumer]),
    });

    expect(blockOperations(result.function)).toEqual([consumer.operationId, producer.operationId]);
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

describe("OptIR cleanup cfg simplification", () => {
  test("cfg simplification folds fact-known branches and removes unreachable blocks and edges", () => {
    const condition = optIrValueId(5);
    const trueBlockOperation = addOperation(1, 20, 1, 2);
    const falseBlockOperation = addOperation(2, 21, 3, 4);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          terminator: {
            kind: "branch",
            operationId: optIrOperationId(50),
            condition,
            trueEdge: optIrEdgeId(1),
            falseEdge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        blockWithReturn(optIrBlockId(2), [trueBlockOperation.operationId]),
        blockWithReturn(optIrBlockId(3), [falseBlockOperation.operationId]),
      ],
      edges: [
        edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), []),
        edgeBetween(optIrEdgeId(2), optIrBlockId(1), optIrBlockId(3), []),
      ],
    });

    const result = runCfgSimplification({
      function: functionInput,
      operations: operationTable([trueBlockOperation, falseBlockOperation]),
      booleanFacts: [[condition, true]],
    });

    expect(result.function.blocks.map((block) => block.blockId)).toEqual([optIrBlockId(1)]);
    expect(result.function.edges.entries()).toEqual([]);
    expect(result.function.blocks[0]?.operations).toEqual([trueBlockOperation.operationId]);
    expect(result.function.blocks[0]?.terminator).toEqual({
      kind: "return",
      operationId: optIrOperationId(102),
      values: [],
      originId: optIrOriginId(1),
    });
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      trueBlockOperation.operationId,
    ]);
    expect(result.removedBlockIds).toEqual([optIrBlockId(2), optIrBlockId(3)]);
    expect(result.removedEdgeIds).toEqual([optIrEdgeId(1), optIrEdgeId(2)]);
    expect(result.subjectRemap.droppedSubjectKeys).toEqual([
      "block:2",
      "block:3",
      "edge:1",
      "edge:2",
      "operation:2",
      "value:21",
    ]);

    const idempotent = runCfgSimplification({
      function: result.function,
      operations: operationTable(result.operations),
      booleanFacts: [[condition, true]],
    });
    expect(idempotent.function.blocks).toEqual(result.function.blocks);
    expect(idempotent.function.edges.entries()).toEqual(result.function.edges.entries());
    expect(idempotent.removedBlockIds).toEqual([]);
    expect(idempotent.removedEdgeIds).toEqual([]);
  });

  test("cfg simplification coalesces linear jump blocks and remaps parameters safely", () => {
    const parameter = optIrBlockParameter({
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
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(40),
            edge: optIrEdgeId(1),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [parameter],
          operations: [],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(41),
            edge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        blockWithReturn(optIrBlockId(3), [consumer.operationId]),
      ],
      edges: [
        edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), [optIrValueId(7)]),
        edgeBetween(optIrEdgeId(2), optIrBlockId(2), optIrBlockId(3), [parameter.valueId]),
      ],
    });

    const result = runCfgSimplification({
      function: functionInput,
      operations: operationTable([consumer]),
    });

    expect(result.function.blocks.map((block) => block.blockId)).toEqual([optIrBlockId(1)]);
    expect(result.function.edges.entries()).toEqual([]);
    expect(result.function.blocks[0]?.operations).toEqual([consumer.operationId]);
    expect(result.function.blocks[0]?.terminator).toEqual({
      kind: "return",
      operationId: optIrOperationId(103),
      values: [],
      originId: optIrOriginId(1),
    });
    expect(result.removedBlockIds).toEqual([optIrBlockId(2), optIrBlockId(3)]);
    expect(result.removedEdgeIds).toEqual([optIrEdgeId(1), optIrEdgeId(2)]);
    expect(result.subjectRemap.entries).toEqual([
      {
        source: { kind: "value", valueId: parameter.valueId },
        target: { kind: "value", valueId: optIrValueId(7) },
      },
    ]);
    expect(result.subjectRemap.droppedSubjectKeys).toEqual([
      "block:2",
      "block:3",
      "edge:1",
      "edge:2",
    ]);
    expect(requireOperation(result.operations, consumer.operationId).operandIds).toEqual([
      optIrValueId(7),
      optIrValueId(8),
    ]);
  });

  test("cfg simplification keeps parameterized jump blocks without a real replacement value", () => {
    const parameter = optIrBlockParameter({
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
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(40),
            edge: optIrEdgeId(1),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [parameter],
          operations: [],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(41),
            edge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        blockWithReturn(optIrBlockId(3), [consumer.operationId]),
      ],
      edges: [
        edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), [parameter.valueId]),
        edgeBetween(optIrEdgeId(2), optIrBlockId(2), optIrBlockId(3), []),
      ],
    });

    const result = runCfgSimplification({
      function: functionInput,
      operations: operationTable([consumer]),
    });

    expect(result.function.blocks.map((block) => block.blockId)).toEqual([
      optIrBlockId(1),
      optIrBlockId(2),
    ]);
    expect(result.function.blocks[1]?.parameters).toEqual([parameter]);
    expect(result.function.blocks[1]?.operations).toEqual([consumer.operationId]);
    expect(result.function.blocks[1]?.terminator).toEqual({
      kind: "return",
      operationId: optIrOperationId(103),
      values: [],
      originId: optIrOriginId(1),
    });
    expect(result.removedBlockIds).toEqual([optIrBlockId(3)]);
    expect(result.removedEdgeIds).toEqual([optIrEdgeId(2)]);
    expect(requireOperation(result.operations, consumer.operationId).operandIds).toEqual([
      parameter.valueId,
      optIrValueId(8),
    ]);
  });

  test("cfg simplification keeps loop headers with later backedge predecessors separate", () => {
    const bodyOperation = addOperation(1, 30, 20, 21);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(40),
            edge: optIrEdgeId(1),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(2),
          parameters: [],
          operations: [],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(41),
            edge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(3),
          parameters: [],
          operations: [bodyOperation.operationId],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(42),
            edge: optIrEdgeId(3),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        {
          blockId: optIrBlockId(4),
          parameters: [],
          operations: [],
          terminator: {
            kind: "jump",
            operationId: optIrOperationId(43),
            edge: optIrEdgeId(4),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
      ],
      edges: [
        edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), []),
        edgeBetween(optIrEdgeId(2), optIrBlockId(2), optIrBlockId(3), []),
        edgeBetween(optIrEdgeId(3), optIrBlockId(3), optIrBlockId(4), []),
        edgeBetween(optIrEdgeId(4), optIrBlockId(4), optIrBlockId(2), []),
      ],
    });

    const result = runCfgSimplification({
      function: functionInput,
      operations: operationTable([bodyOperation]),
    });

    const header = result.function.blocks.find((block) => block.blockId === optIrBlockId(2));
    expect(header?.operations).toEqual([]);
    expect(header?.terminator).toEqual({
      kind: "jump",
      operationId: optIrOperationId(41),
      edge: optIrEdgeId(2),
      originId: optIrOriginId(1),
    });
    expect(result.function.blocks.map((block) => block.blockId)).toEqual([
      optIrBlockId(1),
      optIrBlockId(2),
      optIrBlockId(3),
    ]);
    expect(result.function.edges.entries().map((edge) => edge.edgeId)).toEqual([
      optIrEdgeId(1),
      optIrEdgeId(2),
      optIrEdgeId(4),
    ]);
  });

  test("cfg simplification keeps branches without scoped facts or constants", () => {
    const condition = optIrValueId(5);
    const constant = booleanConstantOperation(1, 10, 1n);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [constant.operationId],
          terminator: {
            kind: "branch",
            operationId: optIrOperationId(50),
            condition,
            trueEdge: optIrEdgeId(1),
            falseEdge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
        blockWithReturn(optIrBlockId(2), []),
        blockWithReturn(optIrBlockId(3), []),
      ],
      edges: [
        edgeBetween(optIrEdgeId(1), optIrBlockId(1), optIrBlockId(2), []),
        edgeBetween(optIrEdgeId(2), optIrBlockId(1), optIrBlockId(3), []),
      ],
    });

    const result = runCfgSimplification({
      function: functionInput,
      operations: operationTable([constant]),
    });

    expect(result.function.blocks).toEqual(functionInput.blocks);
    expect(result.function.edges.entries()).toEqual(functionInput.edges.entries());
    expect(result.removedBlockIds).toEqual([]);
    expect(result.removedEdgeIds).toEqual([]);
    expect(result.subjectRemap.entries).toEqual([]);
    expect(result.subjectRemap.droppedSubjectKeys).toEqual([]);
  });

  test("cfg simplification uses graph-size fuel for chains longer than eight steps", () => {
    const operation = addOperation(1, 30, 20, 21);
    const blocks: OptIrBlock[] = [];
    const edges: OptIrEdge[] = [];
    for (let index = 1; index <= 11; index += 1) {
      const blockId = optIrBlockId(index);
      const nextBlockId = optIrBlockId(index + 1);
      blocks.push({
        blockId,
        parameters: [],
        operations: index === 11 ? [operation.operationId] : [],
        terminator:
          index === 11
            ? {
                kind: "return",
                operationId: optIrOperationId(100 + index),
                values: [],
                originId: optIrOriginId(1),
              }
            : {
                kind: "jump",
                operationId: optIrOperationId(100 + index),
                edge: optIrEdgeId(index),
                originId: optIrOriginId(1),
              },
        originId: optIrOriginId(1),
      });
      if (index < 11) {
        edges.push(edgeBetween(optIrEdgeId(index), blockId, nextBlockId, []));
      }
    }

    const result = runCfgSimplification({
      function: functionWithBlocks({ blocks, edges }),
      operations: operationTable([operation]),
    });
    expect(result.function.blocks.map((block) => block.blockId)).toEqual([optIrBlockId(1)]);
    expect(result.diagnostics).toEqual([]);

    const exhausted = runCfgSimplification({
      function: functionWithBlocks({ blocks, edges }),
      operations: operationTable([operation]),
      fuel: 2,
    });
    expect(exhausted.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "cfg-simplification:fuel-exhausted:2:blocks:11:edges:10",
    ]);
  });
});

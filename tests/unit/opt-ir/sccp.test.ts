import { describe, expect, test } from "bun:test";

import { analyzeRanges } from "../../../src/opt-ir/analyses/range-analysis";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
  type OptIrValueId,
} from "../../../src/opt-ir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../src/opt-ir/program";
import { optIrIntegerBinaryOperation } from "../../../src/opt-ir/operations";
import { runSccp } from "../../../src/opt-ir/passes/sccp";
import {
  constantOperationForDataflowTest,
  dataflowIntegerType,
  operationTableForDataflowTest,
  onlySwitchCaseSurvivesForTest,
  programWithStaticSwitchForTest,
} from "../../support/opt-ir/dataflow-fixtures";

describe("OptIR SCCP", () => {
  test("propagates constants through SSA values and block parameters while pruning edges", () => {
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });

    const result = runSccp({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(onlySwitchCaseSurvivesForTest("4")(result.program)).toBe(true);
    expect(result.removedEdgeIds).toEqual([optIrEdgeId(2), optIrEdgeId(3)]);
    expect(result.constantValues.get(optIrValueId(20))?.normalizedValue).toBe(4n);
    expect(result.constantValues.get(optIrValueId(21))?.normalizedValue).toBe(12n);
    expect(result.derivedFacts.map((fact) => fact.edgeId)).toEqual([
      optIrEdgeId(2),
      optIrEdgeId(3),
    ]);
    expect(result.derivedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "impossibility",
          edgeId: 2,
          lineage: expect.objectContaining({
            checkedDependencies: [expect.objectContaining({ kind: "value", valueId: 10 })],
          }),
        }),
      ]),
    );
    expect(result.worklistOrder).toEqual([
      "function:1",
      "block:1",
      "operation:1",
      "value:10",
      "edge:1",
      "block:2",
      "value:20",
      "operation:2",
      "value:11",
      "operation:3",
      "value:21",
    ]);
  });

  test("keeps foldable operations unknown until later producer constants are discovered", () => {
    const fixture = programWithOutOfOrderProducerOperationIdsForTest();

    const result = runSccp({ program: fixture.program, operations: fixture.operations });

    expect(result.constantValues.get(optIrValueId(12))?.normalizedValue).toBe(7n);
    expect(result.worklistOrder).toContain("operation:1");
  });

  test("range analysis derives value ranges with checked lineage", () => {
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });
    const sccp = runSccp({ program: fixture.program, operations: fixture.operations });

    const result = analyzeRanges({
      program: sccp.program,
      operations: sccp.operations,
      constantValues: sccp.constantValues,
    });

    expect(result.facts).toEqual(
      expect.arrayContaining([
        {
          kind: "range",
          valueId: optIrValueId(21),
          range: { min: 12n, max: 12n },
          lineage: {
            checkedDependencies: [
              { kind: "value", valueId: optIrValueId(20) },
              { kind: "operation", operationId: optIrOperationId(3) },
            ],
          },
        },
      ]),
    );
  });

  test("marks conflicting block-argument constants overdefined instead of keeping the first constant", () => {
    const fixture = programWithConflictingJoinValueForTest();

    const result = runSccp({ program: fixture.program, operations: fixture.operations });

    expect(result.constantValues.has(optIrValueId(20))).toBe(false);
    expect(result.removedEdgeIds).toEqual([]);
    expect(
      result.program.functions
        .entries()[0]
        ?.edges.entries()
        .map((edge) => edge.edgeId),
    ).toEqual([
      optIrEdgeId(1),
      optIrEdgeId(2),
      optIrEdgeId(3),
      optIrEdgeId(4),
      optIrEdgeId(5),
      optIrEdgeId(6),
    ]);
  });

  test("marks joins overdefined when one reachable predecessor passes a runtime value", () => {
    const fixture = programWithRuntimeJoinValueForTest();

    const result = runSccp({ program: fixture.program, operations: fixture.operations });

    expect(result.constantValues.has(optIrValueId(20))).toBe(false);
    expect(result.removedEdgeIds).toEqual([]);
    expect(
      result.program.functions
        .entries()[0]
        ?.edges.entries()
        .map((edge) => edge.edgeId),
    ).toEqual([
      optIrEdgeId(1),
      optIrEdgeId(2),
      optIrEdgeId(3),
      optIrEdgeId(4),
      optIrEdgeId(5),
      optIrEdgeId(6),
    ]);
  });
});

function programWithConflictingJoinValueForTest() {
  const originId = optIrOriginId(1);
  const unknownCondition = optIrValueId(99);
  const thenValue = constantOperationForDataflowTest(1, 10, 1n);
  const elseValue = constantOperationForDataflowTest(2, 11, 2n);
  const joinParameter = optIrBlockParameter({
    valueId: optIrValueId(20),
    type: dataflowIntegerType,
    incomingRole: "branchArgument",
    originId,
  });
  const blocks: readonly OptIrBlock[] = [
    {
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [],
      terminator: {
        kind: "branch",
        operationId: optIrOperationId(100),
        condition: unknownCondition,
        trueEdge: optIrEdgeId(1),
        falseEdge: optIrEdgeId(2),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(2),
      parameters: [],
      operations: [thenValue.operationId],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(101),
        edge: optIrEdgeId(3),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(3),
      parameters: [],
      operations: [elseValue.operationId],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(102),
        edge: optIrEdgeId(4),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(4),
      parameters: [joinParameter],
      operations: [],
      terminator: {
        kind: "branch",
        operationId: optIrOperationId(103),
        condition: joinParameter.valueId,
        trueEdge: optIrEdgeId(5),
        falseEdge: optIrEdgeId(6),
        originId,
      },
      originId,
    },
    returnBlock(5, originId),
    returnBlock(6, originId),
  ];
  const edges: readonly OptIrEdge[] = [
    edge(1, 1, 2, "branchTrue", []),
    edge(2, 1, 3, "branchFalse", []),
    edge(3, 2, 4, "normal", [thenValue.resultIds[0] as OptIrValueId]),
    edge(4, 3, 4, "normal", [elseValue.resultIds[0] as OptIrValueId]),
    edge(5, 4, 5, "branchTrue", []),
    edge(6, 4, 6, "branchFalse", []),
  ];
  const functionInput = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test::sccp-conflict"),
    signature: {} as never,
    blocks,
    edges: optIrCfgEdgeTable(edges),
    entryBlock: optIrBlockId(1),
    originId,
  };
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("test-target"),
      functions: optIrFunctionTable([functionInput]),
      regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId }]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    operations: operationTableForDataflowTest([thenValue, elseValue]),
  };
}

function programWithOutOfOrderProducerOperationIdsForTest() {
  const originId = optIrOriginId(1);
  const left = constantOperationForDataflowTest(3, 10, 2n);
  const right = constantOperationForDataflowTest(4, 11, 5n);
  const sum = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(12),
    left: left.resultIds[0] as OptIrValueId,
    right: right.resultIds[0] as OptIrValueId,
    operator: "add",
    resultType: dataflowIntegerType,
    originId,
  });
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [left.operationId, right.operationId, sum.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(100),
      values: [sum.resultIds[0] as OptIrValueId],
      originId,
    },
    originId,
  };
  const functionInput = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test::sccp-out-of-order-producers"),
    signature: {} as never,
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId,
  };
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("test-target"),
      functions: optIrFunctionTable([functionInput]),
      regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId }]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    operations: operationTableForDataflowTest([left, right, sum]),
  };
}

function programWithRuntimeJoinValueForTest() {
  const originId = optIrOriginId(1);
  const unknownCondition = optIrValueId(99);
  const runtimeInput = optIrBlockParameter({
    valueId: optIrValueId(30),
    type: dataflowIntegerType,
    incomingRole: "entry",
    originId,
  });
  const constantValue = constantOperationForDataflowTest(1, 10, 1n);
  const joinParameter = optIrBlockParameter({
    valueId: optIrValueId(20),
    type: dataflowIntegerType,
    incomingRole: "branchArgument",
    originId,
  });
  const blocks: readonly OptIrBlock[] = [
    {
      blockId: optIrBlockId(1),
      parameters: [runtimeInput],
      operations: [],
      terminator: {
        kind: "branch",
        operationId: optIrOperationId(100),
        condition: unknownCondition,
        trueEdge: optIrEdgeId(1),
        falseEdge: optIrEdgeId(2),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(2),
      parameters: [],
      operations: [constantValue.operationId],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(101),
        edge: optIrEdgeId(3),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(3),
      parameters: [],
      operations: [],
      terminator: {
        kind: "jump",
        operationId: optIrOperationId(102),
        edge: optIrEdgeId(4),
        originId,
      },
      originId,
    },
    {
      blockId: optIrBlockId(4),
      parameters: [joinParameter],
      operations: [],
      terminator: {
        kind: "branch",
        operationId: optIrOperationId(103),
        condition: joinParameter.valueId,
        trueEdge: optIrEdgeId(5),
        falseEdge: optIrEdgeId(6),
        originId,
      },
      originId,
    },
    returnBlock(5, originId),
    returnBlock(6, originId),
  ];
  const edges: readonly OptIrEdge[] = [
    edge(1, 1, 2, "branchTrue", []),
    edge(2, 1, 3, "branchFalse", []),
    edge(3, 2, 4, "normal", [constantValue.resultIds[0] as OptIrValueId]),
    edge(4, 3, 4, "normal", [runtimeInput.valueId]),
    edge(5, 4, 5, "branchTrue", []),
    edge(6, 4, 6, "branchFalse", []),
  ];
  const functionInput = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test::sccp-runtime-join"),
    signature: {} as never,
    blocks,
    edges: optIrCfgEdgeTable(edges),
    entryBlock: optIrBlockId(1),
    originId,
  };
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("test-target"),
      functions: optIrFunctionTable([functionInput]),
      regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId }]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    operations: operationTableForDataflowTest([constantValue]),
  };
}

function returnBlock(blockNumber: number, originId: ReturnType<typeof optIrOriginId>): OptIrBlock {
  return {
    blockId: optIrBlockId(blockNumber),
    parameters: [],
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(100 + blockNumber),
      values: [],
      originId,
    },
    originId,
  };
}

function edge(
  edgeNumber: number,
  sourceBlock: number,
  targetBlock: number,
  kind: OptIrEdge["kind"],
  argumentsForEdge: readonly OptIrValueId[],
): OptIrEdge {
  return {
    edgeId: optIrEdgeId(edgeNumber),
    from: optIrBlockId(sourceBlock),
    toBlock: optIrBlockId(targetBlock),
    ordinal: edgeNumber,
    kind,
    arguments: argumentsForEdge,
    originId: optIrOriginId(1),
  };
}

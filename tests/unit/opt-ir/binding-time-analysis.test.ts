import { describe, expect, test } from "bun:test";

import {
  analyzeBindingTime,
  type BindingTimeFactSource,
} from "../../../src/opt-ir/analyses/binding-time-analysis";
import {
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrIntegerBinaryOperation,
  optIrLayoutOffsetOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { runSccp } from "../../../src/opt-ir/passes/sccp";
import { optIrFunctionTable } from "../../../src/opt-ir/program";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  constantOperationForDataflowTest,
  dataflowIntegerType,
  programWithStaticSwitchForTest,
} from "../../support/opt-ir/dataflow-fixtures";

describe("OptIR binding-time analysis", () => {
  test("computes a stable fixpoint over constants, block arguments, and folded pure operations", () => {
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });
    const sccp = runSccp({ program: fixture.program, operations: fixture.operations });

    const result = analyzeBindingTime({
      program: sccp.program,
      operations: sccp.operations,
      constantValues: sccp.constantValues,
    });

    expect(result.classificationOf(optIrValueId(10))).toEqual({
      kind: "static",
      source: "internedConstant",
      factsUsed: [],
      invalidationTriggers: [],
    });
    expect(result.classificationOf(optIrValueId(20))).toEqual({
      kind: "static",
      source: "constantBlockArgument",
      factsUsed: [],
      invalidationTriggers: [],
    });
    expect(result.classificationOf(optIrValueId(21))).toEqual({
      kind: "static",
      source: "pureFoldedResult",
      factsUsed: [],
      invalidationTriggers: [],
    });
    expect(result.fixpointOrder).toEqual([
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

  test("cites facts and invalidation triggers for static layout and exact facts", () => {
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });
    const sccp = runSccp({ program: fixture.program, operations: fixture.operations });
    const layoutOperation = optIrLayoutOffsetOperation({
      operationId: optIrOperationId(70),
      base: optIrValueId(10),
      layoutPath: "packet.header" as never,
      resultId: optIrValueId(70),
      resultType: dataflowIntegerType,
      originId: optIrOriginId(1),
    });
    const operations = shuffledOperationTable([...sccp.operations.values(), layoutOperation]);
    const factSources: readonly BindingTimeFactSource[] = [
      {
        valueId: optIrValueId(70),
        source: "layoutFact",
        factsUsed: [optIrFactId(3)],
        invalidationTriggers: ["layout:packet.header"],
      },
      {
        valueId: optIrValueId(80),
        source: "privateStateFact",
        factsUsed: [optIrFactId(4)],
        invalidationTriggers: ["private-state-generation"],
      },
      {
        valueId: optIrValueId(81),
        source: "capabilityFact",
        factsUsed: [optIrFactId(5)],
        invalidationTriggers: ["capability-flow"],
      },
      {
        valueId: optIrValueId(82),
        source: "impossibilityFact",
        factsUsed: [optIrFactId(6)],
        invalidationTriggers: ["terminal-reachability"],
      },
      {
        valueId: optIrValueId(83),
        source: "abiFact",
        factsUsed: [optIrFactId(8)],
        invalidationTriggers: ["abi-shape"],
      },
      {
        valueId: optIrValueId(84),
        source: "calleeIdentity",
        factsUsed: [optIrFactId(9)],
        invalidationTriggers: ["closed-call-graph"],
      },
    ];

    const result = analyzeBindingTime({
      program: sccp.program,
      operations,
      constantValues: sccp.constantValues,
      factSources,
    });

    expect(result.classificationOf(optIrValueId(70))).toEqual({
      kind: "static",
      source: "layoutFact",
      factsUsed: [optIrFactId(3)],
      invalidationTriggers: ["layout:packet.header"],
    });
    expect(result.classificationOf(optIrValueId(80))).toEqual({
      kind: "static",
      source: "privateStateFact",
      factsUsed: [optIrFactId(4)],
      invalidationTriggers: ["private-state-generation"],
    });
    expect(result.classificationOf(optIrValueId(81))).toEqual({
      kind: "static",
      source: "capabilityFact",
      factsUsed: [optIrFactId(5)],
      invalidationTriggers: ["capability-flow"],
    });
    expect(result.classificationOf(optIrValueId(82))).toEqual({
      kind: "static",
      source: "impossibilityFact",
      factsUsed: [optIrFactId(6)],
      invalidationTriggers: ["terminal-reachability"],
    });
    expect(result.classificationOf(optIrValueId(83))).toEqual({
      kind: "static",
      source: "abiFact",
      factsUsed: [optIrFactId(8)],
      invalidationTriggers: ["abi-shape"],
    });
    expect(result.classificationOf(optIrValueId(84))).toEqual({
      kind: "static",
      source: "calleeIdentity",
      factsUsed: [optIrFactId(9)],
      invalidationTriggers: ["closed-call-graph"],
    });
  });

  test("keeps dynamic operands, unknown call results, out-of-scope facts, and effectful results dynamic", () => {
    const dynamicParameter = optIrBlockParameter({
      valueId: optIrValueId(90),
      type: dataflowIntegerType,
      incomingRole: "entry",
      originId: optIrOriginId(1),
    });
    const exactFactParameter = optIrBlockParameter({
      valueId: optIrValueId(95),
      type: dataflowIntegerType,
      incomingRole: "entry",
      originId: optIrOriginId(1),
    });
    const left = constantOperationForDataflowTest(1, 10, 2n);
    const sum = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(91),
      left: left.resultIds[0] ?? optIrValueId(0),
      right: dynamicParameter.valueId,
      operator: "add",
      resultType: dataflowIntegerType,
      originId: optIrOriginId(1),
    });
    const call = optIrRuntimeCallOperation({
      operationId: optIrOperationId(3),
      callId: 1 as never,
      target: { kind: "runtime", runtimeKey: "clock" },
      argumentIds: [left.resultIds[0] ?? optIrValueId(0)],
      resultIds: [optIrValueId(92)],
      resultTypes: [dataflowIntegerType],
      originId: optIrOriginId(1),
    });
    const load = optIrMemoryLoadOperation({
      operationId: optIrOperationId(4),
      resultId: optIrValueId(94),
      region: 1 as never,
      byteOffset: 0n,
      byteWidth: 4,
      alignment: 4,
      valueType: dataflowIntegerType,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "layoutFact", layoutKey: "packet.header" as never },
      originId: optIrOriginId(1),
    });
    if (load.kind === "error") {
      throw new Error("Invalid memory load test fixture.");
    }
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });
    const block = fixture.function.blocks[0];
    if (block === undefined || left.kind !== "constant") {
      throw new Error("Invalid binding-time analysis test fixture.");
    }
    const functionInput = {
      ...fixture.function,
      blocks: [
        {
          ...block,
          parameters: [dynamicParameter, exactFactParameter],
          operations: [
            left.operationId,
            sum.operationId,
            call.operationId,
            load.operation.operationId,
          ],
        },
      ],
    };
    const program = {
      ...fixture.program,
      functions: optIrFunctionTable([functionInput]),
    };

    const result = analyzeBindingTime({
      program,
      operations: shuffledOperationTable([call, load.operation, sum, left]),
      constantValues: new Map([
        [left.resultIds[0] ?? optIrValueId(0), left.constant],
        [optIrValueId(91), left.constant],
      ]),
      factSources: [
        {
          valueId: optIrValueId(93),
          source: "layoutFact",
          factsUsed: [optIrFactId(7)],
          invalidationTriggers: ["out-of-scope"],
          inScope: false,
        },
        {
          valueId: optIrValueId(94),
          source: "layoutFact",
          factsUsed: [optIrFactId(10)],
          invalidationTriggers: ["effectful-result"],
        },
        {
          valueId: exactFactParameter.valueId,
          source: "privateStateFact",
          factsUsed: [optIrFactId(11)],
          invalidationTriggers: ["private-state-generation"],
        },
      ],
    });

    expect(result.classificationOf(optIrValueId(90))).toEqual({
      kind: "dynamic",
      reason: "dynamicOperand",
    });
    expect(result.classificationOf(optIrValueId(91))).toEqual({
      kind: "dynamic",
      reason: "dynamicOperand",
    });
    expect(result.classificationOf(optIrValueId(92))).toEqual({
      kind: "dynamic",
      reason: "unknownCallResult",
    });
    expect(result.classificationOf(optIrValueId(93))).toEqual({
      kind: "dynamic",
      reason: "outOfScopeFact",
    });
    expect(result.classificationOf(optIrValueId(94))).toEqual({
      kind: "dynamic",
      reason: "effectfulResult",
    });
    expect(result.classificationOf(exactFactParameter.valueId)).toEqual({
      kind: "static",
      source: "privateStateFact",
      factsUsed: [optIrFactId(11)],
      invalidationTriggers: ["private-state-generation"],
    });
  });

  test("returns deterministic classifications when operation table insertion order is shuffled", () => {
    const fixture = programWithStaticSwitchForTest({ discriminant: 4n });
    const sccp = runSccp({ program: fixture.program, operations: fixture.operations });

    const forward = analyzeBindingTime({
      program: sccp.program,
      operations: sccp.operations,
      constantValues: sccp.constantValues,
    });
    const shuffled = analyzeBindingTime({
      program: sccp.program,
      operations: shuffledOperationTable([...sccp.operations.values()].reverse()),
      constantValues: sccp.constantValues,
    });

    expect(shuffled.entries()).toEqual(forward.entries());
    expect(shuffled.fixpointOrder).toEqual(forward.fixpointOrder);
  });
});

function shuffledOperationTable(
  operations: readonly OptIrOperation[],
): ReadonlyMap<(typeof operations)[number]["operationId"], OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

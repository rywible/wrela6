import { describe, expect, test } from "bun:test";

import { analyzeRanges } from "../../../src/opt-ir/analyses/range-analysis";
import { optIrEdgeId, optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import { runSccp } from "../../../src/opt-ir/passes/sccp";
import {
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
});

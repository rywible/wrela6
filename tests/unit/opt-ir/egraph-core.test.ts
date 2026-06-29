import { describe, expect, test } from "bun:test";
import { importOperationsIntoEGraphForTest } from "../../../src/opt-ir/egraph/egraph";
import { selectEGraphRegionsForTest } from "../../../src/opt-ir/egraph/region-selection";
import { optIrOperationId, optIrRewriteRegionId } from "../../../src/opt-ir/ids";
import {
  boundaryFixtureForTest,
  containingRegionTieBreakFixtureForTest,
  multiTokenCallPartialWindowForTest,
  parserAndScalarDagProgramForTest,
  shuffledOperandImportFixtureForTest,
} from "../../support/opt-ir/egraph-fixtures";

describe("OptIR e-graph core and region selection", () => {
  test("imports operations deterministically by referenced operation and operand ids", () => {
    const fixture = shuffledOperandImportFixtureForTest();
    const graph = importOperationsIntoEGraphForTest(fixture.operations);

    expect(graph.importOrder.map((entry) => entry.operationId)).toEqual([
      optIrOperationId(2),
      optIrOperationId(3),
      optIrOperationId(5),
    ]);
    expect(graph.importOrder.map((entry) => entry.operandIds)).toEqual([
      [],
      [fixture.values.source],
      [fixture.values.right, fixture.values.left],
    ]);
  });

  test("prioritizes parser slices, vector loops, memory slices, then scalar DAGs", () => {
    const candidates = selectEGraphRegionsForTest(parserAndScalarDagProgramForTest());

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "parserValidationReadDispatchSlice",
      "vectorizableLoop",
      "singleEntrySingleExitMemorySlice",
      "pureScalarDag",
    ]);
    expect(candidates.map((candidate) => candidate.regionId)).toEqual([
      optIrRewriteRegionId(1),
      optIrRewriteRegionId(2),
      optIrRewriteRegionId(3),
      optIrRewriteRegionId(10),
    ]);
  });

  test("cuts candidates at volatile terminal callback unknown external and effect boundaries", () => {
    const candidates = selectEGraphRegionsForTest(boundaryFixtureForTest());

    expect(candidates.map((candidate) => candidate.rootOperationId)).toEqual([optIrOperationId(8)]);
    expect(candidates[0]?.operationIds).toEqual([optIrOperationId(8), optIrOperationId(9)]);
  });

  test("imports all token participants for multi-token operations or cuts the candidate", () => {
    expect(selectEGraphRegionsForTest(multiTokenCallPartialWindowForTest())).toEqual([]);
  });

  test("resolves overlapping candidates by priority, smaller containing region, then root id", () => {
    const candidates = selectEGraphRegionsForTest(parserAndScalarDagProgramForTest());

    expect(candidates.map((candidate) => candidate.rootOperationId)).toEqual([
      optIrOperationId(10),
      optIrOperationId(20),
      optIrOperationId(30),
      optIrOperationId(39),
    ]);

    expect(selectEGraphRegionsForTest(containingRegionTieBreakFixtureForTest())[0]).toMatchObject({
      regionId: optIrRewriteRegionId(2),
      rootOperationId: optIrOperationId(9),
    });
  });
});

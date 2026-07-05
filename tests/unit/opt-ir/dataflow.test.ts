import { describe, expect, test } from "bun:test";

import { solveOptIrDataflow } from "../../../src/opt-ir/analyses/dataflow";
import { setLattice } from "../../../src/opt-ir/analyses/dataflow-lattice";
import { diamondAnalysisFixture } from "../../support/opt-ir/analysis-fixtures";

describe("OptIR canonical dataflow solver", () => {
  test("solves a forward diamond in deterministic block and edge order", () => {
    const fixture = diamondAnalysisFixture();
    const result = solveOptIrDataflow({
      direction: "forward",
      function: fixture.func,
      lattice: setLattice<string>(),
      boundary: new Set(["entry"]),
      transfer(block, input) {
        return new Set([...input, `b${Number(block.blockId)}`]);
      },
      maxIterations: 32,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected dataflow to converge");
    expect([...result.inputStates.get(fixture.blocks.join.blockId)!]).toEqual([
      "entry",
      "b1",
      "b2",
      "b3",
    ]);
    expect([...result.outputStates.get(fixture.blocks.join.blockId)!]).toEqual([
      "entry",
      "b1",
      "b2",
      "b3",
      "b4",
    ]);
  });

  test("reports a stable fuel diagnostic when the worklist does not converge", () => {
    const fixture = diamondAnalysisFixture();
    const result = solveOptIrDataflow({
      direction: "backward",
      function: fixture.func,
      lattice: setLattice<string>(),
      boundary: new Set<string>(),
      transfer(_block, input) {
        return new Set([...input, String(input.size)]);
      },
      maxIterations: 1,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected dataflow fuel exhaustion");
    expect(result.diagnostic.stableDetail).toBe("dataflow-fuel-exhausted:backward:1");
  });
});

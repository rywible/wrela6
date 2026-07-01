import { describe, expect, test } from "bun:test";
import {
  planAArch64LiteralPool,
  planAArch64LiteralPoolsForPlanningState,
} from "../../../../src/target/aarch64/plan/literal-pool-planning";
import {
  aarch64MovzForPlanningTest,
  aarch64PlanningStateForTest,
} from "../../../support/target/aarch64/machine-ir/planning-state-builders";

describe("AArch64 literal-pool planning", () => {
  test("dedupes only identical literal identity tuples", () => {
    const planned = planAArch64LiteralPool({
      literals: [
        literal({ relocationKey: "none", reachabilityGroup: "block:0" }),
        literal({ relocationKey: "none", reachabilityGroup: "block:0" }),
        literal({ relocationKey: "reloc:1", reachabilityGroup: "block:0" }),
        literal({ relocationKey: "none", reachabilityGroup: "block:1" }),
      ],
    });

    expect(planned.entries).toHaveLength(3);
    const stableKeys = planned.entries.map((entry) => entry.stableKey);
    expect(stableKeys).toEqual(stableKeys.toSorted());
  });

  test("updates machine-function literal pool plan deterministically", () => {
    const planned = planAArch64LiteralPoolsForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n }),
          aarch64MovzForPlanningTest({ instructionId: 2, output: 2, value: 7n }),
        ],
      }),
    });

    expect(planned.revision).toBe(1);
    expect(planned.machineFunction.literalPoolPlan).toHaveLength(1);
    expect(planned.machineFunction.literalPoolPlan[0]).toContain("bytes:0700000000000000");
  });
});

function literal(input: { readonly relocationKey: string; readonly reachabilityGroup: string }) {
  return {
    bytes: [7, 0, 0, 0, 0, 0, 0, 0],
    typeKey: "i64",
    relocationKey: input.relocationKey,
    poolScope: "function:1",
    sectionKey: "rodata",
    reachabilityGroup: input.reachabilityGroup,
  };
}

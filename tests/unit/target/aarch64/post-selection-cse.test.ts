import { describe, expect, test } from "bun:test";
import { aarch64SecurityMetadata } from "../../../../src/target/aarch64/machine-ir/security";
import { runAArch64PostSelectionCse } from "../../../../src/target/aarch64/plan/post-selection-cse";
import {
  aarch64AddImmediateForPlanningTest,
  aarch64CallForPlanningTest,
  aarch64MovzForPlanningTest,
  aarch64PlanningStateForTest,
  planningOpcodes,
} from "../../../support/target/aarch64/machine-ir/planning-state-builders";

describe("AArch64 post-selection CSE", () => {
  test("removes duplicate pure producers in one block and rewrites later uses", () => {
    const planned = runAArch64PostSelectionCse({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n }),
          aarch64MovzForPlanningTest({ instructionId: 2, output: 2, value: 7n }),
          aarch64AddImmediateForPlanningTest({
            instructionId: 3,
            output: 3,
            source: 2,
            value: 1n,
          }),
        ],
      }),
    });

    const add = planned.machineFunction.blocks[0]?.instructions[1];
    expect(planned.revision).toBeGreaterThan(0);
    expect(planningOpcodes(planned)).toEqual(["movz", "add-immediate"]);
    expect(
      add?.operands.some(
        (operand) =>
          operand.role === "use" &&
          operand.operand.kind === "vreg" &&
          operand.operand.register.vreg === 1,
      ),
    ).toBe(true);
  });

  test("does not CSE across call boundaries or secret producers", () => {
    const secret = aarch64SecurityMetadata({
      labels: [{ kind: "secret", key: "classifier-key" }],
      constantTime: true,
      spillPolicy: "noSpill",
    });
    const callBoundary = runAArch64PostSelectionCse({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n }),
          aarch64CallForPlanningTest(2),
          aarch64MovzForPlanningTest({ instructionId: 3, output: 2, value: 7n }),
        ],
      }),
    });
    const secretProducer = runAArch64PostSelectionCse({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n, security: secret }),
          aarch64MovzForPlanningTest({ instructionId: 2, output: 2, value: 7n }),
        ],
      }),
    });

    expect(planningOpcodes(callBoundary)).toEqual(["movz", "bl", "movz"]);
    expect(planningOpcodes(secretProducer)).toEqual(["movz", "movz"]);
  });
});

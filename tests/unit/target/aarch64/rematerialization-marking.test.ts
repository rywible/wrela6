import { describe, expect, test } from "bun:test";
import { aarch64SecurityMetadata } from "../../../../src/target/aarch64/machine-ir/security";
import { markAArch64RematerializationForPlanningState } from "../../../../src/target/aarch64/plan/rematerialization-marking";
import {
  aarch64AddImmediateForPlanningTest,
  aarch64AdrpForPlanningTest,
  aarch64MovzForPlanningTest,
  aarch64PlanningStateForTest,
} from "../../../support/target/aarch64/machine-ir/planning-state-builders";

describe("AArch64 rematerialization marking", () => {
  test("marks public constants and page bases with cost and relocation context", () => {
    const planned = markAArch64RematerializationForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n }),
          aarch64AdrpForPlanningTest({ instructionId: 2, output: 2, symbol: "rodata.table" }),
        ],
      }),
    });

    expect(planned.revision).toBe(1);
    expect(planned.machineFunction.rematerializationPlan).toHaveLength(2);
    expect(planned.machineFunction.rematerializationPlan.map((record) => record.kind)).toEqual([
      "constant",
      "symbolPageBase",
    ]);
    expect(planned.machineFunction.rematerializationPlan[1]?.relocationReferences).toEqual([
      "PAGE:rodata.table",
    ]);
  });

  test("rejects rematerialization for secret producers and pressure threshold breaches", () => {
    const secret = aarch64SecurityMetadata({
      labels: [{ kind: "keyLifetime", key: "session" }],
      constantTime: true,
      spillPolicy: "noSpill",
    });
    const planned = markAArch64RematerializationForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({
            instructionId: 1,
            output: 1,
            value: 7n,
            security: secret,
          }),
          aarch64MovzForPlanningTest({
            instructionId: 2,
            output: 2,
            value: 9n,
            pressure: 9,
          }),
        ],
      }),
      pressureThreshold: 4,
    });

    expect(planned.machineFunction.rematerializationPlan).toEqual([]);
  });

  test("rejects rematerialization for register-dependent address adds", () => {
    const planned = markAArch64RematerializationForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64MovzForPlanningTest({ instructionId: 1, output: 1, value: 7n }),
          aarch64AddImmediateForPlanningTest({
            instructionId: 2,
            output: 2,
            source: 1,
            value: 16n,
          }),
        ],
      }),
    });

    expect(
      planned.machineFunction.rematerializationPlan.map((record) => Number(record.producer)),
    ).toEqual([1]);
  });
});

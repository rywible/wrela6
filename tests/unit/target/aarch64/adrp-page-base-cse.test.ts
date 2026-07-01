import { describe, expect, test } from "bun:test";
import { aarch64SecurityMetadata } from "../../../../src/target/aarch64/machine-ir/security";
import { shareAArch64AdrpPageBasesForPlanningState } from "../../../../src/target/aarch64/plan/adrp-page-base-cse";
import {
  aarch64AddImmediateForPlanningTest,
  aarch64AdrpForPlanningTest,
  aarch64CallForPlanningTest,
  aarch64PlanningStateForTest,
  planningOpcodes,
} from "../../../support/target/aarch64/machine-ir/planning-state-builders";

describe("AArch64 ADRP page-base CSE", () => {
  test("shares same-page ADRP producers inside one block", () => {
    const planned = shareAArch64AdrpPageBasesForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64AdrpForPlanningTest({ instructionId: 1, output: 1, symbol: "rodata.table" }),
          aarch64AdrpForPlanningTest({ instructionId: 2, output: 2, symbol: "rodata.table" }),
          aarch64AddImmediateForPlanningTest({
            instructionId: 3,
            output: 3,
            source: 2,
            value: 8n,
          }),
        ],
      }),
    });

    const add = planned.machineFunction.blocks[0]?.instructions[1];
    expect(planningOpcodes(planned)).toEqual(["adrp", "add-immediate"]);
    expect(
      add?.operands.some(
        (operand) =>
          operand.role === "use" &&
          operand.operand.kind === "vreg" &&
          operand.operand.register.vreg === 1,
      ),
    ).toBe(true);
  });

  test("rejects page mismatch, call boundary, section mismatch, and secret page bases", () => {
    const secret = aarch64SecurityMetadata({
      labels: [{ kind: "secret", key: "page" }],
      constantTime: true,
      spillPolicy: "noSpill",
    });
    const mismatch = shareAArch64AdrpPageBasesForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64AdrpForPlanningTest({ instructionId: 1, output: 1, symbol: "rodata.a" }),
          aarch64AdrpForPlanningTest({ instructionId: 2, output: 2, symbol: "data.b" }),
        ],
      }),
      policy: { samePage: () => false },
    });
    const callBoundary = shareAArch64AdrpPageBasesForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64AdrpForPlanningTest({ instructionId: 1, output: 1, symbol: "rodata.a" }),
          aarch64CallForPlanningTest(2),
          aarch64AdrpForPlanningTest({ instructionId: 3, output: 2, symbol: "rodata.a" }),
        ],
      }),
    });
    const sectionMismatch = shareAArch64AdrpPageBasesForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64AdrpForPlanningTest({ instructionId: 1, output: 1, symbol: "rodata.a" }),
          aarch64AdrpForPlanningTest({ instructionId: 2, output: 2, symbol: "rodata.a" }),
        ],
      }),
      policy: {
        sectionKeyForSymbol: (symbol) => (symbol.endsWith(".a") ? "rodata" : "data"),
        loopDepthForInstruction: (instruction) => Number(instruction.instructionId),
      },
    });
    const secretBase = shareAArch64AdrpPageBasesForPlanningState({
      state: aarch64PlanningStateForTest({
        instructions: [
          aarch64AdrpForPlanningTest({
            instructionId: 1,
            output: 1,
            symbol: "rodata.a",
            security: secret,
          }),
          aarch64AdrpForPlanningTest({ instructionId: 2, output: 2, symbol: "rodata.a" }),
        ],
      }),
    });

    expect(planningOpcodes(mismatch)).toEqual(["adrp", "adrp"]);
    expect(planningOpcodes(callBoundary)).toEqual(["adrp", "bl", "adrp"]);
    expect(planningOpcodes(sectionMismatch)).toEqual(["adrp", "adrp"]);
    expect(planningOpcodes(secretBase)).toEqual(["adrp", "adrp"]);
  });
});

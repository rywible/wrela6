import { describe, expect, test } from "bun:test";
import { chooseAArch64BranchShape } from "../../../../src/target/aarch64/lower/branch-switch-profitability";

describe("AArch64 branch profitability policy", () => {
  test("predictable validation branch stays branchy", () => {
    expect(
      chooseAArch64BranchShape({
        chainLength: 2,
        takenPermille: 950,
        nzcvSerialCost: 2,
        ifConversionLegal: true,
      }),
    ).toMatchObject({
      kind: "predictedBranches",
      reason: "hot-predictable-edge",
      patternId: "branch.test-and-conditional",
    });
  });

  test("short unpredictable legal diamond chooses if-conversion", () => {
    expect(
      chooseAArch64BranchShape({
        chainLength: 1,
        takenPermille: 500,
        nzcvSerialCost: 2,
        ifConversionLegal: true,
      }),
    ).toMatchObject({
      kind: "ifConverted",
      reason: "short-unpredictable-diamond",
      patternId: "branch.ccmp-csel",
    });
  });

  test("missing legality falls back to deterministic branchy lowering", () => {
    expect(
      chooseAArch64BranchShape({
        chainLength: 1,
        nzcvSerialCost: 2,
        ifConversionLegal: false,
      }),
    ).toMatchObject({
      kind: "predictedBranches",
      reason: "missing-probability-or-illegal-if-conversion",
      patternId: "branch.test-and-conditional",
    });
  });
});

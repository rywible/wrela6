import { describe, expect, test } from "bun:test";
import { chooseAArch64SwitchShape } from "../../../../src/target/aarch64/lower/branch-switch-profitability";

describe("AArch64 switch lowering policy", () => {
  test("dense switches choose jump tables", () => {
    expect(
      chooseAArch64SwitchShape({
        caseCount: 4,
        valueSpan: 4n,
        densityPermille: 1000,
      }),
    ).toBe("jumpTable");
  });

  test("small switches choose compare trees", () => {
    expect(
      chooseAArch64SwitchShape({
        caseCount: 3,
        valueSpan: 64n,
        densityPermille: 46,
      }),
    ).toBe("compareTree");
  });

  test("larger compact switches choose bit-test trees", () => {
    expect(
      chooseAArch64SwitchShape({
        caseCount: 6,
        valueSpan: 32n,
        densityPermille: 187,
      }),
    ).toBe("bitTestTree");
  });

  test("large sparse switches choose hot-case split fallback", () => {
    expect(
      chooseAArch64SwitchShape({
        caseCount: 6,
        valueSpan: 1_000n,
        densityPermille: 6,
      }),
    ).toBe("hotCaseSplit");
  });
});

import { describe, expect, test } from "bun:test";
import {
  resetStableNumericSeedsForTest,
  stableNumericSeed,
} from "../../../src/proof-check/stable-numeric-seed";

describe("stableNumericSeed", () => {
  test("does not collapse distinct ownership seeds into the same bucket", () => {
    expect(stableNumericSeed("ownership:place:550")).not.toBe(
      stableNumericSeed("ownership:place:28006"),
    );
  });

  test("returns a positive 32-bit hash", () => {
    const seed = stableNumericSeed("proof-check:seed");
    expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThanOrEqual(0xffff_ffff);
  });

  test("fails closed when distinct seeds collide", () => {
    resetStableNumericSeedsForTest();
    stableNumericSeed("collision:Aa");
    expect(() => stableNumericSeed("collision:BB")).toThrow(/collision/);
  });
});

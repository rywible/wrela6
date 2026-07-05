import { describe, expect, test } from "bun:test";

import { allocationRegisterPools } from "../../../src/target/aarch64/backend/api/function-pipeline/allocation-stage";
import { createAArch64Rpi5PhysicalRegisterModel } from "../../../src/target/aarch64/backend/api/physical-register-model";

describe("W1-01c/W5-01 SIMD callee-saved policy", () => {
  test("models only the low public SIMD callee-saved lanes", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();

    expect(registerModel.publicCalleeSavedSimd).toEqual([
      "d8",
      "d9",
      "d10",
      "d11",
      "d12",
      "d13",
      "d14",
      "d15",
    ]);
  });

  test("includes public SIMD callee-saved registers after preservation support lands", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();

    const pools = allocationRegisterPools({ registerModel });

    expect(pools.vectors).toContain("v8");
    expect(pools.vectors).toContain("v15");
    expect(pools.fps).toContain("d8");
    expect(pools.fps).toContain("d15");
    expect(pools.vectors).toContain("v16");
    expect(pools.fps).toContain("d16");
  });
});

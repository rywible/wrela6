import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64TargetDriverSurface,
  productionUefiAArch64OptIrTargetSurface,
} from "../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("W1-09a target-owned endian fold contract", () => {
  test("UEFI AArch64 OptIR target surface owns the endian fold contract", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") {
      throw new Error("Expected UEFI AArch64 target fixture to authenticate.");
    }

    const surface = productionUefiAArch64OptIrTargetSurface(target.value);

    expect(surface.endianFoldContract).toEqual({
      permitsFirmwareEndianFold: false,
      permitsVolatileEndianFold: false,
    });
    expect(Object.isFrozen(surface.endianFoldContract)).toBe(true);
  });
});

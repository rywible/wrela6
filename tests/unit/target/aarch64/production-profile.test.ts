import { describe, expect, test } from "bun:test";
import {
  WRELA_UEFI_AARCH64_RPI5_PROFILE_ID,
  authenticateAArch64ProductionProfile,
  computeAArch64ProductionProfileFingerprint,
} from "../../../../src/target/aarch64/target-surface/production-profile";
import {
  fakeAArch64ProductionProfile,
  productionFeaturesExcept,
} from "../../../support/target/aarch64/target-surface/fakes";

describe("wrela UEFI AArch64 Raspberry Pi 5 production profile", () => {
  test("accepts exactly the production profile with required features and tuning", () => {
    const result = authenticateAArch64ProductionProfile(fakeAArch64ProductionProfile());

    expect(result).toEqual({
      kind: "ok",
      profileId: WRELA_UEFI_AARCH64_RPI5_PROFILE_ID,
      fingerprint: computeAArch64ProductionProfileFingerprint(fakeAArch64ProductionProfile()),
    });
  });

  test("rejects a non-production profile id", () => {
    const result = authenticateAArch64ProductionProfile(
      fakeAArch64ProductionProfile({ profileId: "experimental-aarch64" }),
    );

    if (result.kind !== "error") {
      throw new Error("expected production profile authentication to fail");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "profile:experimental-aarch64:unsupported-profile",
    ]);
  });

  test("rejects missing required features", () => {
    const result = authenticateAArch64ProductionProfile(
      fakeAArch64ProductionProfile({
        requiredFeatures: productionFeaturesExcept("FEAT_LSE"),
      }),
    );

    if (result.kind !== "error") {
      throw new Error("expected production profile authentication to fail");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "profile:wrela-uefi-aarch64-rpi5-v1:missing-feature:FEAT_LSE",
    ]);
  });

  test("rejects requested out-of-profile extension families", () => {
    const result = authenticateAArch64ProductionProfile(
      fakeAArch64ProductionProfile({ requestedExtensionFamilies: ["SVE", "MTE"] }),
    );

    if (result.kind !== "error") {
      throw new Error("expected production profile authentication to fail");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "profile:wrela-uefi-aarch64-rpi5-v1:out-of-profile-family:MTE",
      "profile:wrela-uefi-aarch64-rpi5-v1:out-of-profile-family:SVE",
    ]);
  });

  test("rejects missing UEFI, VirtIO, and expected tuning model", () => {
    const result = authenticateAArch64ProductionProfile(
      fakeAArch64ProductionProfile({
        imageProfile: "elf",
        deviceModel: "mmio-only",
        tuningModel: "generic-aarch64",
      }),
    );

    if (result.kind !== "error") {
      throw new Error("expected production profile authentication to fail");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "profile:wrela-uefi-aarch64-rpi5-v1:invalid-image-profile:elf",
      "profile:wrela-uefi-aarch64-rpi5-v1:invalid-device-model:mmio-only",
      "profile:wrela-uefi-aarch64-rpi5-v1:invalid-tuning-model:generic-aarch64",
    ]);
  });
});

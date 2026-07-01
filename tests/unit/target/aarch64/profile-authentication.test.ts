import { describe, expect, test } from "bun:test";
import {
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
  aarch64TargetFingerprint,
} from "../../../../src/target/aarch64/target-surface/target-surface";
import { authenticateAArch64TargetSurface } from "../../../../src/target/aarch64/target-surface/profile-authentication";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("aarch64 target surface authentication", () => {
  test("records deterministic component fingerprints in the aggregate fingerprint", () => {
    const first = authenticateAArch64TargetSurface(fakeAArch64TargetSurface());
    const second = authenticateAArch64TargetSurface(fakeAArch64TargetSurface());

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") {
      throw new Error("expected authenticated target surfaces");
    }

    expect(first.componentFingerprints).toEqual(EXPECTED_AARCH64_COMPONENT_FINGERPRINTS);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toBe(
      aarch64TargetFingerprint(
        "aarch64-target:surface:wrela-uefi-aarch64-rpi5-v1:e28c4092bd29227a",
      ),
    );
  });

  test("combines profile and component diagnostics deterministically", () => {
    const result = authenticateAArch64TargetSurface(
      fakeAArch64TargetSurface({
        selectionFingerprint: aarch64TargetFingerprint("aarch64-target:selection:unexpected"),
        platformFingerprint: aarch64TargetFingerprint("aarch64-target:platform:unexpected"),
      }),
    );

    if (result.kind !== "error") {
      throw new Error("expected target surface authentication to fail");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "surface:wrela-uefi-aarch64-rpi5-v1:component-fingerprint:platform:expected:aarch64-target:platform:uefi-virtio-rpi5-v1:384b5340d5389998:actual:aarch64-target:platform:unexpected",
      "surface:wrela-uefi-aarch64-rpi5-v1:component-fingerprint:selection:expected:aarch64-target:selection:armv8.2-a-rpi5-v1:f6c81c3a5331b552:actual:aarch64-target:selection:unexpected",
    ]);
  });

  test("uses the machine-id fingerprint constructor for target fingerprints", () => {
    expect(() => aarch64TargetFingerprint("")).toThrow(
      "AArch64TargetFingerprint must be non-empty.",
    );
    expect(() => aarch64TargetFingerprint(" aarch64-target:abi:space ")).toThrow(
      "AArch64TargetFingerprint must not have leading or trailing whitespace.",
    );
  });
});

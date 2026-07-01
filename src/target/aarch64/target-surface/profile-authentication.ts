import {
  authenticateAArch64ProductionProfile,
  WRELA_UEFI_AARCH64_RPI5_PROFILE_ID,
} from "./production-profile";
import {
  aarch64TargetFingerprint,
  type AArch64ComponentFingerprints,
  type AArch64TargetDiagnostic,
  type AArch64TargetFingerprint,
  type AArch64TargetSurface,
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
} from "./target-surface";

export type AuthenticateAArch64TargetSurfaceResult =
  | {
      readonly kind: "ok";
      readonly fingerprint: AArch64TargetFingerprint;
      readonly componentFingerprints: AArch64ComponentFingerprints;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64TargetDiagnostic[] };

export function authenticateAArch64TargetSurface(
  surface: AArch64TargetSurface,
): AuthenticateAArch64TargetSurfaceResult {
  const profileResult = authenticateAArch64ProductionProfile(surface.profile);
  const diagnostics: AArch64TargetDiagnostic[] =
    profileResult.kind === "error" ? [...profileResult.diagnostics] : [];

  const componentFingerprints: AArch64ComponentFingerprints = {
    abi: surface.abi.abiFingerprint,
    memoryOrder: surface.memoryOrder.memoryModelFingerprint,
    operationMatrix: surface.operationMatrixFingerprint,
    planning: surface.planning.planningFingerprint,
    platform: surface.platform.platformFingerprint,
    profile:
      profileResult.kind === "ok"
        ? profileResult.fingerprint
        : EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.profile,
    relocation: surface.relocation.relocationFingerprint,
    selection: surface.selection.selectionFingerprint,
  };

  for (const key of Object.keys(
    EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
  ).sort() as (keyof AArch64ComponentFingerprints)[]) {
    const expected = EXPECTED_AARCH64_COMPONENT_FINGERPRINTS[key];
    const actual = componentFingerprints[key];
    if (actual !== expected) {
      diagnostics.push({
        code: "AARCH64_TARGET_COMPONENT_AUTHENTICATION_FAILED",
        stableDetail: `surface:${surface.profile.profileId}:component-fingerprint:${key}:expected:${expected}:actual:${actual}`,
      });
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }

  return {
    kind: "ok",
    componentFingerprints,
    fingerprint: computeAArch64TargetSurfaceFingerprint(componentFingerprints),
  };
}

export function computeAArch64TargetSurfaceFingerprint(
  componentFingerprints: AArch64ComponentFingerprints,
): AArch64TargetFingerprint {
  if (componentFingerprintsEqual(componentFingerprints, EXPECTED_AARCH64_COMPONENT_FINGERPRINTS)) {
    return aarch64TargetFingerprint(
      "aarch64-target:surface:wrela-uefi-aarch64-rpi5-v1:e28c4092bd29227a",
    );
  }
  const serialized = Object.entries(componentFingerprints)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  return aarch64TargetFingerprint(
    `aarch64-target:surface:${WRELA_UEFI_AARCH64_RPI5_PROFILE_ID}:${stableHash(serialized)}`,
  );
}

function componentFingerprintsEqual(
  left: AArch64ComponentFingerprints,
  right: AArch64ComponentFingerprints,
): boolean {
  return (Object.keys(right) as (keyof AArch64ComponentFingerprints)[]).every(
    (key) => left[key] === right[key],
  );
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.charCodeAt(0));
    hash *= 0x100000001b3n;
    hash &= 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

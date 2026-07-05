import {
  aarch64TargetFingerprint,
  type AArch64TargetDiagnostic,
  type AArch64TargetFingerprint,
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
} from "./target-surface";
import { stableHash } from "../../../shared/stable-json";

export const WRELA_UEFI_AARCH64_RPI5_PROFILE_ID = "wrela-uefi-aarch64-rpi5-v1";

export const WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES = [
  "BASE_A64",
  "Armv8.2-A",
  "FEAT_LSE",
  "FEAT_CRC32",
  "FEAT_AdvSIMD",
  "FEAT_FP",
  "FEAT_AES",
  "FEAT_SHA",
  "FEAT_SHA1",
  "FEAT_SHA256",
  "FEAT_PMULL",
  "FEAT_FP16",
  "FEAT_RDM",
  "FEAT_DotProd",
] as const;

const OUT_OF_PROFILE_EXTENSION_FAMILIES = ["BTI", "MOPS", "MTE", "PAuth", "SVE", "SVE2"] as const;
const OUT_OF_PROFILE_EXTENSION_FAMILY_SET: ReadonlySet<string> = new Set(
  OUT_OF_PROFILE_EXTENSION_FAMILIES,
);

export interface AArch64ProductionProfile {
  readonly profileId: string;
  readonly architecture: string;
  readonly instructionSet: string;
  readonly imageProfile: string;
  readonly deviceModel: string;
  readonly tuningModel: string;
  readonly requiredFeatures: readonly string[];
  readonly requestedExtensionFamilies: readonly string[];
}

export type AuthenticateAArch64ProductionProfileResult =
  | {
      readonly kind: "ok";
      readonly profileId: typeof WRELA_UEFI_AARCH64_RPI5_PROFILE_ID;
      readonly fingerprint: AArch64TargetFingerprint;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64TargetDiagnostic[] };

export function computeAArch64ProductionProfileFingerprint(
  profile: AArch64ProductionProfile,
): AArch64TargetFingerprint {
  if (isCanonicalProductionProfile(profile)) {
    return EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.profile;
  }
  return aarch64TargetFingerprint(
    `aarch64-target:profile:${profile.profileId}:${stableHash(stableSerialize(profile))}`,
  );
}

export function authenticateAArch64ProductionProfile(
  profile: AArch64ProductionProfile,
): AuthenticateAArch64ProductionProfileResult {
  const diagnostics: AArch64TargetDiagnostic[] = [];

  if (profile.profileId !== WRELA_UEFI_AARCH64_RPI5_PROFILE_ID) {
    diagnostics.push(diagnostic(`profile:${profile.profileId}:unsupported-profile`));
  }

  for (const feature of WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES) {
    if (!profile.requiredFeatures.includes(feature)) {
      diagnostics.push(diagnostic(`profile:${profile.profileId}:missing-feature:${feature}`));
    }
  }

  if (profile.architecture !== "Armv8.2-A") {
    diagnostics.push(
      diagnostic(`profile:${profile.profileId}:invalid-architecture:${profile.architecture}`),
    );
  }
  if (profile.instructionSet !== "raspberry-pi-5-class") {
    diagnostics.push(
      diagnostic(`profile:${profile.profileId}:invalid-instruction-set:${profile.instructionSet}`),
    );
  }
  if (profile.imageProfile !== "uefi-pe-coff") {
    diagnostics.push(
      diagnostic(`profile:${profile.profileId}:invalid-image-profile:${profile.imageProfile}`),
    );
  }
  if (profile.deviceModel !== "virtio") {
    diagnostics.push(
      diagnostic(`profile:${profile.profileId}:invalid-device-model:${profile.deviceModel}`),
    );
  }
  if (profile.tuningModel !== "cortex-a76-rpi5-like") {
    diagnostics.push(
      diagnostic(`profile:${profile.profileId}:invalid-tuning-model:${profile.tuningModel}`),
    );
  }

  const requestedOutOfProfile = profile.requestedExtensionFamilies
    .filter((family) => OUT_OF_PROFILE_EXTENSION_FAMILY_SET.has(family))
    .sort();
  for (const family of requestedOutOfProfile) {
    diagnostics.push(diagnostic(`profile:${profile.profileId}:out-of-profile-family:${family}`));
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }

  return {
    kind: "ok",
    profileId: WRELA_UEFI_AARCH64_RPI5_PROFILE_ID,
    fingerprint: computeAArch64ProductionProfileFingerprint(profile),
  };
}

function isCanonicalProductionProfile(profile: AArch64ProductionProfile): boolean {
  return (
    profile.profileId === WRELA_UEFI_AARCH64_RPI5_PROFILE_ID &&
    profile.architecture === "Armv8.2-A" &&
    profile.instructionSet === "raspberry-pi-5-class" &&
    profile.imageProfile === "uefi-pe-coff" &&
    profile.deviceModel === "virtio" &&
    profile.tuningModel === "cortex-a76-rpi5-like" &&
    WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES.every((feature) =>
      profile.requiredFeatures.includes(feature),
    ) &&
    profile.requestedExtensionFamilies.length === 0
  );
}

function diagnostic(stableDetail: string): AArch64TargetDiagnostic {
  return { code: "AARCH64_PROFILE_AUTHENTICATION_FAILED", stableDetail };
}

function stableSerialize(value: AArch64ProductionProfile): string {
  return JSON.stringify({
    architecture: value.architecture,
    deviceModel: value.deviceModel,
    imageProfile: value.imageProfile,
    instructionSet: value.instructionSet,
    profileId: value.profileId,
    requestedExtensionFamilies: [...value.requestedExtensionFamilies].sort(),
    requiredFeatures: [...value.requiredFeatures].sort(),
    tuningModel: value.tuningModel,
  });
}

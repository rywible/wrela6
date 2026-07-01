import {
  WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES,
  type AArch64ProductionProfile,
} from "../../../../../src/target/aarch64/target-surface/production-profile";
import {
  EXPECTED_AARCH64_COMPONENT_FINGERPRINTS,
  type AArch64TargetFingerprint,
  type AArch64TargetSurface,
} from "../../../../../src/target/aarch64/target-surface/target-surface";
import { createAArch64Aapcs64AbiTargetSurface } from "../../../../../src/target/aarch64/lower/abi-lowering";

export function productionFeaturesExcept(
  feature: (typeof WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES)[number],
): readonly string[] {
  return WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES.filter((candidate) => candidate !== feature);
}

export function fakeAArch64ProductionProfile(
  overrides: Partial<AArch64ProductionProfile> = {},
): AArch64ProductionProfile {
  return {
    profileId: "wrela-uefi-aarch64-rpi5-v1",
    architecture: "Armv8.2-A",
    instructionSet: "raspberry-pi-5-class",
    imageProfile: "uefi-pe-coff",
    deviceModel: "virtio",
    tuningModel: "cortex-a76-rpi5-like",
    requiredFeatures: WRELA_UEFI_AARCH64_RPI5_REQUIRED_FEATURES,
    requestedExtensionFamilies: [],
    ...overrides,
  };
}

export function fakeAArch64TargetSurface(
  overrides: Partial<AArch64TargetSurface> & {
    readonly selectionFingerprint?: AArch64TargetFingerprint;
    readonly platformFingerprint?: AArch64TargetFingerprint;
  } = {},
): AArch64TargetSurface {
  const { selectionFingerprint, platformFingerprint, ...surfaceOverrides } = overrides;
  return {
    profile: fakeAArch64ProductionProfile(),
    selection: {
      selectionFingerprint:
        selectionFingerprint ?? EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.selection,
      fpEnvironment: {
        rounding: "nearestTiesToEven",
        exceptionFlagsObservable: false,
        flushToZero: false,
        defaultNaN: false,
        signedZero: "preserve",
        nanPayload: "preserve",
      },
    },
    abi: createAArch64Aapcs64AbiTargetSurface(),
    relocation: { relocationFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.relocation },
    memoryOrder: {
      memoryModel: "armv8.2-a-release-acquire",
      memoryModelFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.memoryOrder,
    },
    planning: { planningFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.planning },
    platform: {
      platformFingerprint: platformFingerprint ?? EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.platform,
    },
    operationMatrixFingerprint: EXPECTED_AARCH64_COMPONENT_FINGERPRINTS.operationMatrix,
    ...surfaceOverrides,
  };
}

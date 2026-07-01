import type { OptIrCallId } from "../../../opt-ir/ids";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import { aarch64TargetFingerprint, type AArch64TargetFingerprint } from "../machine-ir/ids";
import type { AArch64CallClobberRecord } from "../machine-ir/machine-function";
import type { AArch64RegisterClass } from "../machine-ir/machine-types";
import type { AArch64ProductionProfile } from "./production-profile";

export { aarch64TargetFingerprint };
export type { AArch64TargetFingerprint };

export type AArch64MemoryModel = "armv8.2-a-release-acquire";

export type AArch64TargetDiagnosticCode =
  | "AARCH64_PROFILE_AUTHENTICATION_FAILED"
  | "AARCH64_TARGET_COMPONENT_AUTHENTICATION_FAILED"
  | "AARCH64_OPERATION_MATRIX_MISSING_KIND"
  | "AARCH64_OPERATION_TARGET_MISMATCH"
  | "AARCH64_PROOF_ERASURE_HANDOFF_FAILED";

export interface AArch64TargetDiagnostic {
  readonly code: AArch64TargetDiagnosticCode;
  readonly stableDetail: string;
}

export interface AArch64SelectionTargetSurface {
  readonly selectionFingerprint: AArch64TargetFingerprint;
  readonly fpEnvironment: AArch64FpEnvironmentTargetSurface;
}

export interface AArch64FpEnvironmentTargetSurface {
  readonly rounding: "nearestTiesToEven" | "towardZero" | "towardPositive" | "towardNegative";
  readonly exceptionFlagsObservable: boolean;
  readonly flushToZero: boolean;
  readonly defaultNaN: boolean;
  readonly signedZero: "preserve" | "ignore";
  readonly nanPayload: "preserve" | "default";
}

export type AArch64AbiConvention = "aapcs64" | "custom";

export type AArch64AbiSignatureRole = "parameters" | "returns" | "callArguments" | "callReturns";

export interface AArch64AbiSignatureValueInput {
  readonly registerClass: AArch64RegisterClass;
  readonly valueKey?: string;
  readonly aggregateBytes?: number;
}

export interface AArch64AbiSignatureClassificationInput {
  readonly role: AArch64AbiSignatureRole;
  readonly values: readonly AArch64AbiSignatureValueInput[];
  readonly reservedIntegerRegisters?: number;
  readonly callId?: OptIrCallId;
  readonly convention?: AArch64AbiConvention;
  readonly customAgreementKey?: string;
}

export interface AArch64AbiSignatureClassification {
  readonly authorityFingerprint: AArch64TargetFingerprint;
  readonly convention: AArch64AbiConvention;
  readonly locations: readonly AArch64AbiLocation[];
  readonly stackArgumentAreaSizeBytes: number;
}

export interface AArch64CallClobberClassificationInput {
  readonly callId?: OptIrCallId;
  readonly convention: AArch64AbiConvention;
  readonly customAgreementKey?: string;
  readonly memoryEffects?: readonly string[];
}

export interface AArch64CallClobberClassification {
  readonly authorityFingerprint: AArch64TargetFingerprint;
  readonly callClobbers: AArch64CallClobberRecord;
  readonly stackAlignmentBytes: 16;
  readonly redZone: false;
}

export interface AArch64AbiTargetSurface {
  readonly abiFingerprint: AArch64TargetFingerprint;
  readonly classifySignature: (
    input: AArch64AbiSignatureClassificationInput,
  ) => AArch64AbiSignatureClassification;
  readonly classifyCallClobbers: (
    input: AArch64CallClobberClassificationInput,
  ) => AArch64CallClobberClassification;
}

export interface AArch64RelocationTargetSurface {
  readonly relocationFingerprint: AArch64TargetFingerprint;
}

export interface AArch64MemoryOrderTargetSurface {
  readonly memoryModelFingerprint: AArch64TargetFingerprint;
  readonly memoryModel: AArch64MemoryModel;
}

export interface AArch64PlanningTargetSurface {
  readonly planningFingerprint: AArch64TargetFingerprint;
}

export interface AArch64PlatformTargetSurface {
  readonly platformFingerprint: AArch64TargetFingerprint;
}

export interface AArch64TargetSurface {
  readonly profile: AArch64ProductionProfile;
  readonly selection: AArch64SelectionTargetSurface;
  readonly abi: AArch64AbiTargetSurface;
  readonly relocation: AArch64RelocationTargetSurface;
  readonly memoryOrder: AArch64MemoryOrderTargetSurface;
  readonly planning: AArch64PlanningTargetSurface;
  readonly platform: AArch64PlatformTargetSurface;
  readonly operationMatrixFingerprint: AArch64TargetFingerprint;
}

export interface AArch64ComponentFingerprints {
  readonly abi: AArch64TargetFingerprint;
  readonly memoryOrder: AArch64TargetFingerprint;
  readonly operationMatrix: AArch64TargetFingerprint;
  readonly planning: AArch64TargetFingerprint;
  readonly platform: AArch64TargetFingerprint;
  readonly profile: AArch64TargetFingerprint;
  readonly relocation: AArch64TargetFingerprint;
  readonly selection: AArch64TargetFingerprint;
}

export const EXPECTED_AARCH64_COMPONENT_FINGERPRINTS: AArch64ComponentFingerprints = Object.freeze({
  abi: aarch64TargetFingerprint("aarch64-target:abi:uefi-aapcs64-v1:7b9415464b64d711"),
  memoryOrder: aarch64TargetFingerprint(
    "aarch64-target:memory-order:armv8.2-a-release-acquire-v1:3fc3f18e5f89d8fd",
  ),
  operationMatrix: aarch64TargetFingerprint(
    "aarch64-target:operation-matrix:wrela-uefi-aarch64-rpi5-v1:6c9e4b95f1b64b4b",
  ),
  planning: aarch64TargetFingerprint(
    "aarch64-target:planning:cortex-a76-rpi5-like-v1:130a0f4812fb42a6",
  ),
  platform: aarch64TargetFingerprint(
    "aarch64-target:platform:uefi-virtio-rpi5-v1:384b5340d5389998",
  ),
  profile: aarch64TargetFingerprint(
    "aarch64-target:profile:wrela-uefi-aarch64-rpi5-v1:f4f89ca040156432",
  ),
  relocation: aarch64TargetFingerprint(
    "aarch64-target:relocation:pe-coff-aa64-v1:9fe2c7ff7dc39d03",
  ),
  selection: aarch64TargetFingerprint(
    "aarch64-target:selection:armv8.2-a-rpi5-v1:f6c81c3a5331b552",
  ),
});

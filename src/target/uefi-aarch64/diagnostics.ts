import { compareCodeUnitStrings } from "../../shared/deterministic-sort";

export type UefiAArch64TargetDiagnosticCode =
  | "UEFI_AARCH64_TARGET_AUTH_FAILED"
  | "UEFI_AARCH64_ENTRY_THUNK_FAILED"
  | "UEFI_AARCH64_FIRMWARE_ABI_FAILED"
  | "UEFI_AARCH64_STATUS_CONVERSION_FAILED"
  | "UEFI_AARCH64_PIPELINE_FAILED"
  | "UEFI_AARCH64_ARTIFACT_SINK_FAILED"
  | "UEFI_AARCH64_SMOKE_FAILED";

export interface UefiAArch64TargetDiagnostic {
  readonly code: UefiAArch64TargetDiagnosticCode;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export interface UefiAArch64TargetDiagnosticInput {
  readonly code: UefiAArch64TargetDiagnosticCode;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export function uefiAArch64TargetDiagnostic(
  input: UefiAArch64TargetDiagnosticInput,
): UefiAArch64TargetDiagnostic {
  return Object.freeze({
    code: input.code,
    ownerKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

export function sortUefiAArch64TargetDiagnostics(
  diagnostics: readonly UefiAArch64TargetDiagnostic[],
): readonly UefiAArch64TargetDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort((left, right) => compareUefiAArch64TargetDiagnostics(left, right)),
  );
}

function compareUefiAArch64TargetDiagnostics(
  left: UefiAArch64TargetDiagnostic,
  right: UefiAArch64TargetDiagnostic,
): number {
  const codeOrder = compareDiagnosticCode(left.code, right.code);
  if (codeOrder !== 0) return codeOrder;

  const ownerOrder = compareCodeUnitStrings(left.ownerKey, right.ownerKey);
  if (ownerOrder !== 0) return ownerOrder;

  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}

function compareDiagnosticCode(
  left: UefiAArch64TargetDiagnosticCode,
  right: UefiAArch64TargetDiagnosticCode,
): number {
  return diagnosticCodeRank(left) - diagnosticCodeRank(right);
}

function diagnosticCodeRank(code: UefiAArch64TargetDiagnosticCode): number {
  switch (code) {
    case "UEFI_AARCH64_TARGET_AUTH_FAILED":
      return 0;
    case "UEFI_AARCH64_ENTRY_THUNK_FAILED":
      return 1;
    case "UEFI_AARCH64_FIRMWARE_ABI_FAILED":
      return 2;
    case "UEFI_AARCH64_STATUS_CONVERSION_FAILED":
      return 3;
    case "UEFI_AARCH64_PIPELINE_FAILED":
      return 4;
    case "UEFI_AARCH64_ARTIFACT_SINK_FAILED":
      return 5;
    case "UEFI_AARCH64_SMOKE_FAILED":
      return 6;
  }
}

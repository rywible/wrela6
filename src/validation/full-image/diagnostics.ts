import { compareCodeUnitStrings } from "../../shared/deterministic-sort";

export type FullImageValidationDiagnosticCode =
  | "FULL_IMAGE_VALIDATION_MATRIX"
  | "FULL_IMAGE_VALIDATION_REPORT"
  | "FULL_IMAGE_VALIDATION_STAGE_TRAIL"
  | "FULL_IMAGE_PACKAGE_INPUT_FAILED"
  | "FULL_IMAGE_COMPILE_FAILED"
  | "FULL_IMAGE_STAGE_VERIFICATION_FAILED"
  | "FULL_IMAGE_STDLIB_MODE_FAILED"
  | "FULL_IMAGE_BINARY_STRUCTURE_FAILED"
  | "FULL_IMAGE_SELF_CONTAINED_FAILED"
  | "FULL_IMAGE_REFERENCE_CHECK_FAILED"
  | "FULL_IMAGE_QEMU_SMOKE_FAILED"
  | "FULL_IMAGE_DETERMINISM_FAILED";

export interface FullImageValidationDiagnostic {
  readonly ownerKey: string;
  readonly code: FullImageValidationDiagnosticCode;
  readonly stableDetail: string;
}

export function fullImageValidationDiagnostic(
  input: FullImageValidationDiagnostic,
): FullImageValidationDiagnostic {
  return Object.freeze({ ...input });
}

export function sortFullImageValidationDiagnostics(
  diagnostics: readonly FullImageValidationDiagnostic[],
): readonly FullImageValidationDiagnostic[] {
  return Object.freeze(
    diagnostics
      .map((diagnostic) => fullImageValidationDiagnostic(diagnostic))
      .sort((left, right) => compareFullImageValidationDiagnostics(left, right)),
  );
}

function compareFullImageValidationDiagnostics(
  left: FullImageValidationDiagnostic,
  right: FullImageValidationDiagnostic,
): number {
  return (
    compareCodeUnitStrings(left.ownerKey, right.ownerKey) ||
    compareCodeUnitStrings(left.code, right.code) ||
    compareCodeUnitStrings(left.stableDetail, right.stableDetail)
  );
}

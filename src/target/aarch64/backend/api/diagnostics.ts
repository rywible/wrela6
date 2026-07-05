import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";

export const AARCH64_BACKEND_DIAGNOSTIC_CODES = [
  "AARCH64_BACKEND_INPUT_CONTRACT_INVALID",
  "AARCH64_BACKEND_FACT_IMPORT_INVALID",
  "AARCH64_BACKEND_REWRITE_TRANSFER_INVALID",
  "AARCH64_BACKEND_SECURITY_CONSERVATION_FAILED",
  "AARCH64_BACKEND_TARGET_SURFACE_INVALID",
  "AARCH64_BACKEND_CLOSED_IMAGE_PLAN_INVALID",
  "AARCH64_BACKEND_ABI_INVALID",
  "AARCH64_BACKEND_ALLOCATION_FAILED",
  "AARCH64_BACKEND_FRAME_INVALID",
  "AARCH64_FRAME_TOO_LARGE",
  "AARCH64_BACKEND_UNWIND_INVALID",
  "AARCH64_BACKEND_FINALIZATION_INVALID",
  "AARCH64_BACKEND_ENCODING_INVALID",
  "AARCH64_BACKEND_RELOCATION_INVALID",
  "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
  "AARCH64_BACKEND_OBJECT_INVALID",
  "AARCH64_BACKEND_DETERMINISM_INVALID",
] as const;

export type AArch64BackendDiagnosticCode = (typeof AARCH64_BACKEND_DIAGNOSTIC_CODES)[number];
export type AArch64BackendDiagnosticMode = "default" | "debug" | "strict";

export interface AArch64BackendDiagnostic {
  readonly code: AArch64BackendDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: readonly string[];
}

export type AArch64BackendResult<ResultValue> =
  | {
      readonly kind: "ok";
      readonly value: ResultValue;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function aarch64BackendDiagnostic(input: {
  readonly code: AArch64BackendDiagnosticCode;
  readonly stableDetail: string;
  readonly ownerKey?: string;
  readonly rootCauseKey?: string;
  readonly provenance?: readonly string[];
}): AArch64BackendDiagnostic {
  if (!AARCH64_BACKEND_DIAGNOSTIC_CODES.includes(input.code)) {
    throw new RangeError(`unknown AArch64 backend diagnostic code: ${String(input.code)}`);
  }
  return Object.freeze({
    code: input.code,
    ownerKey: input.ownerKey ?? "",
    rootCauseKey: input.rootCauseKey ?? "",
    stableDetail: input.stableDetail,
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

export function sortAArch64BackendDiagnostics(
  diagnostics: readonly AArch64BackendDiagnostic[],
): readonly AArch64BackendDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort((left, right) => {
      for (const [leftPart, rightPart] of [
        [left.code, right.code],
        [left.ownerKey, right.ownerKey],
        [left.rootCauseKey, right.rootCauseKey],
        [left.stableDetail, right.stableDetail],
      ] as const) {
        const order = compareCodeUnitStrings(leftPart, rightPart);
        if (order !== 0) return order;
      }
      return 0;
    }),
  );
}

export function backendOk<ResultValue>(
  value: ResultValue,
  diagnostics: readonly AArch64BackendDiagnostic[] = [],
): AArch64BackendResult<ResultValue> {
  return Object.freeze({
    kind: "ok",
    value,
    diagnostics: sortAArch64BackendDiagnostics(diagnostics),
  });
}

export function backendError(
  diagnostics: readonly AArch64BackendDiagnostic[],
): AArch64BackendResult<never> {
  return Object.freeze({
    kind: "error",
    diagnostics: sortAArch64BackendDiagnostics(diagnostics),
  });
}

export * from "./ids";
export * from "./verification-summary";

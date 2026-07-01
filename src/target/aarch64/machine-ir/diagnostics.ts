import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";

export const AARCH64_LOWERING_DIAGNOSTIC_CODES = [
  "AARCH64_PROFILE_REJECTED",
  "AARCH64_INPUT_CONTRACT_INVALID",
  "AARCH64_OPERATION_MATRIX_MISSING_KIND",
  "AARCH64_OPERATION_TARGET_MISMATCH",
  "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
  "AARCH64_OUT_OF_PROFILE_INSTRUCTION",
  "AARCH64_INSTRUCTION_SCHEMA_MISMATCH",
  "AARCH64_UNDEFINED_VIRTUAL_REGISTER",
  "AARCH64_UNRESOLVED_SYMBOL_REFERENCE",
  "AARCH64_NZCV_USE_WITHOUT_DEF",
  "AARCH64_NZCV_CLOBBERED_BEFORE_USE",
  "AARCH64_ABI_CONTRACT_INVALID",
  "AARCH64_REGION_CONTRACT_INVALID",
  "AARCH64_FACT_PRESERVATION_INVALID",
  "AARCH64_TILING_INVALID",
  "AARCH64_SUPERSELECTION_INVALID",
  "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
  "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
  "AARCH64_FP_ENVIRONMENT_INVALID",
  "AARCH64_SECURITY_CONSTRAINT_INVALID",
] as const;

export type AArch64LoweringDiagnosticCode = (typeof AARCH64_LOWERING_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "AArch64LoweringDiagnosticCode";
};

export type AArch64DiagnosticSeverity = "error" | "warning" | "info";

export interface AArch64LoweringDiagnostic {
  readonly severity: AArch64DiagnosticSeverity;
  readonly code: AArch64LoweringDiagnosticCode;
  readonly messageTemplate: string;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly orderKey: string;
}

const AARCH64_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(AARCH64_LOWERING_DIAGNOSTIC_CODES);

export function aarch64LoweringDiagnosticCode(code: string): AArch64LoweringDiagnosticCode {
  if (!AARCH64_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown AArch64 lowering diagnostic code: ${code}.`);
  }
  return code as AArch64LoweringDiagnosticCode;
}

export function aarch64DiagnosticOrderKey(input: {
  readonly code: AArch64LoweringDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): string {
  return [
    `code:${input.code}`,
    `owner:${input.ownerKey}`,
    `root:${input.rootCauseKey}`,
    `detail:${input.stableDetail}`,
  ].join("/");
}

export function aarch64Diagnostic(input: {
  readonly severity?: AArch64DiagnosticSeverity;
  readonly code: string;
  readonly messageTemplate?: string;
  readonly arguments?: Readonly<Record<string, string | number | boolean>>;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): AArch64LoweringDiagnostic {
  const code = aarch64LoweringDiagnosticCode(input.code);
  const diagnostic = {
    severity: input.severity ?? "error",
    code,
    messageTemplate: input.messageTemplate ?? input.stableDetail,
    arguments: Object.freeze({ ...input.arguments }),
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    orderKey: aarch64DiagnosticOrderKey({
      code,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
  return Object.freeze(diagnostic);
}

export function aarch64DiagnosticForTest(input: {
  readonly code: string;
  readonly ownerKey?: string;
  readonly rootCauseKey?: string;
  readonly stableDetail: string;
}): AArch64LoweringDiagnostic {
  return aarch64Diagnostic({
    code: input.code,
    ownerKey: input.ownerKey ?? "test",
    rootCauseKey: input.rootCauseKey ?? "test",
    stableDetail: input.stableDetail,
  });
}

export function sortAArch64Diagnostics(
  diagnostics: readonly AArch64LoweringDiagnostic[],
): AArch64LoweringDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    compareCodeUnitStrings(left.orderKey, right.orderKey),
  );
}

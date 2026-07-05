import { compareCodeUnitStrings } from "../shared/deterministic-sort";

export const LINKER_DIAGNOSTIC_CODES = [
  "LINKER_INPUT_INVALID",
  "LINKER_SYMBOL_RESOLUTION_FAILED",
  "LINKER_SECTION_LAYOUT_FAILED",
  "LINKER_RELOCATION_FAILED",
  "LINKER_ENTRY_RESOLUTION_FAILED",
  "LINKER_IMAGE_LAYOUT_INVALID",
  "LINKER_LAYOUT_FIRST_SECTION_RVA_MISMATCH",
  "LINKER_LAYOUT_SECTION_CONTIGUITY_MISMATCH",
] as const;

export type LinkerDiagnosticCode = (typeof LINKER_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "LinkerDiagnosticCode";
};

const LINKER_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(LINKER_DIAGNOSTIC_CODES);

export function linkerDiagnosticCode(code: string): LinkerDiagnosticCode {
  if (!LINKER_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown linker diagnostic code: ${code}.`);
  }
  return code as LinkerDiagnosticCode;
}

export type LinkerDiagnosticSeverity = "error" | "warning" | "note";

export type LinkerDiagnosticMode = "default" | "debug" | "strict";

export interface LinkerVerificationSummary {
  readonly runs: readonly LinkerVerifierRun[];
}

export interface LinkerVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export interface LinkerDiagnosticOrder {
  readonly code: LinkerDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: string;
}

export interface LinkerDiagnostic {
  readonly severity: LinkerDiagnosticSeverity;
  readonly code: LinkerDiagnosticCode;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: readonly string[];
  readonly order: LinkerDiagnosticOrder;
}

export interface LinkerDiagnosticInput {
  readonly severity?: LinkerDiagnosticSeverity;
  readonly code: string;
  readonly message?: string;
  readonly ownerKey: string;
  readonly rootCauseKey?: string;
  readonly stableDetail: string;
  readonly provenance?: readonly string[];
}

export type LinkerResult<Value> =
  | {
      readonly kind: "ok";
      readonly value: Value;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    };

export type LinkerOkResult<Value> = {
  readonly kind: "ok";
  readonly value: Value;
  readonly diagnostics: readonly LinkerDiagnostic[];
  readonly verification: LinkerVerificationSummary;
};

export type LinkerErrorResult = {
  readonly kind: "error";
  readonly diagnostics: readonly LinkerDiagnostic[];
  readonly verification: LinkerVerificationSummary;
};

export interface LinkerOkInput<Value> {
  readonly value: Value;
  readonly diagnostics?: readonly LinkerDiagnostic[];
  readonly verification: LinkerVerificationSummary;
}

export interface LinkerErrorInput {
  readonly diagnostics: readonly LinkerDiagnostic[];
  readonly verification: LinkerVerificationSummary;
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareCodeUnitStrings));
}

function diagnosticProvenanceOrder(provenance: readonly string[]): string {
  return `${provenance.map((source) => `${source.length}:${source}`).join("")}|${provenance.length}`;
}

export function linkerDiagnostic(input: LinkerDiagnosticInput): LinkerDiagnostic {
  const validatedCode = linkerDiagnosticCode(input.code);
  const provenance = sortedStrings(input.provenance ?? []);
  const rootCauseKey = input.rootCauseKey ?? input.stableDetail;
  const order: LinkerDiagnosticOrder = Object.freeze({
    code: validatedCode,
    ownerKey: input.ownerKey,
    rootCauseKey,
    stableDetail: input.stableDetail,
    provenance: diagnosticProvenanceOrder(provenance),
  });

  return Object.freeze({
    severity: input.severity ?? "error",
    code: validatedCode,
    message: input.message ?? input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey,
    stableDetail: input.stableDetail,
    provenance,
    order,
  });
}

export function sortLinkerDiagnostics(
  diagnostics: readonly LinkerDiagnostic[],
): readonly LinkerDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort((left, right) => {
      const codeComparison = compareCodeUnitStrings(left.order.code, right.order.code);
      if (codeComparison !== 0) return codeComparison;

      const ownerComparison = compareCodeUnitStrings(left.order.ownerKey, right.order.ownerKey);
      if (ownerComparison !== 0) return ownerComparison;

      const rootCauseComparison = compareCodeUnitStrings(
        left.order.rootCauseKey,
        right.order.rootCauseKey,
      );
      if (rootCauseComparison !== 0) return rootCauseComparison;

      const stableDetailComparison = compareCodeUnitStrings(
        left.order.stableDetail,
        right.order.stableDetail,
      );
      if (stableDetailComparison !== 0) return stableDetailComparison;

      return compareCodeUnitStrings(left.order.provenance, right.order.provenance);
    }),
  );
}

export function linkerVerificationSummary(
  input: LinkerVerificationSummary,
): LinkerVerificationSummary {
  return Object.freeze({
    runs: Object.freeze(input.runs.map((run) => Object.freeze({ ...run }))),
  });
}

export function linkerOk<Value>(input: LinkerOkInput<Value>): LinkerOkResult<Value> {
  return Object.freeze({
    kind: "ok",
    value: input.value,
    diagnostics: sortLinkerDiagnostics(input.diagnostics ?? []),
    verification: linkerVerificationSummary(input.verification),
  });
}

export function linkerError(input: LinkerErrorInput): LinkerErrorResult {
  return Object.freeze({
    kind: "error",
    diagnostics: sortLinkerDiagnostics(input.diagnostics),
    verification: linkerVerificationSummary(input.verification),
  });
}

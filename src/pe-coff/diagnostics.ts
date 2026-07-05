import { compareCodeUnitStrings } from "../shared/deterministic-sort";

export const PE_COFF_WRITER_DIAGNOSTIC_CODES = [
  "PE_COFF_TARGET_AUTH_FAILED",
  "PE_COFF_INPUT_INVALID",
  "PE_COFF_SECTION_PLANNING_FAILED",
  "PE_COFF_DATA_DIRECTORY_PLANNING_FAILED",
  "PE_COFF_RELOCATION_SERIALIZATION_FAILED",
  "PE_COFF_HEADER_PLANNING_FAILED",
  "PE_COFF_SERIALIZATION_FAILED",
  "PE_COFF_PARSE_FAILED",
  "PE_COFF_VERIFICATION_FAILED",
  "PE_COFF_FILE_SINK_FAILED",
] as const;

export type PeCoffWriterDiagnosticCode = (typeof PE_COFF_WRITER_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "PeCoffWriterDiagnosticCode";
};

const PE_COFF_WRITER_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(
  PE_COFF_WRITER_DIAGNOSTIC_CODES,
);

export function peCoffWriterDiagnosticCode(code: string): PeCoffWriterDiagnosticCode {
  if (!PE_COFF_WRITER_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown PE/COFF writer diagnostic code: ${code}.`);
  }
  return code as PeCoffWriterDiagnosticCode;
}

export type PeCoffWriterDiagnosticSeverity = "error" | "warning" | "note";

export interface PeCoffWriterVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export interface PeCoffWriterVerificationSummary {
  readonly runs: readonly PeCoffWriterVerifierRun[];
}

export interface PeCoffWriterDiagnosticOrder {
  readonly code: PeCoffWriterDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: string;
}

export interface PeCoffWriterDiagnostic {
  readonly severity: PeCoffWriterDiagnosticSeverity;
  readonly code: PeCoffWriterDiagnosticCode;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: readonly string[];
  readonly order: PeCoffWriterDiagnosticOrder;
}

export interface PeCoffWriterDiagnosticInput {
  readonly severity?: PeCoffWriterDiagnosticSeverity;
  readonly code: string;
  readonly message?: string;
  readonly ownerKey: string;
  readonly rootCauseKey?: string;
  readonly stableDetail: string;
  readonly provenance?: readonly string[];
}

export type PeCoffWriterResult<Value> = PeCoffWriterOkResult<Value> | PeCoffWriterErrorResult;

export interface PeCoffWriterOkResult<Value> {
  readonly kind: "ok";
  readonly value: Value;
  readonly diagnostics: readonly PeCoffWriterDiagnostic[];
  readonly verification: PeCoffWriterVerificationSummary;
}

export interface PeCoffWriterErrorResult {
  readonly kind: "error";
  readonly diagnostics: readonly PeCoffWriterDiagnostic[];
  readonly verification: PeCoffWriterVerificationSummary;
}

export interface PeCoffWriterOkInput<Value> {
  readonly value: Value;
  readonly diagnostics?: readonly PeCoffWriterDiagnostic[];
  readonly verification: PeCoffWriterVerificationSummary;
}

export interface PeCoffWriterErrorInput {
  readonly diagnostics: readonly PeCoffWriterDiagnostic[];
  readonly verification: PeCoffWriterVerificationSummary;
}

export interface PeCoffEfiDeterministicMetadata {
  readonly schema: "wrela.pe-coff-efi-image";
  readonly schemaVersion: 1;
  readonly linkedLayoutFingerprint: string;
  readonly writerTargetFingerprint: string;
  readonly sectionTableFingerprint: string;
  readonly dataDirectoryFingerprint: string;
  readonly baseRelocationTableFingerprint: string;
  readonly headerFingerprint: string;
  readonly imageFingerprint: string;
}

export interface PeCoffEfiImageArtifact {
  readonly artifactName: string;
  readonly mediaType: "application/vnd.microsoft.portable-executable";
  readonly fileExtension: ".efi";
  readonly bytes: Uint8Array;
  readonly deterministicMetadata: PeCoffEfiDeterministicMetadata;
  readonly verification: PeCoffWriterVerificationSummary;
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareCodeUnitStrings));
}

function diagnosticProvenanceOrder(provenance: readonly string[]): string {
  return `${provenance.map((source) => `${source.length}:${source}`).join("")}|${provenance.length}`;
}

export function peCoffWriterDiagnostic(input: PeCoffWriterDiagnosticInput): PeCoffWriterDiagnostic {
  const validatedCode = peCoffWriterDiagnosticCode(input.code);
  const provenance = sortedStrings(input.provenance ?? []);
  const rootCauseKey = input.rootCauseKey ?? input.stableDetail;
  const order: PeCoffWriterDiagnosticOrder = Object.freeze({
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

export function sortPeCoffWriterDiagnostics(
  diagnostics: readonly PeCoffWriterDiagnostic[],
): readonly PeCoffWriterDiagnostic[] {
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

export function peCoffWriterVerificationSummary(
  input: PeCoffWriterVerificationSummary,
): PeCoffWriterVerificationSummary {
  return Object.freeze({
    runs: Object.freeze(input.runs.map((run) => Object.freeze({ ...run }))),
  });
}

export function peCoffOk<Value>(input: PeCoffWriterOkInput<Value>): PeCoffWriterOkResult<Value> {
  return Object.freeze({
    kind: "ok",
    value: input.value,
    diagnostics: sortPeCoffWriterDiagnostics(input.diagnostics ?? []),
    verification: peCoffWriterVerificationSummary(input.verification),
  });
}

export function peCoffError(input: PeCoffWriterErrorInput): PeCoffWriterErrorResult {
  return Object.freeze({
    kind: "error",
    diagnostics: sortPeCoffWriterDiagnostics(input.diagnostics),
    verification: peCoffWriterVerificationSummary(input.verification),
  });
}

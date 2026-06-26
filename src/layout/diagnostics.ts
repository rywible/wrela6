import { compareCodeUnitStrings } from "../semantic/surface/deterministic-sort";
import type { LayoutBuilderIssue } from "./builder-context";

export const LAYOUT_DIAGNOSTIC_CODES = [
  "LAYOUT_INVALID_TARGET_DATA_MODEL",
  "LAYOUT_INVALID_TARGET_PRIMITIVE",
  "LAYOUT_INVALID_ENUM_POLICY",
  "LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE",
  "LAYOUT_PLATFORM_TARGET_MISMATCH",
  "LAYOUT_REACHABLE_ERROR_TYPE",
  "LAYOUT_REACHABLE_RECOVERED_NODE",
  "LAYOUT_MISSING_PRIMITIVE_TYPE",
  "LAYOUT_MISSING_TYPE_RESOLUTION",
  "LAYOUT_DUPLICATE_TYPE_RESOLUTION",
  "LAYOUT_INVALID_PUBLISHED_TYPE_KEY",
  "LAYOUT_MONO_INVARIANT_VIOLATION",
  "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
  "LAYOUT_UNSUPPORTED_INTERFACE_VALUE",
  "LAYOUT_UNSUPPORTED_ENUM_PAYLOAD",
  "LAYOUT_EMPTY_ENUM_REJECTED",
  "LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START",
  "LAYOUT_ENUM_DISCRIMINANT_OVERFLOW",
  "LAYOUT_RECURSIVE_TYPE_LAYOUT",
  "LAYOUT_FORBIDDEN_NEVER_STORAGE",
  "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
  "LAYOUT_FIELD_ALIGNMENT_OVERFLOW",
  "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
  "LAYOUT_MISSING_WIRE_ENCODING",
  "LAYOUT_INVALID_WIRE_ENCODING",
  "LAYOUT_ZERO_SIZED_WIRE_ELEMENT",
  "LAYOUT_WIRE_HELPER_MISSING",
  "LAYOUT_WIRE_HELPER_MISMATCH",
  "LAYOUT_INVALID_LAYOUT_TERM",
  "LAYOUT_TERM_RANGE_MISSING",
  "LAYOUT_TERM_ARITHMETIC_OVERFLOW",
  "LAYOUT_FIELD_FORWARD_DEPENDENCY",
  "LAYOUT_FIELD_OVERLAP",
  "LAYOUT_FIELD_AMBIGUOUS_ORDER",
  "LAYOUT_DERIVED_OTHERWISE_NOT_LAST",
  "LAYOUT_DERIVED_DUPLICATE_CASE",
  "LAYOUT_DERIVED_CASE_OUT_OF_RANGE",
  "LAYOUT_DERIVED_CASE_NOT_TOTAL",
  "LAYOUT_MISSING_DEVICE_SURFACE",
  "LAYOUT_MISSING_IMAGE_PROFILE",
  "LAYOUT_MISSING_IMAGE_ENTRY",
  "LAYOUT_ABI_CLASSIFICATION_FAILED",
  "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
  "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
  "LAYOUT_FACT_TABLE_INCONSISTENCY",
] as const;

export type LayoutDiagnosticCode = (typeof LAYOUT_DIAGNOSTIC_CODES)[number];

const LAYOUT_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(LAYOUT_DIAGNOSTIC_CODES);

export function layoutDiagnosticCode(code: string): LayoutDiagnosticCode {
  if (!LAYOUT_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown layout diagnostic code: ${code}.`);
  }
  return code as LayoutDiagnosticCode;
}

export interface LayoutDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: LayoutDiagnosticCode;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export interface LayoutDiagnosticInput {
  readonly severity: "error" | "warning" | "note";
  readonly code: string;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export function layoutDiagnostic(input: LayoutDiagnosticInput): LayoutDiagnostic {
  const code = layoutDiagnosticCode(input.code);
  return {
    severity: input.severity,
    code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  };
}

function sourceOriginSortKey(sourceOrigin: string | undefined): string {
  return sourceOrigin ?? "";
}

export function sortLayoutDiagnostics(
  diagnostics: readonly LayoutDiagnostic[],
): readonly LayoutDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const sourceOriginCmp = compareCodeUnitStrings(
      sourceOriginSortKey(left.sourceOrigin),
      sourceOriginSortKey(right.sourceOrigin),
    );
    if (sourceOriginCmp !== 0) return sourceOriginCmp;

    const codeCmp = compareCodeUnitStrings(left.code, right.code);
    if (codeCmp !== 0) return codeCmp;

    const ownerCmp = compareCodeUnitStrings(left.ownerKey, right.ownerKey);
    if (ownerCmp !== 0) return ownerCmp;

    const rootCauseCmp = compareCodeUnitStrings(left.rootCauseKey, right.rootCauseKey);
    if (rootCauseCmp !== 0) return rootCauseCmp;

    return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
  });
}

export function layoutDiagnosticErrorGroupKey(diagnostic: LayoutDiagnostic): string {
  return `${diagnostic.code}\0${diagnostic.ownerKey}\0${diagnostic.rootCauseKey}`;
}

const CASCADE_SUPPRESSED_LAYOUT_ERROR_CODES: ReadonlySet<LayoutDiagnosticCode> = new Set([
  layoutDiagnosticCode("LAYOUT_MISSING_FIELD_TYPE_LAYOUT"),
  layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
  layoutDiagnosticCode("LAYOUT_MISSING_WIRE_ENCODING"),
  layoutDiagnosticCode("LAYOUT_INVALID_WIRE_ENCODING"),
  layoutDiagnosticCode("LAYOUT_ZERO_SIZED_WIRE_ELEMENT"),
  layoutDiagnosticCode("LAYOUT_WIRE_HELPER_MISSING"),
  layoutDiagnosticCode("LAYOUT_WIRE_HELPER_MISMATCH"),
  layoutDiagnosticCode("LAYOUT_MISSING_DEVICE_SURFACE"),
  layoutDiagnosticCode("LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH"),
]);

export interface FinalizeLayoutDiagnosticsInput {
  readonly issues: readonly LayoutBuilderIssue[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

function collectFailedOwnerKeys(issues: readonly LayoutBuilderIssue[]): ReadonlySet<string> {
  const failedOwners = new Set<string>();
  for (const issue of issues) {
    if (issue.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      failedOwners.add(String(issue.ownerKey));
    }
  }
  return failedOwners;
}

function buildDiagnosticIssueMap(
  issues: readonly LayoutBuilderIssue[],
): ReadonlyMap<LayoutDiagnostic, LayoutBuilderIssue> {
  const issueByDiagnostic = new Map<LayoutDiagnostic, LayoutBuilderIssue>();
  for (const issue of issues) {
    for (const diagnostic of issue.diagnostics) {
      issueByDiagnostic.set(diagnostic, issue);
    }
  }
  return issueByDiagnostic;
}

function dependsOnFailedOwner(
  issue: LayoutBuilderIssue,
  failedOwners: ReadonlySet<string>,
): boolean {
  const issueOwnerKey = String(issue.ownerKey);
  return issue.dependencies.some(
    (dependency) =>
      failedOwners.has(String(dependency.ownerKey)) &&
      String(dependency.ownerKey) !== issueOwnerKey,
  );
}

function shouldSuppressCascadeDiagnostic(
  diagnostic: LayoutDiagnostic,
  issue: LayoutBuilderIssue | undefined,
  failedOwners: ReadonlySet<string>,
): boolean {
  if (diagnostic.severity !== "error") {
    return false;
  }
  if (!CASCADE_SUPPRESSED_LAYOUT_ERROR_CODES.has(diagnostic.code)) {
    return false;
  }
  if (issue !== undefined) {
    return dependsOnFailedOwner(issue, failedOwners);
  }
  return failedOwners.has(diagnostic.rootCauseKey);
}

export function dedupeLayoutErrorDiagnostics(
  diagnostics: readonly LayoutDiagnostic[],
): readonly LayoutDiagnostic[] {
  const sortedDiagnostics = sortLayoutDiagnostics(diagnostics);
  const seenErrorGroups = new Set<string>();
  const deduped: LayoutDiagnostic[] = [];

  for (const diagnostic of sortedDiagnostics) {
    if (diagnostic.severity !== "error") {
      deduped.push(diagnostic);
      continue;
    }

    const groupKey = layoutDiagnosticErrorGroupKey(diagnostic);
    if (seenErrorGroups.has(groupKey)) {
      continue;
    }
    seenErrorGroups.add(groupKey);
    deduped.push(diagnostic);
  }

  return deduped;
}

export function suppressCascadeLayoutDiagnostics(
  input: FinalizeLayoutDiagnosticsInput,
): readonly LayoutDiagnostic[] {
  const failedOwners = collectFailedOwnerKeys(input.issues);
  const issueByDiagnostic = buildDiagnosticIssueMap(input.issues);

  return input.diagnostics.filter((diagnostic) => {
    const issue = issueByDiagnostic.get(diagnostic);
    return !shouldSuppressCascadeDiagnostic(diagnostic, issue, failedOwners);
  });
}

export function finalizeLayoutDiagnostics(
  input: FinalizeLayoutDiagnosticsInput,
): readonly LayoutDiagnostic[] {
  const cascadeFiltered = suppressCascadeLayoutDiagnostics(input);
  const deduped = dedupeLayoutErrorDiagnostics(cascadeFiltered);
  return sortLayoutDiagnostics(deduped);
}

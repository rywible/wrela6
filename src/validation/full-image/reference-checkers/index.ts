import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "../report";
import type {
  FullImageReferenceChecker,
  FullImageReferenceCheckerKey,
  RunFullImageReferenceCheckersInput,
} from "./types";
import { aarch64ObjectReferenceChecker } from "./aarch64-object-reference";
import { linkedLayoutReferenceChecker } from "./linked-layout-reference";
import { optIrReferenceChecker } from "./opt-ir-reference";
import { peCoffReferenceChecker } from "./pe-coff-reference";
import { proofFactReferenceChecker } from "./proof-fact-reference";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import { semanticPlatformReferenceChecker } from "./semantic-platform-reference";
import { stdlibSourceRootReferenceChecker } from "./stdlib-source-root-reference";
import { uefiTcbGoldenReferenceChecker } from "./uefi-tcb-golden-reference";

export type {
  FullImageReferenceChecker,
  FullImageReferenceCheckerInput,
  FullImageReferenceCheckerKey,
  RunFullImageReferenceCheckersInput,
} from "./types";
export { aarch64ObjectReferenceChecker } from "./aarch64-object-reference";
export { linkedLayoutReferenceChecker } from "./linked-layout-reference";
export { optIrReferenceChecker } from "./opt-ir-reference";
export { peCoffReferenceChecker } from "./pe-coff-reference";
export { proofFactReferenceChecker } from "./proof-fact-reference";
export { semanticPlatformReferenceChecker } from "./semantic-platform-reference";
export { stdlibSourceRootReferenceChecker } from "./stdlib-source-root-reference";
export { uefiTcbGoldenReferenceChecker } from "./uefi-tcb-golden-reference";

export function defaultFullImageReferenceCheckers(): readonly FullImageReferenceChecker[] {
  return Object.freeze([
    stdlibSourceRootReferenceChecker(),
    semanticPlatformReferenceChecker(),
    proofFactReferenceChecker(),
    optIrReferenceChecker(),
    aarch64ObjectReferenceChecker(),
    linkedLayoutReferenceChecker(),
    peCoffReferenceChecker(),
    uefiTcbGoldenReferenceChecker(),
  ]);
}

const FULL_IMAGE_REFERENCE_CHECKER_KEYS: readonly FullImageReferenceCheckerKey[] = Object.freeze([
  "stdlib-source-root-reference",
  "semantic-platform-reference",
  "proof-fact-reference",
  "opt-ir-reference",
  "aarch64-object-reference",
  "linked-layout-reference",
  "pe-coff-reference",
  "uefi-tcb-golden-reference",
]);

export function runFullImageReferenceCheckers(
  input: RunFullImageReferenceCheckersInput,
): readonly FullImageValidationCheckReport[] {
  const checkers = [...(input.checkers ?? defaultFullImageReferenceCheckers())].sort(
    compareFullImageReferenceCheckers,
  );
  const reports = checkers.flatMap((checker) => {
    const checkerReports = checker.run(input.input);
    return checkerReports.map((report) =>
      normalizeFullImageReferenceCheckReport({
        checker,
        report,
        compileStatus: input.input.compileStatus,
      }),
    );
  });

  return Object.freeze(reports.sort(compareFullImageValidationCheckReports));
}

export function normalizeFullImageReferenceCheckReport(input: {
  readonly checker: FullImageReferenceChecker;
  readonly report: FullImageValidationCheckReport;
  readonly compileStatus: "passed" | "failed";
}): FullImageValidationCheckReport {
  const report = freezeCheckReport({
    ...input.report,
    checkerKey: input.checker.checkerKey,
    inputAuthority: normalizedAuthorities(input.report.inputAuthority),
    evidence: normalizedEvidence(input.report.evidence),
  });

  if (report.inputAuthority.length === 0) {
    return frameworkFailure({
      checkerKey: input.checker.checkerKey,
      stableDetail: `reference-checker:empty-input-authority:${input.checker.checkerKey}:${report.stableDetail}`,
      authority: fallbackAuthority(input.checker),
      evidenceKey: "empty-input-authority",
      evidenceDetail: report.stableDetail,
    });
  }

  if (
    input.compileStatus === "passed" &&
    input.checker.requiredWhenCompilePassed === true &&
    report.status === "skipped"
  ) {
    const authority = report.inputAuthority[0] ?? fallbackAuthority(input.checker);
    return frameworkFailure({
      checkerKey: input.checker.checkerKey,
      stableDetail: `reference-checker:required-check-skipped:${input.checker.checkerKey}:${report.stableDetail}`,
      authority,
      evidenceKey: "required-check-skipped",
      evidenceDetail: report.stableDetail,
    });
  }

  return report;
}

function frameworkFailure(input: {
  readonly checkerKey: FullImageReferenceCheckerKey;
  readonly stableDetail: string;
  readonly authority: FullImageValidationEvidenceAuthority;
  readonly evidenceKey: string;
  readonly evidenceDetail: string;
}): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: input.checkerKey,
    status: "failed",
    stableDetail: input.stableDetail,
    inputAuthority: [input.authority],
    evidence: [
      referenceEvidence({
        evidenceKey: input.evidenceKey,
        authority: input.authority,
        stableDetail: input.evidenceDetail,
      }),
    ],
  });
}

function fallbackAuthority(
  checker: FullImageReferenceChecker,
): FullImageValidationEvidenceAuthority {
  return checker.allowedAuthorities[0] ?? "compiler-trace";
}

function freezeCheckReport(input: FullImageValidationCheckReport): FullImageValidationCheckReport {
  return Object.freeze({
    checkerKey: input.checkerKey,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: Object.freeze([...input.inputAuthority]),
    evidence: normalizedEvidence(input.evidence),
  });
}

function normalizedAuthorities(
  authorities: readonly FullImageValidationEvidenceAuthority[],
): readonly FullImageValidationEvidenceAuthority[] {
  return Object.freeze([...new Set(authorities)].sort(compareCodeUnitStrings));
}

function normalizedEvidence(
  evidence: readonly FullImageValidationEvidenceRecord[],
): readonly FullImageValidationEvidenceRecord[] {
  return Object.freeze(
    evidence
      .map((record) =>
        Object.freeze({
          evidenceKey: record.evidenceKey,
          authority: record.authority,
          stableDetail: record.stableDetail,
        }),
      )
      .sort(compareFullImageValidationEvidenceRecords),
  );
}

function compareFullImageReferenceCheckers(
  left: FullImageReferenceChecker,
  right: FullImageReferenceChecker,
): number {
  return (
    FULL_IMAGE_REFERENCE_CHECKER_KEYS.indexOf(left.checkerKey) -
      FULL_IMAGE_REFERENCE_CHECKER_KEYS.indexOf(right.checkerKey) ||
    compareCodeUnitStrings(left.checkerKey, right.checkerKey)
  );
}

function compareFullImageValidationCheckReports(
  left: FullImageValidationCheckReport,
  right: FullImageValidationCheckReport,
): number {
  return (
    checkerKeyRank(left.checkerKey) - checkerKeyRank(right.checkerKey) ||
    compareCodeUnitStrings(left.checkerKey, right.checkerKey) ||
    compareCodeUnitStrings(left.status, right.status) ||
    compareCodeUnitStrings(left.stableDetail, right.stableDetail)
  );
}

function checkerKeyRank(checkerKey: string): number {
  const index = FULL_IMAGE_REFERENCE_CHECKER_KEYS.indexOf(
    checkerKey as FullImageReferenceCheckerKey,
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareFullImageValidationEvidenceRecords(
  left: FullImageValidationEvidenceRecord,
  right: FullImageValidationEvidenceRecord,
): number {
  return (
    compareCodeUnitStrings(left.authority, right.authority) ||
    compareCodeUnitStrings(left.evidenceKey, right.evidenceKey) ||
    compareCodeUnitStrings(left.stableDetail, right.stableDetail)
  );
}

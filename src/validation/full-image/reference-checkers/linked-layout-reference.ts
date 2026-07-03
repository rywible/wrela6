import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import type { AArch64LinkedImageLayout, LinkedImageSection } from "../../../linker";
import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "linked-layout-reference";
const INPUT_AUTHORITY = Object.freeze(["linked-layout", "compiler-trace"] as const);

export function linkedLayoutReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runLinkedLayoutReferenceChecker,
  });
}

function runLinkedLayoutReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  const layout = input.trace?.binarySpine?.linkedLayout;
  if (layout === undefined) {
    return Object.freeze([
      report("skipped", "linked-layout:trace-missing", [
        evidence("linked-layout", "linked-layout", "trace.binarySpine.linkedLayout unavailable"),
      ]),
    ]);
  }

  const reports = [
    ...sectionRangeReports(layout),
    unresolvedExternalReport(layout),
    relocationTargetReport(layout),
    entryReport(input, layout),
    unwindRelationshipReport(layout),
  ];
  const failures = reports.filter((candidate) => candidate.status === "failed");
  if (failures.length > 0) return Object.freeze(failures.sort(compareReports));
  return Object.freeze(reports.sort(compareReports));
}

function sectionRangeReports(
  layout: AArch64LinkedImageLayout,
): readonly FullImageValidationCheckReport[] {
  const ordered = layout.sections
    .map((section, index) => ({ section, index }))
    .sort(
      (left, right) =>
        left.section.rva - right.section.rva ||
        compareCodeUnitStrings(left.section.stableKey, right.section.stableKey),
    );
  const reports: FullImageValidationCheckReport[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const section = current.section;
    if (section.rva <= 0 || section.virtualSizeBytes <= 0) {
      reports.push(
        report(
          "failed",
          `linked-layout:section-range:invalid:${section.stableKey}:${section.rva}:${section.virtualSizeBytes}`,
          [sectionEvidence(section)],
        ),
      );
    }
    const next = ordered[index + 1]?.section;
    if (next !== undefined && section.rva + section.virtualSizeBytes > next.rva) {
      reports.push(
        report(
          "failed",
          `linked-layout:section-range:overlap:${section.stableKey}:${next.stableKey}`,
          [sectionEvidence(section), sectionEvidence(next)],
        ),
      );
    }
  }
  return reports.length === 0
    ? [
        report("passed", `linked-layout:section-ranges:valid:${layout.sections.length}`, [
          evidence("section-ranges", "linked-layout", sectionRanges(layout)),
        ]),
      ]
    : reports;
}

function unresolvedExternalReport(
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const unresolved = layout.symbols
    .filter(
      (symbol) =>
        symbol.sectionKey === "<external>" ||
        symbol.contributionKey === "<external>" ||
        /extern|unresolved|missing/i.test(symbol.symbolKey),
    )
    .map((symbol) => symbol.linkageName ?? symbol.symbolKey)
    .sort(compareCodeUnitStrings);
  return report(
    unresolved.length === 0 ? "passed" : "failed",
    unresolved.length === 0
      ? "linked-layout:unresolved-externals:absent"
      : `linked-layout:unresolved-externals:present:${unresolved.join(",")}`,
    [evidence("linked-symbols", "linked-layout", unresolved.join(","))],
  );
}

function relocationTargetReport(layout: AArch64LinkedImageLayout): FullImageValidationCheckReport {
  const symbolKeys = new Set(layout.symbols.map((symbol) => symbol.symbolKey));
  const missing = layout.appliedRelocations
    .filter((relocation) => !symbolKeys.has(relocation.targetSymbolKey))
    .map((relocation) => `${relocation.relocationKey}:${relocation.targetSymbolKey}`)
    .sort(compareCodeUnitStrings);
  return report(
    missing.length === 0 ? "passed" : "failed",
    missing.length === 0
      ? `linked-layout:relocation-targets:resolved:${layout.appliedRelocations.length}`
      : `linked-layout:relocation-targets:missing:${missing.join(",")}`,
    [evidence("applied-relocations", "linked-layout", `count:${layout.appliedRelocations.length}`)],
  );
}

function entryReport(
  input: FullImageReferenceCheckerInput,
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const expectedBoot = input.trace?.target.entryProfile.bootFunctionSymbol;
  const hasLoaderEntry = layout.entry.loaderEntryRva > 0;
  const bootMatches =
    expectedBoot === undefined || layout.entry.wrelaBootLinkageName === expectedBoot;
  return report(
    hasLoaderEntry && bootMatches ? "passed" : "failed",
    hasLoaderEntry && bootMatches
      ? `linked-layout:entry:matched:${layout.entry.loaderEntryLinkageName}:${layout.entry.loaderEntryRva}`
      : `linked-layout:entry:mismatch:${layout.entry.loaderEntryLinkageName}:${layout.entry.loaderEntryRva}:${layout.entry.wrelaBootLinkageName}:${expectedBoot ?? "unavailable"}`,
    [
      evidence(
        "entry",
        "linked-layout",
        `${layout.entry.loaderEntryLinkageName}:${layout.entry.loaderEntryRva}:${layout.entry.wrelaBootLinkageName}`,
      ),
      evidence("target-entry", "compiler-trace", expectedBoot ?? "unavailable"),
    ],
  );
}

function unwindRelationshipReport(
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const pdata = layout.sections.find((section) => section.stableKey === ".pdata");
  const xdata = layout.sections.find((section) => section.stableKey === ".xdata");
  const bad = layout.unwindRecords
    .filter(
      (record) =>
        pdata === undefined ||
        xdata === undefined ||
        record.functionStartRva >= record.functionEndRva ||
        record.unwindInfoSectionKey !== ".xdata",
    )
    .map((record) => record.stableKey)
    .sort(compareCodeUnitStrings);
  return report(
    bad.length === 0 ? "passed" : "failed",
    bad.length === 0
      ? `linked-layout:unwind:relationships:${layout.unwindRecords.length}`
      : `linked-layout:unwind:invalid:${bad.join(",")}`,
    [evidence("unwind-records", "linked-layout", `count:${layout.unwindRecords.length}`)],
  );
}

function sectionEvidence(section: LinkedImageSection): FullImageValidationEvidenceRecord {
  return evidence(
    "section-range",
    "linked-layout",
    `${section.stableKey}:${section.rva}:${section.virtualSizeBytes}`,
  );
}

function sectionRanges(layout: AArch64LinkedImageLayout): string {
  return layout.sections
    .map((section) => `${section.stableKey}:${section.rva}:${section.virtualSizeBytes}`)
    .sort(compareCodeUnitStrings)
    .join(",");
}

function report(
  status: FullImageValidationCheckReport["status"],
  stableDetail: string,
  evidenceRecords: readonly FullImageValidationEvidenceRecord[],
): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status,
    stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: evidenceRecords,
  });
}

function evidence(
  evidenceKey: string,
  authority: FullImageValidationEvidenceRecord["authority"],
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return referenceEvidence({ evidenceKey, authority, stableDetail });
}

function compareReports(
  left: FullImageValidationCheckReport,
  right: FullImageValidationCheckReport,
): number {
  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}

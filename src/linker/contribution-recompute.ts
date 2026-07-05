import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { linkerDiagnostic, type LinkerDiagnostic } from "./diagnostics";
import type {
  AArch64LinkedImageLayout,
  LinkedImageSection,
  SectionContribution,
} from "./linked-image-layout";

const OWNER_KEY = "linked-image-contribution-recompute";

export interface RecomputedLinkedImageContributionPlacement {
  readonly section: LinkedImageSection;
  readonly contribution: SectionContribution;
  readonly expectedSectionRva: number;
  readonly expectedContributionOffsetBytes: number;
}

export interface RecomputedLinkedImageContributions {
  readonly contributionByKey: ReadonlyMap<string, RecomputedLinkedImageContributionPlacement>;
  readonly diagnostics: readonly LinkerDiagnostic[];
}

export interface RecomputeLinkedImageContributionsInput {
  readonly detailPrefix?: string;
  readonly diagnosticCode?: string;
  readonly ownerKey?: string;
}

const SECTION_ORDER = Object.freeze([
  ".text",
  ".rdata",
  ".data",
  ".pdata",
  ".xdata",
  ".debug$wrela",
]);

export function recomputeLinkedImageContributions(
  layout: AArch64LinkedImageLayout,
  input: RecomputeLinkedImageContributionsInput = {},
): RecomputedLinkedImageContributions {
  const detailPrefix = input.detailPrefix ?? "image-layout";
  const diagnosticCode = input.diagnosticCode ?? "LINKER_IMAGE_LAYOUT_INVALID";
  const ownerKey = input.ownerKey ?? OWNER_KEY;
  const diagnostics: LinkerDiagnostic[] = [];
  const contributionByKey = new Map<string, RecomputedLinkedImageContributionPlacement>();
  const orderedSections = [...layout.sections].sort(compareSectionsByPolicyOrder);
  let nextSectionRva = orderedSections[0]?.rva ?? 0;

  for (const section of orderedSections) {
    const expectedSectionRva = align(nextSectionRva, section.alignmentBytes);
    if (section.rva !== expectedSectionRva) {
      diagnostics.push(
        diagnostic({
          code: diagnosticCode,
          ownerKey,
          stableDetail: `${detailPrefix}:section-rva-mismatch:${section.stableKey}:${section.rva}:${expectedSectionRva}`,
        }),
      );
    }

    let nextContributionOffset = 0;
    for (const contribution of [...section.contributions].sort(compareContributionsByPlacement)) {
      const expectedContributionOffsetBytes = align(
        nextContributionOffset,
        contribution.alignmentBytes,
      );
      if (contribution.offsetBytes !== expectedContributionOffsetBytes) {
        diagnostics.push(
          diagnostic({
            code: diagnosticCode,
            ownerKey,
            stableDetail: `${detailPrefix}:contribution-offset-mismatch:${contribution.stableKey}:${contribution.offsetBytes}:${expectedContributionOffsetBytes}`,
          }),
        );
      }
      contributionByKey.set(
        contribution.stableKey,
        Object.freeze({
          section,
          contribution,
          expectedSectionRva,
          expectedContributionOffsetBytes,
        }),
      );
      nextContributionOffset = expectedContributionOffsetBytes + contribution.sizeBytes;
    }

    if (section.virtualSizeBytes !== nextContributionOffset) {
      diagnostics.push(
        diagnostic({
          code: diagnosticCode,
          ownerKey,
          stableDetail: `${detailPrefix}:section-size-mismatch:${section.stableKey}:${section.virtualSizeBytes}:${nextContributionOffset}`,
        }),
      );
    }
    nextSectionRva = expectedSectionRva + section.virtualSizeBytes;
  }

  return Object.freeze({
    contributionByKey,
    diagnostics: Object.freeze(diagnostics),
  });
}

function diagnostic(input: {
  readonly code: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
}): LinkerDiagnostic {
  return linkerDiagnostic({
    code: input.code,
    ownerKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function compareSectionsByPolicyOrder(left: LinkedImageSection, right: LinkedImageSection): number {
  const priorityDifference = sectionPriority(left.stableKey) - sectionPriority(right.stableKey);
  return priorityDifference === 0
    ? compareCodeUnitStrings(left.stableKey, right.stableKey)
    : priorityDifference;
}

function compareContributionsByPlacement(
  left: SectionContribution,
  right: SectionContribution,
): number {
  return (
    compareCodeUnitStrings(left.sourceModuleKey, right.sourceModuleKey) ||
    compareCodeUnitStrings(left.sourceObjectSectionClass, right.sourceObjectSectionClass) ||
    compareCodeUnitStrings(left.sourceObjectSectionKey, right.sourceObjectSectionKey) ||
    compareCodeUnitStrings(left.stableKey, right.stableKey)
  );
}

function sectionPriority(sectionKey: string): number {
  const index = SECTION_ORDER.indexOf(sectionKey);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function align(value: number, alignmentBytes: number): number {
  const remainder = value % alignmentBytes;
  return remainder === 0 ? value : value + alignmentBytes - remainder;
}

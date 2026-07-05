import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableJson } from "../shared/stable-json";
import { linkerDiagnostic, type LinkerDiagnostic } from "./diagnostics";
import type { AArch64LinkedImageLayout } from "./linked-image-layout";

const VERIFIER_KEY = "linked-image-verifier";
const OWNER_KEY = "linked-image-verifier";

export interface VerifyLinkedImageSectionsInput {
  readonly layout: AArch64LinkedImageLayout;
  readonly firstSectionRva: number;
  readonly sectionAlignmentBytes: number;
}

export function linkedImageSectionDiagnostics(
  input: VerifyLinkedImageSectionsInput,
): readonly LinkerDiagnostic[] {
  const sections = input.layout.sections;
  const diagnostics: LinkerDiagnostic[] = [];
  for (const section of sections) {
    if (!isNonNegativeInteger(section.rva) || !isPositiveInteger(section.alignmentBytes)) {
      diagnostics.push(diagnostic(`image-layout:section-rva-invalid:${section.stableKey}`));
      continue;
    }
    if (section.rva % section.alignmentBytes !== 0) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-rva-misaligned:${section.stableKey}:${section.rva}:${section.alignmentBytes}`,
        ),
      );
    }
    if (section.virtualSizeBytes < section.bytes.length) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-virtual-size-too-small:${section.stableKey}:${section.virtualSizeBytes}:${section.bytes.length}`,
        ),
      );
    }
  }

  const orderedSections = [...sections].sort(compareSectionsByRva);
  const firstSection = orderedSections[0];
  if (firstSection !== undefined && firstSection.rva !== input.firstSectionRva) {
    diagnostics.push(
      diagnostic(
        `image-layout:first-section-rva-mismatch:${firstSection.stableKey}:${firstSection.rva}:${input.firstSectionRva}`,
        "LINKER_LAYOUT_FIRST_SECTION_RVA_MISMATCH",
      ),
    );
  }
  for (let index = 1; index < orderedSections.length; index += 1) {
    const previous = orderedSections[index - 1]!;
    const current = orderedSections[index]!;
    const previousEnd = previous.rva + previous.virtualSizeBytes;
    const currentEnd = current.rva + current.virtualSizeBytes;
    const expectedRva = align(previousEnd, input.sectionAlignmentBytes);
    if (current.rva !== expectedRva) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-rva-contiguity-mismatch:${previous.stableKey}:${current.stableKey}:${current.rva}:${expectedRva}`,
          "LINKER_LAYOUT_SECTION_CONTIGUITY_MISMATCH",
        ),
      );
    }
    if (previousEnd > current.rva) {
      diagnostics.push(
        diagnostic(
          `image-layout:section-rva-overlap:${previous.stableKey}:${current.stableKey}:${previous.rva}:${previousEnd}:${current.rva}:${currentEnd}`,
        ),
      );
    }
  }
  return diagnostics;
}

function compareSectionsByRva(
  left: AArch64LinkedImageLayout["sections"][number],
  right: AArch64LinkedImageLayout["sections"][number],
): number {
  const rvaComparison = left.rva - right.rva;
  return rvaComparison === 0
    ? compareCodeUnitStrings(left.stableKey, right.stableKey)
    : rvaComparison;
}

function diagnostic(stableDetail: string, code = "LINKER_IMAGE_LAYOUT_INVALID"): LinkerDiagnostic {
  return linkerDiagnostic({
    code,
    ownerKey: OWNER_KEY,
    stableDetail,
    provenance: [stableJson([VERIFIER_KEY, stableDetail])],
  });
}

function align(value: number, alignmentBytes: number): number {
  const remainder = value % alignmentBytes;
  return remainder === 0 ? value : value + alignmentBytes - remainder;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

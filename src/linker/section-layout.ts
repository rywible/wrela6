import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { AArch64LinkerTargetSurface } from "./image-layout-policy";
import {
  type LinkedByteProvenance,
  type LinkedImageSection,
  type SectionContribution,
} from "./linked-image-layout";
import type { NormalizedLinkGraph, NormalizedObjectModule } from "./object-normalization";
import type {
  AArch64ByteProvenanceRecord,
  AArch64ObjectSection,
} from "../target/aarch64/backend/object/object-module";

export interface LayoutImageSectionsInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly graph: NormalizedLinkGraph;
}

export interface LayoutImageSectionsOutput {
  readonly sections: readonly LinkedImageSection[];
  readonly contributions: readonly SectionContribution[];
  readonly provenance: readonly LinkedByteProvenance[];
}

interface PendingContribution {
  readonly module: NormalizedObjectModule;
  readonly section: AArch64ObjectSection;
  readonly outputSectionKey: string;
  readonly stableKey: string;
  readonly sectionPriority: number;
  readonly sectionFingerprint: string;
}

interface PlacedContribution {
  readonly pending: PendingContribution;
  readonly contribution: SectionContribution;
  readonly paddingStartOffsetBytes?: number;
  readonly paddingByteLength?: number;
}

const SECTION_LAYOUT_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-linker-section-layout",
      runKey: "layout-sections",
      status: "passed" as const,
    }),
  ]),
});

export function layoutImageSections(
  input: LayoutImageSectionsInput,
): LinkerResult<LayoutImageSectionsOutput> {
  const sectionOrder = outputSectionOrder(input.target);
  const sectionPriorityByKey = new Map(
    sectionOrder.map((sectionKey, index) => [sectionKey, index]),
  );
  const pending = collectPendingContributions(input, sectionPriorityByKey);
  const diagnostics = pending.diagnostics;
  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: SECTION_LAYOUT_VERIFICATION });
  }

  const orderedPending = pending.contributions.sort(comparePendingContributions);
  const outputGroups = new Map<string, PendingContribution[]>();
  for (const contribution of orderedPending) {
    outputGroups.set(contribution.outputSectionKey, [
      ...(outputGroups.get(contribution.outputSectionKey) ?? []),
      contribution,
    ]);
  }

  const sections: LinkedImageSection[] = [];
  const contributions: SectionContribution[] = [];
  const provenance: LinkedByteProvenance[] = [];
  let nextSectionRva = input.target.constants.firstSectionRva;

  for (const outputSectionKey of sectionOrder) {
    const group = outputGroups.get(outputSectionKey);
    if (group === undefined || group.length === 0) continue;

    const alignedRva = alignChecked(
      nextSectionRva,
      input.target.constants.sectionAlignmentBytes,
      `section-layout:integer-overflow:section-rva:${outputSectionKey}`,
    );
    if (alignedRva.kind === "error") {
      return linkerError({
        diagnostics: [alignedRva.diagnostic],
        verification: SECTION_LAYOUT_VERIFICATION,
      });
    }

    const placed = placeContributions(input.target, outputSectionKey, group);
    if (placed.kind === "error") {
      return linkerError({
        diagnostics: [placed.diagnostic],
        verification: SECTION_LAYOUT_VERIFICATION,
      });
    }

    const sectionSize = placed.bytes.length;
    const imageEnd = checkedAdd(
      alignedRva.value,
      sectionSize,
      `section-layout:integer-overflow:image-size:${outputSectionKey}`,
    );
    if (imageEnd.kind === "error") {
      return linkerError({
        diagnostics: [imageEnd.diagnostic],
        verification: SECTION_LAYOUT_VERIFICATION,
      });
    }
    if (imageEnd.value > input.target.constants.maxImageSizeBytes) {
      return linkerError({
        diagnostics: [
          diagnostic(
            `section-layout:image-size-exceeds-policy:${imageEnd.value}:${input.target.constants.maxImageSizeBytes}`,
          ),
        ],
        verification: SECTION_LAYOUT_VERIFICATION,
      });
    }

    const sectionContributions = placed.placed.map((entry) => entry.contribution);
    sections.push(
      Object.freeze({
        stableKey: outputSectionKey,
        classKey: group[0]?.section.classKey ?? outputSectionKey,
        flags: input.target.constants.sectionFlags[outputSectionKey] ?? 0,
        alignmentBytes: input.target.constants.sectionAlignmentBytes,
        rva: alignedRva.value,
        virtualSizeBytes: sectionSize,
        bytes: Uint8Array.from(placed.bytes),
        contributions: Object.freeze(sectionContributions),
      }),
    );
    contributions.push(...sectionContributions);
    provenance.push(...linkedProvenanceFor(outputSectionKey, alignedRva.value, placed.placed));
    nextSectionRva = imageEnd.value;
  }

  return linkerOk({
    value: Object.freeze({
      sections: Object.freeze(sections),
      contributions: Object.freeze(contributions),
      provenance: Object.freeze(provenance.sort(compareLinkedProvenance)),
    }),
    verification: SECTION_LAYOUT_VERIFICATION,
  });
}

function collectPendingContributions(
  input: LayoutImageSectionsInput,
  sectionPriorityByKey: ReadonlyMap<string, number>,
): {
  readonly contributions: PendingContribution[];
  readonly diagnostics: readonly LinkerDiagnostic[];
} {
  const contributions: PendingContribution[] = [];
  const diagnostics: LinkerDiagnostic[] = [];

  for (const module of input.graph.modules) {
    for (const section of module.objectModule.sections) {
      const outputSectionKey = input.target.outputSectionByObjectClass.get(section.classKey);
      if (outputSectionKey === undefined) {
        diagnostics.push(
          diagnostic(
            `section-layout:unknown-section-class:${module.moduleKey}:${section.stableKey}:${section.classKey}`,
          ),
        );
        continue;
      }
      contributions.push(
        Object.freeze({
          module,
          section,
          outputSectionKey,
          stableKey: `${module.moduleKey}:section:${section.stableKey}`,
          sectionPriority: sectionPriorityByKey.get(outputSectionKey) ?? Number.MAX_SAFE_INTEGER,
          sectionFingerprint: `stable-hash:${stableHash(
            stableJson({
              stableKey: section.stableKey,
              classKey: section.classKey,
              alignmentBytes: section.alignmentBytes,
              bytes: section.bytes,
            }),
          )}`,
        }),
      );
    }
  }

  return { contributions, diagnostics };
}

function placeContributions(
  target: AArch64LinkerTargetSurface,
  outputSectionKey: string,
  pendingContributions: readonly PendingContribution[],
):
  | {
      readonly kind: "ok";
      readonly placed: readonly PlacedContribution[];
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  const bytes: number[] = [];
  const placed: PlacedContribution[] = [];

  for (const pending of pendingContributions) {
    const alignmentBytes = Math.max(
      pending.section.alignmentBytes,
      contributionAlignmentFor(target, outputSectionKey, pending.section.classKey),
    );
    const alignedOffset = alignChecked(
      bytes.length,
      alignmentBytes,
      `section-layout:integer-overflow:contribution-offset:${pending.stableKey}`,
    );
    if (alignedOffset.kind === "error") return alignedOffset;

    const paddingByteLength = alignedOffset.value - bytes.length;
    const paddingStartOffsetBytes = bytes.length;
    for (let index = 0; index < paddingByteLength; index += 1) bytes.push(0);

    const contribution: SectionContribution = Object.freeze({
      stableKey: pending.stableKey,
      sourceModuleKey: pending.module.moduleKey,
      sourceObjectSectionKey: pending.section.stableKey,
      sourceObjectSectionClass: pending.section.classKey,
      outputSectionKey,
      offsetBytes: alignedOffset.value,
      sizeBytes: pending.section.bytes.length,
      alignmentBytes,
    });

    const endOffset = checkedAdd(
      alignedOffset.value,
      pending.section.bytes.length,
      `section-layout:integer-overflow:contribution-size:${pending.stableKey}`,
    );
    if (endOffset.kind === "error") return endOffset;
    bytes.push(...pending.section.bytes);
    placed.push(
      Object.freeze({
        pending,
        contribution,
        paddingStartOffsetBytes: paddingByteLength > 0 ? paddingStartOffsetBytes : undefined,
        paddingByteLength: paddingByteLength > 0 ? paddingByteLength : undefined,
      }),
    );
  }

  return { kind: "ok", placed: Object.freeze(placed), bytes: Uint8Array.from(bytes) };
}

function linkedProvenanceFor(
  outputSectionKey: string,
  sectionRva: number,
  placed: readonly PlacedContribution[],
): readonly LinkedByteProvenance[] {
  const provenance: LinkedByteProvenance[] = [];
  const sourceProvenance = byteProvenanceByModuleAndSection(placed);

  for (const entry of placed) {
    if (entry.paddingByteLength !== undefined && entry.paddingStartOffsetBytes !== undefined) {
      provenance.push(
        Object.freeze({
          stableKey: `padding:${outputSectionKey}:${entry.contribution.stableKey}:${entry.paddingStartOffsetBytes}`,
          sectionKey: outputSectionKey,
          rva: sectionRva + entry.paddingStartOffsetBytes,
          byteLength: entry.paddingByteLength,
          factFamilies: Object.freeze([]),
        }),
      );
    }

    const records =
      sourceProvenance
        .get(entry.pending.module.moduleKey)
        ?.get(String(entry.pending.section.stableKey)) ?? [];
    for (const source of records) {
      provenance.push(
        Object.freeze({
          stableKey: `${entry.pending.module.moduleKey}:provenance:${source.stableKey}`,
          sectionKey: outputSectionKey,
          rva: sectionRva + entry.contribution.offsetBytes + source.startOffsetBytes,
          byteLength: source.byteLength,
          sourceModuleKey: entry.pending.module.moduleKey,
          sourceObjectSectionKey: source.sectionKey,
          sourceObjectProvenanceKey: source.stableKey,
          sourceSyntheticObjectKey: entry.pending.module.syntheticObjectKey,
          factFamilies: Object.freeze([...source.factFamilies].sort(compareCodeUnitStrings)),
          machineSubjectKey: source.machineSubjectKey,
        }),
      );
    }
  }

  return Object.freeze(provenance);
}

function byteProvenanceByModuleAndSection(
  placed: readonly PlacedContribution[],
): ReadonlyMap<string, ReadonlyMap<string, readonly AArch64ByteProvenanceRecord[]>> {
  const indexes = new Map<string, ReadonlyMap<string, readonly AArch64ByteProvenanceRecord[]>>();

  for (const entry of placed) {
    const moduleKey = entry.pending.module.moduleKey;
    if (indexes.has(moduleKey)) continue;

    const bySection = new Map<string, AArch64ByteProvenanceRecord[]>();
    for (const source of entry.pending.module.objectModule.byteProvenance) {
      const sectionKey = String(source.sectionKey);
      bySection.set(sectionKey, [...(bySection.get(sectionKey) ?? []), source]);
    }

    const frozenBySection = new Map<string, readonly AArch64ByteProvenanceRecord[]>();
    for (const [sectionKey, records] of bySection) {
      frozenBySection.set(sectionKey, Object.freeze([...records]));
    }
    indexes.set(moduleKey, frozenBySection);
  }

  return indexes;
}

function outputSectionOrder(target: AArch64LinkerTargetSurface): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const sectionKey of Object.keys(target.constants.sectionFlags)) {
    if (seen.has(sectionKey)) continue;
    seen.add(sectionKey);
    ordered.push(sectionKey);
  }
  for (const mapping of target.sectionMappings) {
    if (seen.has(mapping.outputSectionKey)) continue;
    seen.add(mapping.outputSectionKey);
    ordered.push(mapping.outputSectionKey);
  }
  return Object.freeze(ordered);
}

function contributionAlignmentFor(
  target: AArch64LinkerTargetSurface,
  outputSectionKey: string,
  objectSectionClass: string,
): number {
  const policy = target.contributionAlignment;
  return (
    policy?.contributionAlignmentBytesByObjectSectionClass?.[objectSectionClass] ??
    policy?.contributionAlignmentBytesByOutputSection?.[outputSectionKey] ??
    policy?.contributionAlignmentBytes ??
    1
  );
}

function comparePendingContributions(
  left: PendingContribution,
  right: PendingContribution,
): number {
  return (
    left.sectionPriority - right.sectionPriority ||
    compareCodeUnitStrings(left.module.moduleKey, right.module.moduleKey) ||
    compareCodeUnitStrings(left.section.classKey, right.section.classKey) ||
    compareCodeUnitStrings(left.section.stableKey, right.section.stableKey) ||
    compareCodeUnitStrings(left.sectionFingerprint, right.sectionFingerprint)
  );
}

function compareLinkedProvenance(left: LinkedByteProvenance, right: LinkedByteProvenance): number {
  return compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function alignChecked(
  value: number,
  alignmentBytes: number,
  overflowDetail: string,
):
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(alignmentBytes) ||
    alignmentBytes < 1
  ) {
    return { kind: "error", diagnostic: diagnostic(overflowDetail) };
  }
  const remainder = value % alignmentBytes;
  if (remainder === 0) return { kind: "ok", value };
  return checkedAdd(value, alignmentBytes - remainder, overflowDetail);
}

function checkedAdd(
  left: number,
  right: number,
  overflowDetail: string,
):
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    return { kind: "error", diagnostic: diagnostic(overflowDetail) };
  }
  return { kind: "ok", value };
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_SECTION_LAYOUT_FAILED",
    ownerKey: "section-layout",
    stableDetail,
  });
}

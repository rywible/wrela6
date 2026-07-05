import type { ImageBaseRelocation } from "../linker";
import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import type { AArch64PeCoffEfiWriterTargetSurface } from "./aarch64/aarch64-pe-coff-target";
import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";
import { PE_IMAGE_REL_BASED_ABSOLUTE, PE_IMAGE_REL_BASED_DIR64 } from "./headers";
import { createPeByteWriter } from "./pe-byte-writer";

const BASE_RELOCATION_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-base-relocation-serializer",
      runKey: "serialize",
      status: "passed" as const,
    }),
  ]),
});

export interface SerializePeBaseRelocationsInput {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly relocations: readonly ImageBaseRelocation[];
}

export type PeBaseRelocationPlannedEntryKind = ImageBaseRelocation["kind"] | "absolute-padding";

export interface PeBaseRelocationPlannedEntry {
  readonly stableKey: string;
  readonly kind: PeBaseRelocationPlannedEntryKind;
  readonly sectionKey: string;
  readonly sourceRelocationKey: string;
  readonly rva: number;
  readonly pageOffset: number;
  readonly peType: number;
  readonly widthBytes: number;
  readonly encodedEntry: number;
  readonly padding: boolean;
}

export interface PeBaseRelocationPlannedBlock {
  readonly pageRva: number;
  readonly blockSizeBytes: number;
  readonly entries: readonly PeBaseRelocationPlannedEntry[];
}

export interface SerializedPeBaseRelocations {
  readonly bytes: Uint8Array;
  readonly blocks: readonly PeBaseRelocationPlannedBlock[];
}

function relocationDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_RELOCATION_SERIALIZATION_FAILED",
    ownerKey: "pe-base-relocation-serializer",
    stableDetail,
  });
}

function compareRelocations(left: ImageBaseRelocation, right: ImageBaseRelocation): number {
  if (left.rva !== right.rva) return left.rva - right.rva;
  return compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function pageRvaFor(rva: number, sectionAlignmentBytes: number): number {
  return Math.floor(rva / sectionAlignmentBytes) * sectionAlignmentBytes;
}

function plannedDir64Entry(
  relocation: ImageBaseRelocation,
  sectionAlignmentBytes: number,
): PeBaseRelocationPlannedEntry {
  const pageRva = pageRvaFor(relocation.rva, sectionAlignmentBytes);
  const pageOffset = relocation.rva - pageRva;
  const encodedEntry = (PE_IMAGE_REL_BASED_DIR64 << 12) | pageOffset;
  return Object.freeze({
    stableKey: relocation.stableKey,
    kind: relocation.kind,
    sectionKey: relocation.sectionKey,
    sourceRelocationKey: relocation.sourceRelocationKey,
    rva: relocation.rva,
    pageOffset,
    peType: PE_IMAGE_REL_BASED_DIR64,
    widthBytes: relocation.widthBytes,
    encodedEntry,
    padding: false,
  });
}

function plannedPaddingEntry(pageRva: number, entryIndex: number): PeBaseRelocationPlannedEntry {
  return Object.freeze({
    stableKey: `base-reloc:absolute-padding:${pageRva}:${entryIndex}`,
    kind: "absolute-padding",
    sectionKey: ".reloc",
    sourceRelocationKey: "pe-coff:base-relocation-padding",
    rva: pageRva,
    pageOffset: 0,
    peType: PE_IMAGE_REL_BASED_ABSOLUTE,
    widthBytes: 0,
    encodedEntry: 0,
    padding: true,
  });
}

function validateRelocation(
  target: AArch64PeCoffEfiWriterTargetSurface,
  relocation: ImageBaseRelocation,
): PeCoffWriterDiagnostic | undefined {
  if (!Number.isInteger(relocation.rva) || relocation.rva < 0) {
    return relocationDiagnostic(
      `base-relocation:rva:${relocation.stableKey}:${String(relocation.rva)}`,
    );
  }
  if (relocation.kind !== "dir64") {
    return relocationDiagnostic(
      `base-relocation:unsupported-kind:${relocation.stableKey}:${relocation.kind}`,
    );
  }
  if (relocation.widthBytes !== 8) {
    return relocationDiagnostic(
      `base-relocation:dir64-width:${relocation.stableKey}:${relocation.widthBytes}`,
    );
  }
  const pageOffset = relocation.rva - pageRvaFor(relocation.rva, target.sectionAlignmentBytes);
  if (pageOffset < 0 || pageOffset > 0x0fff) {
    return relocationDiagnostic(
      `base-relocation:page-offset:${relocation.stableKey}:${relocation.rva}`,
    );
  }
  return undefined;
}

function planRelocationBlocks(
  target: AArch64PeCoffEfiWriterTargetSurface,
  relocations: readonly ImageBaseRelocation[],
): PeCoffWriterResult<readonly PeBaseRelocationPlannedBlock[]> {
  const sortedRelocations = [...relocations].sort(compareRelocations);
  const diagnostics: PeCoffWriterDiagnostic[] = [];
  const seenRvas = new Set<number>();
  const entriesByPageRva = new Map<number, PeBaseRelocationPlannedEntry[]>();

  for (const relocation of sortedRelocations) {
    if (seenRvas.has(relocation.rva)) {
      diagnostics.push(relocationDiagnostic(`base-relocation:duplicate-rva:${relocation.rva}`));
      continue;
    }
    seenRvas.add(relocation.rva);

    const diagnostic = validateRelocation(target, relocation);
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
      continue;
    }

    const pageRva = pageRvaFor(relocation.rva, target.sectionAlignmentBytes);
    const entries = entriesByPageRva.get(pageRva) ?? [];
    entries.push(plannedDir64Entry(relocation, target.sectionAlignmentBytes));
    entriesByPageRva.set(pageRva, entries);
  }

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: BASE_RELOCATION_VERIFICATION,
    });
  }

  const blocks = [...entriesByPageRva.entries()]
    .sort(([leftPageRva], [rightPageRva]) => leftPageRva - rightPageRva)
    .map(([pageRva, entries]) => {
      const entriesIncludingPadding =
        entries.length % 2 === 0
          ? entries
          : [...entries, plannedPaddingEntry(pageRva, entries.length)];
      return Object.freeze({
        pageRva,
        blockSizeBytes: 8 + 2 * entriesIncludingPadding.length,
        entries: Object.freeze(entriesIncludingPadding),
      });
    });

  return peCoffOk({
    value: Object.freeze(blocks),
    verification: BASE_RELOCATION_VERIFICATION,
  });
}

function serializeBlocks(
  blocks: readonly PeBaseRelocationPlannedBlock[],
): PeCoffWriterResult<Uint8Array> {
  const writer = createPeByteWriter();
  const diagnostics: PeCoffWriterDiagnostic[] = [];

  for (const block of blocks) {
    const writePageRva = writer.writeU32Le(block.pageRva);
    if (writePageRva.kind === "error") diagnostics.push(...writePageRva.diagnostics);
    const writeBlockSize = writer.writeU32Le(block.blockSizeBytes);
    if (writeBlockSize.kind === "error") diagnostics.push(...writeBlockSize.diagnostics);

    for (const entry of block.entries) {
      const writeEntry = writer.writeU16Le(entry.encodedEntry);
      if (writeEntry.kind === "error") diagnostics.push(...writeEntry.diagnostics);
    }
  }

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: BASE_RELOCATION_VERIFICATION,
    });
  }

  return peCoffOk({
    value: writer.bytes(),
    verification: BASE_RELOCATION_VERIFICATION,
  });
}

export function serializePeBaseRelocations(
  input: SerializePeBaseRelocationsInput,
): PeCoffWriterResult<SerializedPeBaseRelocations> {
  const plannedBlocks = planRelocationBlocks(input.target, input.relocations);
  if (plannedBlocks.kind === "error") return plannedBlocks;

  const serializedBytes = serializeBlocks(plannedBlocks.value);
  if (serializedBytes.kind === "error") return serializedBytes;

  return peCoffOk({
    value: Object.freeze({
      bytes: serializedBytes.value,
      blocks: plannedBlocks.value,
    }),
    verification: BASE_RELOCATION_VERIFICATION,
  });
}

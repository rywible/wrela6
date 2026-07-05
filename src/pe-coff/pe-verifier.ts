import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";
import { PE_IMAGE_REL_BASED_ABSOLUTE } from "./headers";
import type { PlannedPeCoffImage } from "./aarch64/aarch64-pe-coff-efi-writer";
import type { ParsedPeCoffImage, ParsedPeSectionHeader } from "./pe-parser";

const PE_EXCEPTION_DIRECTORY_INDEX = 3;
const PE_BASE_RELOCATION_DIRECTORY_INDEX = 5;

const VERIFICATION_SUMMARY: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-verifier",
      runKey: "parse-back",
      status: "passed" as const,
    }),
  ]),
});

export interface VerifyParsedPeCoffImageInput {
  readonly planned: PlannedPeCoffImage;
  readonly parsed: ParsedPeCoffImage;
}

interface RelocationEntryForComparison {
  readonly rva: number;
  readonly type: number;
}

export function verifyParsedPeCoffImage(
  input: VerifyParsedPeCoffImageInput,
): PeCoffWriterResult<ParsedPeCoffImage> {
  const diagnostics: PeCoffWriterDiagnostic[] = [];

  compareHeaders(diagnostics, input);
  compareDataDirectories(diagnostics, input);
  compareSections(diagnostics, input);
  compareBaseRelocations(diagnostics, input);

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: VERIFICATION_SUMMARY,
    });
  }

  return peCoffOk({
    value: input.parsed,
    verification: VERIFICATION_SUMMARY,
  });
}

function verificationDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_VERIFICATION_FAILED",
    ownerKey: "pe-coff-verifier",
    stableDetail,
  });
}

function compareHeaders(
  diagnostics: PeCoffWriterDiagnostic[],
  input: VerifyParsedPeCoffImageInput,
): void {
  compareNumber(
    diagnostics,
    "dos-header:e-lfanew",
    input.parsed.dosHeader.e_lfanew,
    input.planned.headers.dosHeader.peHeaderOffsetBytes,
  );
  compareNumber(
    diagnostics,
    "coff-header:machine",
    input.parsed.coffHeader.machine,
    input.planned.headers.coffHeader.machine,
  );
  compareNumber(
    diagnostics,
    "coff-header:number-of-sections",
    input.parsed.coffHeader.numberOfSections,
    input.planned.headers.coffHeader.numberOfSections,
  );
  compareNumber(
    diagnostics,
    "coff-header:time-date-stamp",
    input.parsed.coffHeader.timeDateStamp,
    input.planned.headers.coffHeader.timeDateStamp,
  );
  compareNumber(
    diagnostics,
    "coff-header:size-of-optional-header",
    input.parsed.coffHeader.sizeOfOptionalHeader,
    input.planned.headers.coffHeader.sizeOfOptionalHeader,
  );
  compareNumber(
    diagnostics,
    "coff-header:pointer-to-symbol-table",
    input.parsed.coffHeader.pointerToSymbolTable,
    input.planned.headers.coffHeader.pointerToSymbolTable,
  );
  compareNumber(
    diagnostics,
    "coff-header:number-of-symbols",
    input.parsed.coffHeader.numberOfSymbols,
    input.planned.headers.coffHeader.numberOfSymbols,
  );
  compareNumber(
    diagnostics,
    "coff-header:characteristics",
    input.parsed.coffHeader.characteristics,
    input.planned.headers.coffHeader.characteristics,
  );

  const plannedOptional = input.planned.headers.optionalHeader;
  const parsedOptional = input.parsed.optionalHeader;
  compareNumber(diagnostics, "optional-header:magic", parsedOptional.magic, plannedOptional.magic);
  compareNumber(
    diagnostics,
    "optional-header:major-linker-version",
    parsedOptional.majorLinkerVersion,
    plannedOptional.majorLinkerVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:minor-linker-version",
    parsedOptional.minorLinkerVersion,
    plannedOptional.minorLinkerVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:size-of-code",
    parsedOptional.sizeOfCodeBytes,
    plannedOptional.sizeOfCodeBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:size-of-initialized-data",
    parsedOptional.sizeOfInitializedDataBytes,
    plannedOptional.sizeOfInitializedDataBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:size-of-uninitialized-data",
    parsedOptional.sizeOfUninitializedDataBytes,
    plannedOptional.sizeOfUninitializedDataBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:entry-rva",
    parsedOptional.addressOfEntryPoint,
    plannedOptional.addressOfEntryPoint,
  );
  compareNumber(
    diagnostics,
    "optional-header:base-of-code",
    parsedOptional.baseOfCode,
    plannedOptional.baseOfCode,
  );
  compareBigInt(
    diagnostics,
    "optional-header:image-base",
    parsedOptional.imageBase,
    plannedOptional.imageBase,
  );
  compareNumber(
    diagnostics,
    "optional-header:section-alignment",
    parsedOptional.sectionAlignmentBytes,
    plannedOptional.sectionAlignmentBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:file-alignment",
    parsedOptional.fileAlignmentBytes,
    plannedOptional.fileAlignmentBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:major-operating-system-version",
    parsedOptional.majorOperatingSystemVersion,
    plannedOptional.majorOperatingSystemVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:minor-operating-system-version",
    parsedOptional.minorOperatingSystemVersion,
    plannedOptional.minorOperatingSystemVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:major-image-version",
    parsedOptional.majorImageVersion,
    plannedOptional.majorImageVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:minor-image-version",
    parsedOptional.minorImageVersion,
    plannedOptional.minorImageVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:major-subsystem-version",
    parsedOptional.majorSubsystemVersion,
    plannedOptional.majorSubsystemVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:minor-subsystem-version",
    parsedOptional.minorSubsystemVersion,
    plannedOptional.minorSubsystemVersion,
  );
  compareNumber(
    diagnostics,
    "optional-header:win32-version-value",
    parsedOptional.win32VersionValue,
    plannedOptional.win32VersionValue,
  );
  compareNumber(
    diagnostics,
    "optional-header:size-of-image",
    parsedOptional.sizeOfImageBytes,
    plannedOptional.sizeOfImageBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:size-of-headers",
    parsedOptional.sizeOfHeadersBytes,
    plannedOptional.sizeOfHeadersBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:checksum",
    parsedOptional.checksum,
    plannedOptional.checksum,
  );
  compareNumber(
    diagnostics,
    "optional-header:subsystem",
    parsedOptional.subsystem,
    plannedOptional.subsystem,
  );
  compareNumber(
    diagnostics,
    "optional-header:dll-characteristics",
    parsedOptional.dllCharacteristics,
    plannedOptional.dllCharacteristics,
  );
  compareBigInt(
    diagnostics,
    "optional-header:size-of-stack-reserve",
    parsedOptional.sizeOfStackReserveBytes,
    plannedOptional.sizeOfStackReserveBytes,
  );
  compareBigInt(
    diagnostics,
    "optional-header:size-of-stack-commit",
    parsedOptional.sizeOfStackCommitBytes,
    plannedOptional.sizeOfStackCommitBytes,
  );
  compareBigInt(
    diagnostics,
    "optional-header:size-of-heap-reserve",
    parsedOptional.sizeOfHeapReserveBytes,
    plannedOptional.sizeOfHeapReserveBytes,
  );
  compareBigInt(
    diagnostics,
    "optional-header:size-of-heap-commit",
    parsedOptional.sizeOfHeapCommitBytes,
    plannedOptional.sizeOfHeapCommitBytes,
  );
  compareNumber(
    diagnostics,
    "optional-header:loader-flags",
    parsedOptional.loaderFlags,
    plannedOptional.loaderFlags,
  );
  compareNumber(
    diagnostics,
    "optional-header:number-of-rva-and-sizes",
    parsedOptional.numberOfRvaAndSizes,
    plannedOptional.numberOfRvaAndSizes,
  );
}

function compareDataDirectories(
  diagnostics: PeCoffWriterDiagnostic[],
  input: VerifyParsedPeCoffImageInput,
): void {
  const plannedDirectories = input.planned.headers.optionalHeader.dataDirectories;
  compareNumber(
    diagnostics,
    "data-directories:count",
    input.parsed.dataDirectories.length,
    plannedDirectories.length,
  );

  for (let index = 0; index < plannedDirectories.length; index += 1) {
    compareDirectory(diagnostics, dataDirectoryStableDetail(index), input, index);
  }
}

function dataDirectoryStableDetail(index: number): string {
  if (index === PE_EXCEPTION_DIRECTORY_INDEX) return "data-directory:exception";
  if (index === PE_BASE_RELOCATION_DIRECTORY_INDEX) return "data-directory:base-relocation";
  return `data-directory:${index}`;
}

function compareDirectory(
  diagnostics: PeCoffWriterDiagnostic[],
  stableDetail: string,
  input: VerifyParsedPeCoffImageInput,
  index: number,
): void {
  const parsed = input.parsed.dataDirectories[index];
  const planned = input.planned.headers.optionalHeader.dataDirectories[index];
  if (planned === undefined) return;
  if (parsed === undefined) {
    diagnostics.push(verificationDiagnostic(stableDetail));
    return;
  }
  if (parsed.rva !== planned.rva || parsed.sizeBytes !== planned.sizeBytes) {
    diagnostics.push(verificationDiagnostic(stableDetail));
  }
}

function compareSections(
  diagnostics: PeCoffWriterDiagnostic[],
  input: VerifyParsedPeCoffImageInput,
): void {
  compareNumber(
    diagnostics,
    "sections:count",
    parsedSectionHeaders(input.parsed).length,
    input.planned.sections.length,
  );

  for (const [index, planned] of input.planned.sections.entries()) {
    const parsed = parsedSectionHeaders(input.parsed)[index];
    if (parsed === undefined) {
      diagnostics.push(verificationDiagnostic(`section:${planned.sectionKey}:missing`));
      continue;
    }

    compareString(
      diagnostics,
      `section:${planned.sectionKey}:name`,
      parsed.name,
      planned.serializedName,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:virtual-size`,
      parsed.virtualSizeBytes,
      planned.virtualSizeBytes,
    );
    compareNumber(diagnostics, `section:${planned.sectionKey}:rva`, parsed.rva, planned.rva);
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:raw-size`,
      parsed.rawDataSizeBytes,
      planned.rawDataSizeBytes,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:raw-pointer`,
      parsed.rawDataPointerBytes,
      planned.rawDataPointerBytes,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:characteristics`,
      parsed.characteristics,
      planned.characteristics,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:pointer-to-relocations`,
      parsed.pointerToRelocations,
      0,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:pointer-to-line-numbers`,
      parsed.pointerToLineNumbers,
      0,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:number-of-relocations`,
      parsed.numberOfRelocations,
      0,
    );
    compareNumber(
      diagnostics,
      `section:${planned.sectionKey}:number-of-line-numbers`,
      parsed.numberOfLineNumbers,
      0,
    );
    compareSectionBytes(
      diagnostics,
      `section:${planned.sectionKey}:bytes`,
      parsed.rawBytes,
      planned.bytes,
    );
  }
}

function parsedSectionHeaders(parsed: ParsedPeCoffImage): readonly ParsedPeSectionHeader[] {
  return parsed.sectionHeaders;
}

function compareBaseRelocations(
  diagnostics: PeCoffWriterDiagnostic[],
  input: VerifyParsedPeCoffImageInput,
): void {
  const plannedEntries = plannedBaseRelocationEntries(input.planned);
  const parsedEntries = input.parsed.baseRelocationBlocks
    .flatMap((block) => block.entries)
    .filter((entry) => entry.type !== PE_IMAGE_REL_BASED_ABSOLUTE)
    .map((entry) =>
      Object.freeze({
        rva: entry.rva,
        type: entry.type,
      }),
    );

  if (!relocationEntriesEqual(plannedEntries, parsedEntries)) {
    diagnostics.push(verificationDiagnostic("base-relocations:entries"));
  }
}

function plannedBaseRelocationEntries(
  planned: PlannedPeCoffImage,
): readonly RelocationEntryForComparison[] {
  const relocSection = planned.sections.find((section) => section.sectionKey === ".reloc");
  if (relocSection === undefined) return Object.freeze([]);

  const entries: RelocationEntryForComparison[] = [];
  let offset = 0;
  while (offset + 8 <= relocSection.bytes.length) {
    const pageRva = readU32Le(relocSection.bytes, offset);
    const blockSizeBytes = readU32Le(relocSection.bytes, offset + 4);
    const blockEnd = offset + blockSizeBytes;
    for (let entryOffset = offset + 8; entryOffset + 2 <= blockEnd; entryOffset += 2) {
      const encodedEntry = readU16Le(relocSection.bytes, entryOffset);
      const type = encodedEntry >>> 12;
      if (type !== PE_IMAGE_REL_BASED_ABSOLUTE) {
        entries.push(
          Object.freeze({
            type,
            rva: pageRva + (encodedEntry & 0x0fff),
          }),
        );
      }
    }
    offset = blockEnd;
  }
  return Object.freeze(entries);
}

function relocationEntriesEqual(
  planned: readonly RelocationEntryForComparison[],
  parsed: readonly RelocationEntryForComparison[],
): boolean {
  if (planned.length !== parsed.length) return false;
  for (const [index, plannedEntry] of planned.entries()) {
    const parsedEntry = parsed[index];
    if (parsedEntry === undefined) return false;
    if (plannedEntry.rva !== parsedEntry.rva || plannedEntry.type !== parsedEntry.type) {
      return false;
    }
  }
  return true;
}

function compareNumber(
  diagnostics: PeCoffWriterDiagnostic[],
  stableDetail: string,
  parsed: number,
  planned: number,
): void {
  if (parsed !== planned) diagnostics.push(verificationDiagnostic(stableDetail));
}

function compareBigInt(
  diagnostics: PeCoffWriterDiagnostic[],
  stableDetail: string,
  parsed: bigint,
  planned: bigint,
): void {
  if (parsed !== planned) diagnostics.push(verificationDiagnostic(stableDetail));
}

function compareString(
  diagnostics: PeCoffWriterDiagnostic[],
  stableDetail: string,
  parsed: string,
  planned: string,
): void {
  if (parsed !== planned) diagnostics.push(verificationDiagnostic(stableDetail));
}

function compareSectionBytes(
  diagnostics: PeCoffWriterDiagnostic[],
  stableDetail: string,
  parsed: ArrayLike<number>,
  planned: ArrayLike<number>,
): void {
  if (parsed.length < planned.length) {
    diagnostics.push(verificationDiagnostic(stableDetail));
    return;
  }
  for (let index = 0; index < planned.length; index += 1) {
    const plannedByte = planned[index];
    if (parsed[index] !== plannedByte) {
      diagnostics.push(verificationDiagnostic(stableDetail));
      return;
    }
  }
  for (let index = planned.length; index < parsed.length; index += 1) {
    if (parsed[index] !== 0) {
      diagnostics.push(verificationDiagnostic(stableDetail));
      return;
    }
  }
}

function readU16Le(bytes: ArrayLike<number>, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32Le(bytes: ArrayLike<number>, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! * 2 ** 24)) >>>
    0
  );
}

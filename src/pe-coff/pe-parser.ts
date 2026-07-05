import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";
import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DATA_DIRECTORY_COUNT,
  PE_DATA_DIRECTORY_SIZE_BYTES,
  PE_DOS_HEADER_SIZE_BYTES,
  PE_HEADER_OFFSET_BYTES,
  PE_MACHINE_ARM64,
  PE_SECTION_HEADER_SIZE_BYTES,
  PE_SIGNATURE_BYTES,
  PE32_PLUS_MAGIC,
  PE32_PLUS_OPTIONAL_HEADER_FIXED_SIZE_BYTES,
  PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
} from "./headers";

const PE_SIGNATURE_SIZE_BYTES = 4;
const BASE_RELOCATION_DIRECTORY_INDEX = 5;

const PARSER_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-parser",
      runKey: "parse",
      status: "passed" as const,
    }),
  ]),
});

export interface ParsedPeDosHeader {
  readonly e_lfanew: number;
}

export interface ParsedPeCoffHeader {
  readonly machine: number;
  readonly numberOfSections: number;
  readonly timeDateStamp: number;
  readonly pointerToSymbolTable: number;
  readonly numberOfSymbols: number;
  readonly sizeOfOptionalHeader: number;
  readonly characteristics: number;
}

export interface ParsedPe32PlusOptionalHeader {
  readonly magic: number;
  readonly majorLinkerVersion: number;
  readonly minorLinkerVersion: number;
  readonly sizeOfCodeBytes: number;
  readonly sizeOfInitializedDataBytes: number;
  readonly sizeOfUninitializedDataBytes: number;
  readonly addressOfEntryPoint: number;
  readonly baseOfCode: number;
  readonly imageBase: bigint;
  readonly sectionAlignmentBytes: number;
  readonly fileAlignmentBytes: number;
  readonly majorOperatingSystemVersion: number;
  readonly minorOperatingSystemVersion: number;
  readonly majorImageVersion: number;
  readonly minorImageVersion: number;
  readonly majorSubsystemVersion: number;
  readonly minorSubsystemVersion: number;
  readonly win32VersionValue: number;
  readonly sizeOfImageBytes: number;
  readonly sizeOfHeadersBytes: number;
  readonly checksum: number;
  readonly subsystem: number;
  readonly dllCharacteristics: number;
  readonly sizeOfStackReserveBytes: bigint;
  readonly sizeOfStackCommitBytes: bigint;
  readonly sizeOfHeapReserveBytes: bigint;
  readonly sizeOfHeapCommitBytes: bigint;
  readonly loaderFlags: number;
  readonly numberOfRvaAndSizes: number;
}

export interface ParsedPeDataDirectory {
  readonly rva: number;
  readonly sizeBytes: number;
}

export interface ParsedPeSectionHeader {
  readonly name: string;
  readonly virtualSizeBytes: number;
  readonly rva: number;
  readonly rawDataSizeBytes: number;
  readonly rawDataPointerBytes: number;
  readonly pointerToRelocations: number;
  readonly pointerToLineNumbers: number;
  readonly numberOfRelocations: number;
  readonly numberOfLineNumbers: number;
  readonly characteristics: number;
  readonly bytes: Uint8Array;
  readonly rawBytes: Uint8Array;
}

export interface ParsedPeBaseRelocationEntry {
  readonly type: number;
  readonly offset: number;
  readonly rva: number;
}

export interface ParsedPeBaseRelocationBlock {
  readonly pageRva: number;
  readonly blockSizeBytes: number;
  readonly entries: readonly ParsedPeBaseRelocationEntry[];
}

export interface ParsedPeCoffImage {
  readonly dosHeader: ParsedPeDosHeader;
  readonly coffHeader: ParsedPeCoffHeader;
  readonly optionalHeader: ParsedPe32PlusOptionalHeader;
  readonly dataDirectories: readonly ParsedPeDataDirectory[];
  readonly sections?: readonly ParsedPeSectionHeader[];
  readonly sectionHeaders: readonly ParsedPeSectionHeader[];
  readonly baseRelocationBlocks: readonly ParsedPeBaseRelocationBlock[];
}

interface Reader {
  readonly bytes: Uint8Array;
}

type ParsedSectionName =
  | {
      readonly kind: "ok";
      readonly name: string;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
    };

function parseDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_PARSE_FAILED",
    ownerKey: "pe-coff-parser",
    stableDetail,
  });
}

function parseError<Value>(stableDetail: string): PeCoffWriterResult<Value> {
  return peCoffError({
    diagnostics: [parseDiagnostic(stableDetail)],
    verification: PARSER_VERIFICATION,
  });
}

export function parsePeCoffImage(bytes: ArrayLike<number>): PeCoffWriterResult<ParsedPeCoffImage> {
  try {
    const byteValidation = validateBytes(bytes);
    if (byteValidation !== undefined) return parseError(byteValidation);
    return parsePeCoffImageStrict(Object.freeze({ bytes: Uint8Array.from(bytes) }));
  } catch {
    return parseError("parser:unexpected-exception");
  }
}

function validateBytes(bytes: ArrayLike<number>): string | undefined {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      return `input-byte:invalid:${index}:${String(byte)}`;
    }
  }
  return undefined;
}

function parsePeCoffImageStrict(reader: Reader): PeCoffWriterResult<ParsedPeCoffImage> {
  if (reader.bytes.length < PE_DOS_HEADER_SIZE_BYTES) {
    return parseError("dos-header:truncated");
  }
  if (readU8(reader, 0) !== 0x4d || readU8(reader, 1) !== 0x5a) {
    return parseError("dos-header:magic");
  }
  const dosPrefixPadding = firstNonZeroOffset(reader, 2, 0x3c);
  if (dosPrefixPadding !== undefined) {
    return parseError(`dos-header:padding-nonzero:${dosPrefixPadding}`);
  }

  const e_lfanew = readU32Le(reader, 0x3c);
  if (e_lfanew !== PE_HEADER_OFFSET_BYTES) {
    return parseError(`dos-header:e_lfanew:invalid:${e_lfanew}`);
  }
  if (e_lfanew + PE_SIGNATURE_SIZE_BYTES > reader.bytes.length) {
    return parseError(`dos-header:e_lfanew:out-of-bounds:${e_lfanew}`);
  }
  const dosSuffixPadding = firstNonZeroOffset(reader, PE_DOS_HEADER_SIZE_BYTES, e_lfanew);
  if (dosSuffixPadding !== undefined) {
    return parseError(`dos-header:padding-nonzero:${dosSuffixPadding}`);
  }
  if (!bytesEqual(reader.bytes, e_lfanew, PE_SIGNATURE_BYTES)) {
    return parseError("pe-signature:missing");
  }

  const coffHeaderOffset = e_lfanew + PE_SIGNATURE_SIZE_BYTES;
  if (coffHeaderOffset + PE_COFF_FILE_HEADER_SIZE_BYTES > reader.bytes.length) {
    return parseError("coff-header:truncated");
  }
  const coffHeader = parseCoffHeader(reader, coffHeaderOffset);
  if (coffHeader.machine !== PE_MACHINE_ARM64) {
    return parseError(`coff-header:machine:${coffHeader.machine}`);
  }
  if (coffHeader.sizeOfOptionalHeader !== PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES) {
    return parseError(`optional-header:size:${coffHeader.sizeOfOptionalHeader}`);
  }

  const optionalHeaderOffset = coffHeaderOffset + PE_COFF_FILE_HEADER_SIZE_BYTES;
  if (optionalHeaderOffset + PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES > reader.bytes.length) {
    return parseError("optional-header:truncated");
  }
  const optionalHeader = parseOptionalHeader(reader, optionalHeaderOffset);
  if (optionalHeader.magic !== PE32_PLUS_MAGIC) {
    return parseError(`optional-header:magic:${optionalHeader.magic}`);
  }
  if (optionalHeader.numberOfRvaAndSizes !== PE_DATA_DIRECTORY_COUNT) {
    return parseError(`optional-header:directory-count:${optionalHeader.numberOfRvaAndSizes}`);
  }

  const dataDirectories = parseDataDirectories(reader, optionalHeaderOffset);
  const sectionTableOffset = optionalHeaderOffset + coffHeader.sizeOfOptionalHeader;
  const sectionTableSize = coffHeader.numberOfSections * PE_SECTION_HEADER_SIZE_BYTES;
  const sectionTableEndOffset = sectionTableOffset + sectionTableSize;
  if (sectionTableEndOffset > reader.bytes.length) {
    return parseError("section-table:truncated");
  }
  if (optionalHeader.sizeOfHeadersBytes > reader.bytes.length) {
    return parseError(`headers:size-exceeds-file:${optionalHeader.sizeOfHeadersBytes}`);
  }
  if (sectionTableEndOffset > optionalHeader.sizeOfHeadersBytes) {
    return parseError(
      `headers:section-table-exceeds-size:${sectionTableEndOffset}:${optionalHeader.sizeOfHeadersBytes}`,
    );
  }
  const headerPadding = firstNonZeroOffset(
    reader,
    sectionTableEndOffset,
    optionalHeader.sizeOfHeadersBytes,
  );
  if (headerPadding !== undefined) {
    return parseError(`headers:padding-nonzero:${headerPadding}`);
  }
  const parsedSections = parseSections(reader, sectionTableOffset, coffHeader.numberOfSections);
  if (parsedSections.kind === "error") return parsedSections;
  const sections = parsedSections.value;
  for (const section of sections) {
    if (section.rawDataPointerBytes + section.rawDataSizeBytes > reader.bytes.length) {
      return parseError(`section-raw-range:exceeds-file:${section.name}`);
    }
  }
  const relocationBlocks = parseBaseRelocationBlocks(reader, dataDirectories, sections);
  if (relocationBlocks.kind === "error") return relocationBlocks;

  const expectedFileSizeBytes = finalRawDataEnd(sections, optionalHeader.sizeOfHeadersBytes);
  if (reader.bytes.length !== expectedFileSizeBytes) {
    return parseError(`file:trailing-bytes:${expectedFileSizeBytes}:${reader.bytes.length}`);
  }

  return peCoffOk({
    value: Object.freeze({
      dosHeader: Object.freeze({ e_lfanew }),
      coffHeader,
      optionalHeader,
      dataDirectories: Object.freeze(dataDirectories),
      sections: Object.freeze(sections),
      sectionHeaders: Object.freeze(sections),
      baseRelocationBlocks: relocationBlocks.value,
    }),
    verification: PARSER_VERIFICATION,
  });
}

function parseCoffHeader(reader: Reader, offset: number): ParsedPeCoffHeader {
  return Object.freeze({
    machine: readU16Le(reader, offset),
    numberOfSections: readU16Le(reader, offset + 2),
    timeDateStamp: readU32Le(reader, offset + 4),
    pointerToSymbolTable: readU32Le(reader, offset + 8),
    numberOfSymbols: readU32Le(reader, offset + 12),
    sizeOfOptionalHeader: readU16Le(reader, offset + 16),
    characteristics: readU16Le(reader, offset + 18),
  });
}

function parseOptionalHeader(reader: Reader, offset: number): ParsedPe32PlusOptionalHeader {
  return Object.freeze({
    magic: readU16Le(reader, offset),
    majorLinkerVersion: readU8(reader, offset + 2),
    minorLinkerVersion: readU8(reader, offset + 3),
    sizeOfCodeBytes: readU32Le(reader, offset + 4),
    sizeOfInitializedDataBytes: readU32Le(reader, offset + 8),
    sizeOfUninitializedDataBytes: readU32Le(reader, offset + 12),
    addressOfEntryPoint: readU32Le(reader, offset + 16),
    baseOfCode: readU32Le(reader, offset + 20),
    imageBase: readU64Le(reader, offset + 24),
    sectionAlignmentBytes: readU32Le(reader, offset + 32),
    fileAlignmentBytes: readU32Le(reader, offset + 36),
    majorOperatingSystemVersion: readU16Le(reader, offset + 40),
    minorOperatingSystemVersion: readU16Le(reader, offset + 42),
    majorImageVersion: readU16Le(reader, offset + 44),
    minorImageVersion: readU16Le(reader, offset + 46),
    majorSubsystemVersion: readU16Le(reader, offset + 48),
    minorSubsystemVersion: readU16Le(reader, offset + 50),
    win32VersionValue: readU32Le(reader, offset + 52),
    sizeOfImageBytes: readU32Le(reader, offset + 56),
    sizeOfHeadersBytes: readU32Le(reader, offset + 60),
    checksum: readU32Le(reader, offset + 64),
    subsystem: readU16Le(reader, offset + 68),
    dllCharacteristics: readU16Le(reader, offset + 70),
    sizeOfStackReserveBytes: readU64Le(reader, offset + 72),
    sizeOfStackCommitBytes: readU64Le(reader, offset + 80),
    sizeOfHeapReserveBytes: readU64Le(reader, offset + 88),
    sizeOfHeapCommitBytes: readU64Le(reader, offset + 96),
    loaderFlags: readU32Le(reader, offset + 104),
    numberOfRvaAndSizes: readU32Le(reader, offset + 108),
  });
}

function parseDataDirectories(
  reader: Reader,
  optionalHeaderOffset: number,
): ParsedPeDataDirectory[] {
  const directories: ParsedPeDataDirectory[] = [];
  const directoryOffset = optionalHeaderOffset + PE32_PLUS_OPTIONAL_HEADER_FIXED_SIZE_BYTES;
  for (let index = 0; index < PE_DATA_DIRECTORY_COUNT; index += 1) {
    const offset = directoryOffset + index * PE_DATA_DIRECTORY_SIZE_BYTES;
    directories.push(
      Object.freeze({
        rva: readU32Le(reader, offset),
        sizeBytes: readU32Le(reader, offset + 4),
      }),
    );
  }
  return directories;
}

function parseSections(
  reader: Reader,
  sectionTableOffset: number,
  count: number,
): PeCoffWriterResult<readonly ParsedPeSectionHeader[]> {
  const sections: ParsedPeSectionHeader[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = sectionTableOffset + index * PE_SECTION_HEADER_SIZE_BYTES;
    const sectionName = readNullPaddedAscii(reader, offset, 8);
    if (sectionName.kind === "error") return parseError(sectionName.stableDetail);
    const virtualSizeBytes = readU32Le(reader, offset + 8);
    const rawDataSizeBytes = readU32Le(reader, offset + 16);
    const rawDataPointerBytes = readU32Le(reader, offset + 20);
    const rawBytes = reader.bytes.slice(
      rawDataPointerBytes,
      rawDataPointerBytes + rawDataSizeBytes,
    );
    sections.push(
      Object.freeze({
        name: sectionName.name,
        virtualSizeBytes,
        rva: readU32Le(reader, offset + 12),
        rawDataSizeBytes,
        rawDataPointerBytes,
        pointerToRelocations: readU32Le(reader, offset + 24),
        pointerToLineNumbers: readU32Le(reader, offset + 28),
        numberOfRelocations: readU16Le(reader, offset + 32),
        numberOfLineNumbers: readU16Le(reader, offset + 34),
        characteristics: readU32Le(reader, offset + 36),
        bytes: rawBytes.slice(0, Math.min(rawBytes.length, virtualSizeBytes)),
        rawBytes,
      }),
    );
  }
  return peCoffOk({ value: Object.freeze(sections), verification: PARSER_VERIFICATION });
}

function parseBaseRelocationBlocks(
  reader: Reader,
  dataDirectories: readonly ParsedPeDataDirectory[],
  sections: readonly ParsedPeSectionHeader[],
): PeCoffWriterResult<readonly ParsedPeBaseRelocationBlock[]> {
  const directory = dataDirectories[BASE_RELOCATION_DIRECTORY_INDEX]!;
  if (directory.rva === 0 && directory.sizeBytes === 0) {
    return peCoffOk({ value: Object.freeze([]), verification: PARSER_VERIFICATION });
  }
  if (directory.rva === 0 || directory.sizeBytes === 0) {
    return parseError(
      `base-relocation-directory:incomplete:${directory.rva}:${directory.sizeBytes}`,
    );
  }
  const section = sections.find((candidate) =>
    containsRvaRange(candidate, directory.rva, directory.sizeBytes),
  );
  if (section === undefined) {
    return parseError(`base-relocation-directory:section-missing:${directory.rva}`);
  }
  const rawOffset = section.rawDataPointerBytes + (directory.rva - section.rva);
  if (rawOffset + directory.sizeBytes > section.rawDataPointerBytes + section.rawDataSizeBytes) {
    return parseError("base-relocation-directory:range-exceeds-section");
  }
  if (rawOffset + directory.sizeBytes > reader.bytes.length) {
    return parseError("base-relocation-directory:range-exceeds-file");
  }

  const blocks: ParsedPeBaseRelocationBlock[] = [];
  const directoryEnd = rawOffset + directory.sizeBytes;
  let cursor = rawOffset;
  while (cursor < directoryEnd) {
    if (cursor + 8 > directoryEnd) return parseError("base-relocation:block-header-truncated");
    const pageRva = readU32Le(reader, cursor);
    const blockSizeBytes = readU32Le(reader, cursor + 4);
    if (pageRva % 0x1000 !== 0) {
      return parseError(`base-relocation:page-rva-misaligned:${pageRva}`);
    }
    if (blockSizeBytes < 8) {
      return parseError(`base-relocation:block-size-too-small:${blockSizeBytes}`);
    }
    if (blockSizeBytes % 4 !== 0) {
      return parseError(`base-relocation:block-size-unaligned:${blockSizeBytes}`);
    }
    if (cursor + blockSizeBytes > directoryEnd) {
      return parseError("base-relocation:block-overflow");
    }

    const entries: ParsedPeBaseRelocationEntry[] = [];
    for (let entryOffset = cursor + 8; entryOffset < cursor + blockSizeBytes; entryOffset += 2) {
      const encodedEntry = readU16Le(reader, entryOffset);
      const type = encodedEntry >> 12;
      const offset = encodedEntry & 0x0fff;
      if (offset > 0xfff) {
        return parseError(`base-relocation:entry-offset:${offset}`);
      }
      entries.push(Object.freeze({ type, offset, rva: pageRva + offset }));
    }
    blocks.push(Object.freeze({ pageRva, blockSizeBytes, entries: Object.freeze(entries) }));
    cursor += blockSizeBytes;
  }

  if (cursor !== directoryEnd) return parseError("base-relocation:directory-size-mismatch");
  return peCoffOk({ value: Object.freeze(blocks), verification: PARSER_VERIFICATION });
}

function containsRvaRange(section: ParsedPeSectionHeader, rva: number, sizeBytes: number): boolean {
  return rva >= section.rva && rva + sizeBytes <= section.rva + section.virtualSizeBytes;
}

function readU8(reader: Reader, offset: number): number {
  return reader.bytes[offset] ?? 0;
}

function readU16Le(reader: Reader, offset: number): number {
  return readU8(reader, offset) | (readU8(reader, offset + 1) << 8);
}

function readU32Le(reader: Reader, offset: number): number {
  return (
    (readU8(reader, offset) |
      (readU8(reader, offset + 1) << 8) |
      (readU8(reader, offset + 2) << 16) |
      (readU8(reader, offset + 3) * 2 ** 24)) >>>
    0
  );
}

function readU64Le(reader: Reader, offset: number): bigint {
  let result = 0n;
  for (let index = 0; index < 8; index += 1) {
    result |= BigInt(readU8(reader, offset + index)) << BigInt(index * 8);
  }
  return result;
}

function readNullPaddedAscii(reader: Reader, offset: number, width: number): ParsedSectionName {
  const characters: string[] = [];
  let foundPadding = false;
  for (let index = 0; index < width; index += 1) {
    const byte = readU8(reader, offset + index);
    if (byte === 0) {
      foundPadding = true;
      continue;
    }
    if (foundPadding) {
      return Object.freeze({
        kind: "error" as const,
        stableDetail: `section-name:padding-nonzero:${characters.join("")}:${offset + index}`,
      });
    }
    if (byte > 0x7f) {
      return Object.freeze({
        kind: "error" as const,
        stableDetail: `section-name:non-ascii:${offset + index}:${byte}`,
      });
    }
    characters.push(String.fromCharCode(byte));
  }
  return Object.freeze({ kind: "ok" as const, name: characters.join("") });
}

function finalRawDataEnd(
  sections: readonly ParsedPeSectionHeader[],
  sizeOfHeadersBytes: number,
): number {
  let endOffset = sizeOfHeadersBytes;
  for (const section of sections) {
    if (section.rawDataSizeBytes === 0) continue;
    endOffset = Math.max(endOffset, section.rawDataPointerBytes + section.rawDataSizeBytes);
  }
  return endOffset;
}

function firstNonZeroOffset(
  reader: Reader,
  startOffset: number,
  endOffset: number,
): number | undefined {
  for (let offset = startOffset; offset < endOffset; offset += 1) {
    if (readU8(reader, offset) !== 0) return offset;
  }
  return undefined;
}

function bytesEqual(
  bytes: ArrayLike<number>,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

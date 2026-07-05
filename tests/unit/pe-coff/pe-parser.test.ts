import { describe, expect, test } from "bun:test";

import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DATA_DIRECTORY_COUNT,
  PE_HEADER_OFFSET_BYTES,
  PE_SECTION_HEADER_SIZE_BYTES,
  PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
  parsePeCoffImage,
  planPeCoffSections,
  planPeDataDirectories,
  planPeHeaders,
  serializePeBaseRelocations,
} from "../../../src/pe-coff";
import { serializePlannedPeCoffImage } from "../../../src/pe-coff/aarch64/aarch64-pe-coff-efi-writer";
import {
  dir64RelocationForTest,
  linkedImageLayoutForPeCoffTest,
  serializedImageBytesForParserTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

const PE_SIGNATURE_SIZE_BYTES = 4;
const COFF_HEADER_OFFSET = PE_HEADER_OFFSET_BYTES + PE_SIGNATURE_SIZE_BYTES;
const OPTIONAL_HEADER_OFFSET = COFF_HEADER_OFFSET + PE_COFF_FILE_HEADER_SIZE_BYTES;
const SECTION_TABLE_OFFSET = OPTIONAL_HEADER_OFFSET + PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES;
const BASE_RELOCATION_DIRECTORY_OFFSET = OPTIONAL_HEADER_OFFSET + 112 + 5 * 8;

describe("strict PE/COFF parser", () => {
  test("parses a serialized PE32+ image", () => {
    const result = parsePeCoffImage(serializedImageBytesForParserTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected parsed image");
    expect(result.value.dosHeader.e_lfanew).toBe(0x80);
    expect(result.value.coffHeader.machine).toBe(0xaa64);
    expect(result.value.optionalHeader.magic).toBe(0x20b);
    expect(result.value.dataDirectories).toHaveLength(PE_DATA_DIRECTORY_COUNT);
    expect(result.value.sectionHeaders.map((section) => section.name)).toEqual([
      ".text",
      ".pdata",
      ".xdata",
      ".data",
    ]);
  });

  test("parses base relocation blocks including absolute padding entries", () => {
    const bytes = serializedImageWithBaseRelocations();

    const result = parsePeCoffImage(bytes);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected parsed image");
    expect(result.value.baseRelocationBlocks).toEqual([
      {
        pageRva: 0x4000,
        blockSizeBytes: 12,
        entries: [
          { type: 10, offset: 0, rva: 0x4000 },
          { type: 0, offset: 0, rva: 0x4000 },
        ],
      },
    ]);
  });

  test("rejects malformed headers with deterministic diagnostics", () => {
    expect(stableDetails([0x4d])).toContain("dos-header:truncated");
    expect(stableDetails(patchedBytes(serializedImageBytesForParserTest(), 0, [0x00]))).toContain(
      "dos-header:magic",
    );
    expect(
      stableDetails(patchedBytes(serializedImageBytesForParserTest(), 0x02, [0x01])),
    ).toContain("dos-header:padding-nonzero:2");
    expect(stableDetails(patchedU32Le(serializedImageBytesForParserTest(), 0x3c, 0x3f))).toContain(
      "dos-header:e_lfanew:invalid:63",
    );
    expect(stableDetails(imageWithMovedPeHeader())).toContain("dos-header:e_lfanew:invalid:144");
    expect(
      stableDetails(patchedBytes(serializedImageBytesForParserTest(), PE_HEADER_OFFSET_BYTES, [0])),
    ).toContain("pe-signature:missing");
    expect(
      stableDetails(serializedImageBytesForParserTest().slice(0, COFF_HEADER_OFFSET + 2)),
    ).toContain("coff-header:truncated");
    expect(
      stableDetails(patchedBytes(serializedImageBytesForParserTest(), 0x300, [0x01])),
    ).toContain("headers:padding-nonzero:768");
    expect(
      stableDetails(patchedU16Le(serializedImageBytesForParserTest(), COFF_HEADER_OFFSET, 0x8664)),
    ).toContain("coff-header:machine:34404");
    expect(
      stableDetails(patchedU16Le(serializedImageBytesForParserTest(), COFF_HEADER_OFFSET + 16, 0)),
    ).toContain("optional-header:size:0");
    expect(
      stableDetails(
        patchedU16Le(serializedImageBytesForParserTest(), OPTIONAL_HEADER_OFFSET, 0x10b),
      ),
    ).toContain("optional-header:magic:267");
    expect(
      stableDetails(
        patchedU32Le(serializedImageBytesForParserTest(), OPTIONAL_HEADER_OFFSET + 108, 15),
      ),
    ).toContain("optional-header:directory-count:15");
  });

  test("rejects section table and raw section ranges outside the file", () => {
    const bytes = serializedImageBytesForParserTest();

    expect(
      stableDetails(bytes.slice(0, SECTION_TABLE_OFFSET + PE_SECTION_HEADER_SIZE_BYTES - 1)),
    ).toContain("section-table:truncated");
    expect(stableDetails(patchedU32Le(bytes, SECTION_TABLE_OFFSET + 20, bytes.length))).toContain(
      "section-raw-range:exceeds-file:.text",
    );
  });

  test("rejects nonzero section name padding and trailing file bytes", () => {
    const bytes = serializedImageBytesForParserTest();

    expect(stableDetails(patchedBytes(bytes, SECTION_TABLE_OFFSET + 6, [0x41]))).toContain(
      `section-name:padding-nonzero:.text:${SECTION_TABLE_OFFSET + 6}`,
    );
    expect(stableDetails([...bytes, 0])).toContain(
      `file:trailing-bytes:${bytes.length}:${bytes.length + 1}`,
    );
  });

  test("rejects malformed relocation directories and blocks", () => {
    const bytes = serializedImageWithBaseRelocations();

    expect(stableDetails(patchedU32Le(bytes, BASE_RELOCATION_DIRECTORY_OFFSET + 4, 0))).toContain(
      "base-relocation-directory:incomplete:20480:0",
    );
    expect(stableDetails(patchedU32Le(bytes, BASE_RELOCATION_DIRECTORY_OFFSET, 0x9000))).toContain(
      "base-relocation-directory:section-missing:36864",
    );
    expect(stableDetails(patchedU32Le(bytes, relocSectionHeaderOffset(bytes) + 16, 8))).toContain(
      "base-relocation-directory:range-exceeds-section",
    );
    expect(stableDetails(patchedU32Le(bytes, relocationRawOffset(bytes) + 4, 7))).toContain(
      "base-relocation:block-size-too-small:7",
    );
    expect(stableDetails(patchedU32Le(bytes, relocationRawOffset(bytes) + 4, 10))).toContain(
      "base-relocation:block-size-unaligned:10",
    );
    expect(stableDetails(patchedU32Le(bytes, relocationRawOffset(bytes) + 4, 16))).toContain(
      "base-relocation:block-overflow",
    );
    expect(stableDetails(patchedU32Le(bytes, relocationRawOffset(bytes), 0x4001))).toContain(
      "base-relocation:page-rva-misaligned:16385",
    );
  });

  test("returns diagnostics instead of throwing for arbitrary byte arrays", () => {
    for (const bytes of [
      [],
      [0x4d],
      [0xff, 0x00, 0x10],
      Array.from({ length: 300 }, (_unusedValue, index) => index),
    ]) {
      expect(() => parsePeCoffImage(bytes)).not.toThrow();
      expect(parsePeCoffImage(bytes).kind).toBe("error");
    }
  });

  test("rejects non-byte input values before reading fields", () => {
    const result = parsePeCoffImage([0x4d, 0x5a, 0x1ff]);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "input-byte:invalid:2:511",
    );
  });
});

function stableDetails(bytes: ArrayLike<number>): readonly string[] {
  const result = parsePeCoffImage(bytes);
  expect(result.kind).toBe("error");
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

function serializedImageWithBaseRelocations(): Uint8Array {
  const target = writerTargetForTest();
  const layout = linkedImageLayoutForPeCoffTest({
    baseRelocations: [dir64RelocationForTest({ rva: 0x4000 })],
  });
  const relocations = serializePeBaseRelocations({ target, relocations: layout.baseRelocations });
  if (relocations.kind !== "ok") throw new Error("expected relocations");
  const sections = planPeCoffSections({
    target,
    layout,
    baseRelocationTableBytes: relocations.value.bytes,
  });
  if (sections.kind !== "ok") throw new Error("expected sections");
  const directories = planPeDataDirectories({
    target,
    layout,
    sections: sections.value.sections,
    baseRelocationTableSizeBytes: relocations.value.bytes.length,
  });
  if (directories.kind !== "ok") throw new Error("expected directories");
  const headers = planPeHeaders({
    target,
    layout,
    sections: sections.value.sections,
    dataDirectories: directories.value.directories,
  });
  if (headers.kind !== "ok") throw new Error("expected headers");
  const serialized = serializePlannedPeCoffImage({
    headers: headers.value,
    sections: sections.value.sections,
  });
  if (serialized.kind !== "ok") throw new Error("expected image");
  return serialized.value.bytes;
}

function relocationRawOffset(bytes: ArrayLike<number>): number {
  const result = parsePeCoffImage(bytes);
  if (result.kind !== "ok") throw new Error("expected parsed image");
  const reloc = result.value.sectionHeaders.find((section) => section.name === ".reloc");
  if (reloc === undefined) throw new Error("expected reloc section");
  return reloc.rawDataPointerBytes;
}

function relocSectionHeaderOffset(bytes: ArrayLike<number>): number {
  const result = parsePeCoffImage(bytes);
  if (result.kind !== "ok") throw new Error("expected parsed image");
  const relocIndex = result.value.sectionHeaders.findIndex((section) => section.name === ".reloc");
  if (relocIndex < 0) throw new Error("expected reloc section");
  return SECTION_TABLE_OFFSET + relocIndex * PE_SECTION_HEADER_SIZE_BYTES;
}

function patchedBytes(
  source: ArrayLike<number>,
  offset: number,
  replacement: readonly number[],
): readonly number[] {
  const result = Array.from(source);
  for (const [index, byte] of replacement.entries()) result[offset + index] = byte;
  return result;
}

function patchedU16Le(source: ArrayLike<number>, offset: number, value: number): readonly number[] {
  return patchedBytes(source, offset, [value & 0xff, (value >> 8) & 0xff]);
}

function patchedU32Le(source: ArrayLike<number>, offset: number, value: number): readonly number[] {
  return patchedBytes(source, offset, [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    Math.floor(value / 2 ** 24) & 0xff,
  ]);
}

function imageWithMovedPeHeader(): readonly number[] {
  const source = serializedImageBytesForParserTest();
  const movedPeHeaderOffset = 0x90;
  const result = Array.from({ length: source.length + 0x10 }, () => 0);
  for (let index = 0; index < PE_HEADER_OFFSET_BYTES; index += 1) {
    result[index] = source[index]!;
  }
  for (let index = PE_HEADER_OFFSET_BYTES; index < source.length; index += 1) {
    result[index + 0x10] = source[index]!;
  }
  return patchedU32Le(result, 0x3c, movedPeHeaderOffset);
}

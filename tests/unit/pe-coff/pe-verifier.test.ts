import { describe, expect, test } from "bun:test";

import type { PlannedPeCoffImage } from "../../../src/pe-coff";
import {
  planPeCoffSections,
  planPeDataDirectories,
  planPeHeaders,
  parsePeCoffImage,
  verifyParsedPeCoffImage,
  type ParsedPeCoffImage,
} from "../../../src/pe-coff";
import {
  dir64RelocationForTest,
  linkedImageLayoutForPeCoffTest,
  plannedImageForWriterTest,
  serializedPlannedImageForTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";
import { serializePeBaseRelocations } from "../../../src/pe-coff/pe-relocations";

function stableDetails(result: {
  readonly diagnostics: readonly { readonly stableDetail: string }[];
}) {
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

function parsedImageForVerifierTest(planned: PlannedPeCoffImage = plannedImageForWriterTest()) {
  const relocSection = planned.sections.find((section) => section.sectionKey === ".reloc");
  return {
    dosHeader: {
      e_lfanew: planned.headers.dosHeader.peHeaderOffsetBytes,
    },
    coffHeader: {
      machine: planned.headers.coffHeader.machine,
      numberOfSections: planned.headers.coffHeader.numberOfSections,
      timeDateStamp: planned.headers.coffHeader.timeDateStamp,
      sizeOfOptionalHeader: planned.headers.coffHeader.sizeOfOptionalHeader,
      pointerToSymbolTable: planned.headers.coffHeader.pointerToSymbolTable,
      numberOfSymbols: planned.headers.coffHeader.numberOfSymbols,
      characteristics: planned.headers.coffHeader.characteristics,
    },
    optionalHeader: {
      magic: planned.headers.optionalHeader.magic,
      majorLinkerVersion: planned.headers.optionalHeader.majorLinkerVersion,
      minorLinkerVersion: planned.headers.optionalHeader.minorLinkerVersion,
      sizeOfCodeBytes: planned.headers.optionalHeader.sizeOfCodeBytes,
      sizeOfInitializedDataBytes: planned.headers.optionalHeader.sizeOfInitializedDataBytes,
      sizeOfUninitializedDataBytes: planned.headers.optionalHeader.sizeOfUninitializedDataBytes,
      addressOfEntryPoint: planned.headers.optionalHeader.addressOfEntryPoint,
      baseOfCode: planned.headers.optionalHeader.baseOfCode,
      imageBase: planned.headers.optionalHeader.imageBase,
      sectionAlignmentBytes: planned.headers.optionalHeader.sectionAlignmentBytes,
      fileAlignmentBytes: planned.headers.optionalHeader.fileAlignmentBytes,
      majorOperatingSystemVersion: planned.headers.optionalHeader.majorOperatingSystemVersion,
      minorOperatingSystemVersion: planned.headers.optionalHeader.minorOperatingSystemVersion,
      majorImageVersion: planned.headers.optionalHeader.majorImageVersion,
      minorImageVersion: planned.headers.optionalHeader.minorImageVersion,
      majorSubsystemVersion: planned.headers.optionalHeader.majorSubsystemVersion,
      minorSubsystemVersion: planned.headers.optionalHeader.minorSubsystemVersion,
      win32VersionValue: planned.headers.optionalHeader.win32VersionValue,
      sizeOfImageBytes: planned.headers.optionalHeader.sizeOfImageBytes,
      sizeOfHeadersBytes: planned.headers.optionalHeader.sizeOfHeadersBytes,
      checksum: planned.headers.optionalHeader.checksum,
      subsystem: planned.headers.optionalHeader.subsystem,
      dllCharacteristics: planned.headers.optionalHeader.dllCharacteristics,
      sizeOfStackReserveBytes: planned.headers.optionalHeader.sizeOfStackReserveBytes,
      sizeOfStackCommitBytes: planned.headers.optionalHeader.sizeOfStackCommitBytes,
      sizeOfHeapReserveBytes: planned.headers.optionalHeader.sizeOfHeapReserveBytes,
      sizeOfHeapCommitBytes: planned.headers.optionalHeader.sizeOfHeapCommitBytes,
      loaderFlags: planned.headers.optionalHeader.loaderFlags,
      numberOfRvaAndSizes: planned.headers.optionalHeader.numberOfRvaAndSizes,
    },
    dataDirectories: planned.headers.optionalHeader.dataDirectories,
    sectionHeaders: planned.sections.map((section) => ({
      name: section.serializedName,
      virtualSizeBytes: section.virtualSizeBytes,
      rva: section.rva,
      rawDataSizeBytes: section.rawDataSizeBytes,
      rawDataPointerBytes: section.rawDataPointerBytes,
      pointerToRelocations: 0,
      pointerToLineNumbers: 0,
      numberOfRelocations: 0,
      numberOfLineNumbers: 0,
      characteristics: section.characteristics,
      bytes: section.bytes,
      rawBytes: Uint8Array.from([
        ...section.bytes,
        ...Array.from({ length: section.rawDataSizeBytes - section.bytes.length }, () => 0),
      ]),
    })),
    baseRelocationBlocks:
      relocSection === undefined
        ? []
        : plannedRelocationEntriesFromSection(relocSection.bytes).length === 0
          ? []
          : [
              {
                pageRva: relocSection.rva,
                blockSizeBytes: 12,
                entries: plannedRelocationEntriesFromSection(relocSection.bytes),
              },
            ],
  } satisfies ParsedPeCoffImage;
}

function plannedImageWithRelocationForVerifierTest(): PlannedPeCoffImage {
  const target = writerTargetForTest();
  const layout = linkedImageLayoutForPeCoffTest({
    baseRelocations: [dir64RelocationForTest({ rva: 0x4000 })],
  });
  const relocations = serializePeBaseRelocations({
    target,
    relocations: layout.baseRelocations,
  });
  if (relocations.kind !== "ok") throw new Error("expected relocation fixture");
  const plannedSections = planPeCoffSections({
    target,
    layout,
    baseRelocationTableBytes: relocations.value.bytes,
  });
  if (plannedSections.kind !== "ok") throw new Error("expected section fixture");
  const dataDirectories = planPeDataDirectories({
    target,
    layout,
    sections: plannedSections.value.sections,
    baseRelocationTableSizeBytes: relocations.value.bytes.length,
  });
  if (dataDirectories.kind !== "ok") throw new Error("expected data directory fixture");
  const headers = planPeHeaders({
    target,
    layout,
    sections: plannedSections.value.sections,
    dataDirectories: dataDirectories.value.directories,
  });
  if (headers.kind !== "ok") throw new Error("expected header fixture");
  return Object.freeze({
    headers: headers.value,
    sections: plannedSections.value.sections,
  });
}

function plannedRelocationEntriesFromSection(bytes: ArrayLike<number>) {
  if (bytes.length === 0) return [];
  const encodedEntry = bytes[8]! | (bytes[9]! << 8);
  const paddingEntry = bytes[10]! | (bytes[11]! << 8);
  return [
    {
      type: encodedEntry >>> 12,
      offset: encodedEntry & 0x0fff,
      rva: readU32Le(bytes, 0) + (encodedEntry & 0x0fff),
    },
    {
      type: paddingEntry >>> 12,
      offset: paddingEntry & 0x0fff,
      rva: readU32Le(bytes, 0) + (paddingEntry & 0x0fff),
    },
  ];
}

function readU32Le(bytes: ArrayLike<number>, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! * 2 ** 24)
  );
}

describe("PE/COFF parse-back verifier", () => {
  test("verifies parsed image against the planned writer model", () => {
    const planned = plannedImageForWriterTest();
    const parsed = parsedImageForVerifierTest(planned);

    const result = verifyParsedPeCoffImage({ planned, parsed });

    expect(result.kind).toBe("ok");
  });

  test("verifies serialized bytes parsed back through the PE parser", () => {
    const planned = plannedImageForWriterTest();
    const serialized = serializedPlannedImageForTest(planned);
    const parsed = parsePeCoffImage(serialized.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed image");

    const result = verifyParsedPeCoffImage({
      planned: { headers: serialized.headers, sections: planned.sections },
      parsed: parsed.value,
    });

    expect(result.kind).toBe("ok");
  });

  test("detects header mismatches", () => {
    const planned = plannedImageForWriterTest();
    const parsed = parsedImageForVerifierTest(planned);

    const result = verifyParsedPeCoffImage({
      planned,
      parsed: {
        ...parsed,
        coffHeader: { ...parsed.coffHeader, machine: 0x8664 },
        optionalHeader: {
          ...parsed.optionalHeader,
          magic: 0x10b,
          subsystem: 2,
          addressOfEntryPoint: 0x2000,
          imageBase: 0x200000n,
          sectionAlignmentBytes: 0x2000,
          fileAlignmentBytes: 0x1000,
          sizeOfImageBytes: 0x9000,
          sizeOfHeadersBytes: parsed.optionalHeader.sizeOfHeadersBytes + 0x200,
          numberOfRvaAndSizes: 15,
        },
        dataDirectories: parsed.dataDirectories.slice(0, -1),
      },
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toEqual([
      "coff-header:machine",
      "data-directories:count",
      "data-directory:15",
      "optional-header:entry-rva",
      "optional-header:file-alignment",
      "optional-header:image-base",
      "optional-header:magic",
      "optional-header:number-of-rva-and-sizes",
      "optional-header:section-alignment",
      "optional-header:size-of-headers",
      "optional-header:size-of-image",
      "optional-header:subsystem",
    ]);
  });

  test("detects section mismatches and non-zero relocation or line-number fields", () => {
    const planned = plannedImageForWriterTest();
    const parsed = parsedImageForVerifierTest(planned);

    const result = verifyParsedPeCoffImage({
      planned,
      parsed: {
        ...parsed,
        sectionHeaders: [
          {
            ...parsed.sectionHeaders[0]!,
            name: ".wrong",
            virtualSizeBytes: 1,
            rva: 0x9000,
            rawDataSizeBytes: 1,
            rawDataPointerBytes: 0x900,
            pointerToRelocations: 1,
            pointerToLineNumbers: 2,
            numberOfRelocations: 3,
            numberOfLineNumbers: 4,
            characteristics: 0,
            bytes: Uint8Array.of(0xff),
            rawBytes: Uint8Array.of(0xff),
          },
          ...parsed.sectionHeaders.slice(1),
        ],
      },
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("section:.text:name");
    expect(stableDetails(result)).toContain("section:.text:rva");
    expect(stableDetails(result)).toContain("section:.text:virtual-size");
    expect(stableDetails(result)).toContain("section:.text:raw-pointer");
    expect(stableDetails(result)).toContain("section:.text:raw-size");
    expect(stableDetails(result)).toContain("section:.text:characteristics");
    expect(stableDetails(result)).toContain("section:.text:bytes");
    expect(stableDetails(result)).toContain("section:.text:pointer-to-relocations");
    expect(stableDetails(result)).toContain("section:.text:pointer-to-line-numbers");
    expect(stableDetails(result)).toContain("section:.text:number-of-relocations");
    expect(stableDetails(result)).toContain("section:.text:number-of-line-numbers");
  });

  test("detects exception and base relocation directory mismatches", () => {
    const planned = plannedImageForWriterTest();
    const parsed = parsedImageForVerifierTest(planned);

    const result = verifyParsedPeCoffImage({
      planned,
      parsed: {
        ...parsed,
        dataDirectories: parsed.dataDirectories.map((directory, index) =>
          index === 3 || index === 5
            ? { rva: directory.rva + 0x1000, sizeBytes: directory.sizeBytes + 4 }
            : directory,
        ),
      },
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("data-directory:exception");
    expect(stableDetails(result)).toContain("data-directory:base-relocation");
  });

  test("detects unexpected unsupported data directories", () => {
    const planned = plannedImageForWriterTest();
    const parsed = parsedImageForVerifierTest(planned);

    const result = verifyParsedPeCoffImage({
      planned,
      parsed: {
        ...parsed,
        dataDirectories: parsed.dataDirectories.map((directory, index) =>
          index === 4 ? { rva: 0x80, sizeBytes: 32 } : directory,
        ),
      },
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("data-directory:4");
  });

  test("ignores ABSOLUTE relocation padding and compares relocation RVAs and types", () => {
    const planned = plannedImageWithRelocationForVerifierTest();
    const parsed = parsedImageForVerifierTest(planned);

    const matching = verifyParsedPeCoffImage({ planned, parsed });
    expect(matching.kind).toBe("ok");

    const result = verifyParsedPeCoffImage({
      planned,
      parsed: {
        ...parsed,
        baseRelocationBlocks: [
          {
            ...parsed.baseRelocationBlocks[0]!,
            entries: [
              {
                ...parsed.baseRelocationBlocks[0]!.entries[0]!,
                rva: parsed.baseRelocationBlocks[0]!.entries[0]!.rva + 8,
              },
              parsed.baseRelocationBlocks[0]!.entries[1]!,
            ],
          },
        ],
      },
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("base-relocations:entries");
  });
});

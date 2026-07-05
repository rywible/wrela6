import { describe, expect, test } from "bun:test";

import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DATA_DIRECTORY_COUNT,
  PE_HEADER_OFFSET_BYTES,
  PE_SECTION_HEADER_SIZE_BYTES,
  PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
  PE_RELOC_SECTION_CHARACTERISTICS,
} from "../../../src/pe-coff/headers";
import {
  alignPe,
  planPeCoffSections,
  planPeDataDirectories,
  planPeHeaders,
  type PlannedPeCoffDataDirectory,
  type PlannedPeCoffSection,
} from "../../../src/pe-coff/pe-file-layout";
import {
  dir64RelocationForTest,
  linkedImageLayoutForPeCoffTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

const PE_SIGNATURE_SIZE_BYTES = 4;

describe("PE/COFF file layout planning", () => {
  test("plans linked sections, generated reloc section, header size, and raw offsets", () => {
    const layout = linkedImageLayoutForPeCoffTest({
      sections: [
        linkedSection(".text", 0x1000, 0x20, 0x60000020, [1, 2, 3, 4]),
        linkedSection(".debug$wrela", 0x2000, 0x03, 0x42000040, [5, 6, 7]),
      ],
      baseRelocations: [dir64RelocationForTest({ rva: 0x1008, sectionKey: ".text" })],
      dataDirectorySources: [],
      includeDataSection: false,
    });
    const baseRelocationTableBytes = Uint8Array.of(
      0x00,
      0x10,
      0x00,
      0x00,
      0x0c,
      0x00,
      0x00,
      0x00,
      0x08,
      0xa0,
      0x00,
      0x00,
    );

    const result = planPeCoffSections({
      target: writerTargetForTest(),
      layout,
      baseRelocationTableBytes,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected planned sections");

    const expectedSizeOfHeaders = 512;
    expect(result.value.sizeOfHeadersBytes).toBe(expectedSizeOfHeaders);
    expect(result.value.sections).toHaveLength(3);
    expect(result.value.sections[0]).toEqual({
      sectionKey: ".text",
      serializedName: ".text",
      rva: 0x1000,
      virtualSizeBytes: 0x20,
      rawDataPointerBytes: expectedSizeOfHeaders,
      rawDataSizeBytes: 512,
      characteristics: 0x60000020,
      bytes: Uint8Array.of(1, 2, 3, 4),
      generated: false,
    });
    expect(result.value.sections[1]).toEqual({
      sectionKey: ".debug$wrela",
      serializedName: ".debug",
      rva: 0x2000,
      virtualSizeBytes: 0x03,
      rawDataPointerBytes: expectedSizeOfHeaders + 512,
      rawDataSizeBytes: 512,
      characteristics: 0x42000040,
      bytes: Uint8Array.of(5, 6, 7),
      generated: false,
    });
    expect(result.value.sections[2]).toEqual({
      sectionKey: ".reloc",
      serializedName: ".reloc",
      rva: 0x3000,
      virtualSizeBytes: 12,
      rawDataPointerBytes: expectedSizeOfHeaders + 1024,
      rawDataSizeBytes: 512,
      characteristics: PE_RELOC_SECTION_CHARACTERISTICS,
      bytes: baseRelocationTableBytes,
      generated: true,
    });
    expect(result.value.sizeOfImageBytes).toBe(0x4000);
  });

  test("omits reloc section when relocation bytes are empty", () => {
    const result = planPeCoffSections({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({ baseRelocations: [] }),
      baseRelocationTableBytes: new Uint8Array(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected planned sections");
    expect(result.value.sections.map((section) => section.sectionKey)).not.toContain(".reloc");
  });

  test("rejects planned image size above target cap", () => {
    const result = planPeCoffSections({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        sections: [linkedSection(".text", 0x1000, 0x8000000, 0x60000020, [1])],
        dataDirectorySources: [],
        includeDataSection: false,
      }),
      baseRelocationTableBytes: new Uint8Array(),
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("sections:image-size:134221824:max:134217728");
  });

  test("rejects section tables that would overlap the reserved header page", () => {
    const result = planPeCoffSections({
      target: {
        ...writerTargetForTest(),
        firstSectionRva: 128,
      },
      layout: linkedImageLayoutForPeCoffTest(),
      baseRelocationTableBytes: [],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("sections:headers-overlap:1024:first-section:128");
  });

  test("emits exception and base relocation directories while zeroing unsupported entries", () => {
    const sections = plannedSectionsForTest([
      plannedSection({ sectionKey: ".text", rva: 0x1000, characteristics: 0x60000020 }),
      plannedSection({ sectionKey: ".pdata", rva: 0x2000, virtualSizeBytes: 8 }),
      plannedSection({
        sectionKey: ".reloc",
        rva: 0x3000,
        virtualSizeBytes: 12,
        characteristics: PE_RELOC_SECTION_CHARACTERISTICS,
        generated: true,
      }),
    ]);

    const result = planPeDataDirectories({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
      sections,
      baseRelocationTableSizeBytes: 12,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected directories");
    expect(result.value.directories).toHaveLength(PE_DATA_DIRECTORY_COUNT);
    expect(result.value.directories[3]).toEqual({ rva: 0x2000, sizeBytes: 0x0c });
    expect(result.value.directories[5]).toEqual({ rva: 0x3000, sizeBytes: 12 });
    expect(result.value.directories[0]).toEqual({ rva: 0, sizeBytes: 0 });
    expect(result.value.directories[4]).toEqual({ rva: 0, sizeBytes: 0 });
    expect(result.value.directories[15]).toEqual({ rva: 0, sizeBytes: 0 });
  });

  test("rejects debug data directory sources in v1", () => {
    const result = planPeDataDirectories({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        dataDirectorySources: [
          {
            stableKey: "data-directory:debug:.debug",
            directoryKind: "debug",
            sectionKey: ".debug$wrela",
            rva: 0x2000,
            sizeBytes: 16,
          },
        ],
      }),
      sections: plannedSectionsForTest([
        plannedSection({ sectionKey: ".debug$wrela", rva: 0x2000 }),
      ]),
      baseRelocationTableSizeBytes: 0,
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain(
      "data-directory:unsupported-kind:data-directory:debug:.debug:debug",
    );
  });

  test("plans COFF and PE32+ optional headers from planned sections and directories", () => {
    const target = writerTargetForTest();
    const sections = plannedSectionsForTest([
      plannedSection({
        sectionKey: ".text",
        rva: 0x1000,
        rawDataSizeBytes: 512,
        characteristics: 0x60000020,
      }),
      plannedSection({
        sectionKey: ".pdata",
        rva: 0x2000,
        rawDataSizeBytes: 512,
        characteristics: 0x40000040,
      }),
      plannedSection({
        sectionKey: ".data",
        rva: 0x3000,
        rawDataSizeBytes: 1024,
        characteristics: 0xc0000040,
      }),
      plannedSection({
        sectionKey: ".reloc",
        rva: 0x4000,
        virtualSizeBytes: 12,
        rawDataSizeBytes: 512,
        characteristics: PE_RELOC_SECTION_CHARACTERISTICS,
        generated: true,
      }),
    ]);
    const dataDirectories = zeroDirectoriesForTest();

    const result = planPeHeaders({
      target,
      layout: linkedImageLayoutForPeCoffTest(),
      sections,
      dataDirectories,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected PE headers");
    expect(result.value.dosHeader).toEqual({
      sizeBytes: 64,
      peHeaderOffsetBytes: PE_HEADER_OFFSET_BYTES,
    });
    expect(result.value.coffHeader).toEqual({
      machine: 0xaa64,
      numberOfSections: 4,
      timeDateStamp: 0,
      pointerToSymbolTable: 0,
      numberOfSymbols: 0,
      sizeOfOptionalHeader: 0xf0,
      characteristics: 0x0022,
    });
    expect(result.value.optionalHeader).toEqual(
      expect.objectContaining({
        magic: 0x20b,
        addressOfEntryPoint: 0x1000,
        imageBase: 0n,
        sectionAlignmentBytes: 4096,
        fileAlignmentBytes: 512,
        subsystem: 10,
        baseOfCode: 0x1000,
        sizeOfCodeBytes: 512,
        sizeOfInitializedDataBytes: 2048,
        sizeOfImageBytes: 0x5000,
        sizeOfHeadersBytes: expectedHeaderSizeForSectionCount(4),
        checksum: 0,
        sizeOfStackReserveBytes: 0n,
        sizeOfStackCommitBytes: 0n,
        sizeOfHeapReserveBytes: 0n,
        sizeOfHeapCommitBytes: 0n,
        loaderFlags: 0,
        numberOfRvaAndSizes: 16,
      }),
    );
    expect(result.value.optionalHeader.dataDirectories).toBe(dataDirectories);
    expect(result.value.sizeOfHeadersBytes).toBe(expectedHeaderSizeForSectionCount(4));
    expect(result.value.sizeOfImageBytes).toBe(0x5000);
  });

  test("rejects missing executable section instead of using BaseOfCode zero", () => {
    const result = planPeHeaders({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({ entryRva: 0x2000 }),
      sections: plannedSectionsForTest([
        plannedSection({ sectionKey: ".pdata", rva: 0x2000, characteristics: 0x40000040 }),
      ]),
      dataDirectories: zeroDirectoriesForTest(),
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain("optional-header:missing-executable-section");
  });

  test("rejects field-width overflow during header planning", () => {
    const result = planPeHeaders({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({ entryRva: 0x1_0000_0000 }),
      sections: plannedSectionsForTest([
        plannedSection({
          sectionKey: ".text",
          rva: 0x1000,
          rawDataSizeBytes: 0x1_0000_0000,
          characteristics: 0x60000020,
        }),
      ]),
      dataDirectories: zeroDirectoriesForTest(),
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain(
      "optional-header:address-of-entry-point:u32:4294967296",
    );
    expect(stableDetails(result)).toContain("optional-header:size-of-code:u32:4294967296");
  });

  test("rejects data directory count drift during header planning", () => {
    const result = planPeHeaders({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
      sections: plannedSectionsForTest([
        plannedSection({ sectionKey: ".text", rva: 0x1000, characteristics: 0x60000020 }),
      ]),
      dataDirectories: [],
    });

    expect(result.kind).toBe("error");
    expect(stableDetails(result)).toContain(
      "optional-header:number-of-rva-and-sizes:0:expected:16",
    );
  });
});

function linkedSection(
  stableKey: string,
  rva: number,
  virtualSizeBytes: number,
  flags: number,
  bytes: Uint8Array | readonly number[],
) {
  return {
    stableKey,
    classKey: stableKey,
    flags,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes,
    bytes: Uint8Array.from(bytes),
    contributions: [],
  };
}

function plannedSection(input: Partial<PlannedPeCoffSection>): PlannedPeCoffSection {
  return {
    sectionKey: ".pdata",
    serializedName: input.sectionKey ?? ".pdata",
    rva: 0x2000,
    virtualSizeBytes: 0x0c,
    rawDataPointerBytes: 512,
    rawDataSizeBytes: 512,
    characteristics: 0x40000040,
    bytes: Uint8Array.of(0),
    generated: false,
    ...input,
  };
}

function plannedSectionsForTest(
  sections: readonly PlannedPeCoffSection[],
): readonly PlannedPeCoffSection[] {
  return Object.freeze(sections.map((section) => Object.freeze({ ...section })));
}

function zeroDirectoriesForTest(): readonly PlannedPeCoffDataDirectory[] {
  return Object.freeze(
    Array.from({ length: PE_DATA_DIRECTORY_COUNT }, () => Object.freeze({ rva: 0, sizeBytes: 0 })),
  );
}

function expectedHeaderSizeForSectionCount(sectionCount: number): number {
  return alignPe(
    PE_HEADER_OFFSET_BYTES +
      PE_SIGNATURE_SIZE_BYTES +
      PE_COFF_FILE_HEADER_SIZE_BYTES +
      PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES +
      PE_SECTION_HEADER_SIZE_BYTES * sectionCount,
    512,
  );
}

function stableDetails(result: {
  readonly diagnostics: readonly { readonly stableDetail: string }[];
}) {
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

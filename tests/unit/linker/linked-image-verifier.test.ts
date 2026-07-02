import { describe, expect, test } from "bun:test";

import { verifyLinkedImageLayout } from "../../../src/linker/verifier";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type AppliedRelocation,
  type LinkedFactSpendingRecord,
  type LinkedByteProvenance,
  type LinkedImageSection,
  type ResolvedImageSymbol,
} from "../../../src/linker/linked-image-layout";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";
import {
  expectSlowLinkedImageValidation,
  validateLinkedImageLayoutSlowly,
} from "../../support/linker/slow-linked-image-validator";

describe("verifyLinkedImageLayout", () => {
  test("accepts a complete linked image layout and the slow validator agrees", () => {
    const layout = completeLayoutForTest();

    const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });

    expect(result.kind).toBe("ok");
    expectSlowLinkedImageValidation(layout);
  });

  test("catches symbol rva corruption with deterministic diagnostics", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      symbols: (symbols) =>
        symbols.map((symbol) =>
          symbol.symbolKey === "module:test:boot:symbol:main"
            ? { ...symbol, rva: symbol.rva + 4 }
            : symbol,
        ),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:symbol-rva-mismatch:module:test:boot:symbol:main:4100:4096",
    );
  });

  test("catches contribution ranges outside the linked section", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".text"
            ? {
                ...section,
                contributions: section.contributions.map((contribution) => ({
                  ...contribution,
                  offsetBytes: 20,
                })),
              }
            : section,
        ),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:contribution-range-out-of-section:module:test:boot:section:.text:.text:20:16:16",
    );
  });

  test("catches overlapping output sections", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".data" ? { ...section, rva: 0x1008 } : section,
        ),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:section-rva-overlap:.text:.data:4096:4112:4104:4112",
    );
  });

  test("catches first section RVAs below the target header reservation", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".text" ? { ...section, rva: 0 } : section,
        ),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:first-section-rva-below-policy:.text:0:4096",
    );
  });

  test("catches invalid base relocation targets", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      baseRelocations: (baseRelocations) =>
        baseRelocations.map((relocation) => ({ ...relocation, rva: relocation.rva + 4 })),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:base-relocation-target-mismatch:base-reloc:dir64:.data:8192:8196:8192",
    );
  });

  test("catches invalid base relocation kind and width for addr64 sources", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      baseRelocations: (baseRelocations) =>
        baseRelocations.map((relocation) => ({
          ...relocation,
          kind: "highlow",
          widthBytes: 4,
        })),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:base-relocation-kind-mismatch:base-reloc:dir64:.data:8192:addr64:highlow:4:expected:dir64:8",
    );
  });

  test("catches missing expected base relocation records for addr64 sources", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      appliedRelocations: (relocations) =>
        relocations.map((relocation) => ({
          relocationKey: relocation.relocationKey,
          sourceModuleKey: relocation.sourceModuleKey,
          family: relocation.family,
          patchSectionKey: relocation.patchSectionKey,
          patchRva: relocation.patchRva,
          targetSymbolKey: relocation.targetSymbolKey,
          targetRva: relocation.targetRva,
          addend: relocation.addend,
          expectedEncodedValue: relocation.expectedEncodedValue,
          patchedBytes: relocation.patchedBytes,
        })),
      baseRelocations: () => [],
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:base-relocation-key-mismatch:module:test:boot:reloc:data-pointer:<missing>:base-reloc:dir64:.data:8192",
    );
    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:base-relocation-missing:module:test:boot:reloc:data-pointer:base-reloc:dir64:.data:8192",
    );
  });

  test("catches entry rva mismatches", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      entry: (entry) => ({ ...entry, loaderEntryRva: entry.loaderEntryRva + 4 }),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:entry-rva-mismatch:__wrela_uefi_entry:4100:4096",
    );
  });

  test("catches missing boot entry symbols", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      symbols: (symbols) => symbols.filter((symbol) => symbol.linkageName !== "Boot.main"),
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:boot-symbol-resolution-invalid:Boot.main:0",
    );
  });

  test("catches provenance gaps and overlaps", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      provenance: (provenance) =>
        provenance.map((record) =>
          record.stableKey === "provenance:.text:boot"
            ? { ...record, byteLength: record.byteLength - 1 }
            : record,
        ),
    });

    expect(expectStableDetails(corrupted)).toContain("image-layout:provenance-gap:.text:15");
  });

  test("catches invalid provenance source partitions", () => {
    const missingIdentity = mutateLayout(completeLayoutForTest(), {
      provenance: (provenance) =>
        provenance.map((record) =>
          record.stableKey === "provenance:.text:boot"
            ? {
                stableKey: record.stableKey,
                sectionKey: record.sectionKey,
                rva: record.rva,
                byteLength: record.byteLength,
                factFamilies: ["fixture-bytes"],
              }
            : record,
        ),
    });
    const mixedIdentity = mutateLayout(completeLayoutForTest(), {
      provenance: (provenance) =>
        provenance.map((record) =>
          record.stableKey === "provenance:.text:boot"
            ? {
                ...record,
                sourceRelocationKey: "module:test:boot:reloc:data-pointer",
              }
            : record,
        ),
    });

    expect(expectStableDetails(missingIdentity)).toContain(
      "image-layout:provenance-partition-invalid:provenance:.text:boot:padding-has-facts",
    );
    expect(expectStableDetails(mixedIdentity)).toContain(
      "image-layout:provenance-partition-invalid:provenance:.text:boot:mixed-relocation-source",
    );
  });

  test("catches metadata fingerprint corruption", () => {
    const layout = completeLayoutForTest();
    const corrupted: AArch64LinkedImageLayout = {
      ...layout,
      deterministicMetadata: {
        ...layout.deterministicMetadata,
        layoutFingerprint: "corrupted",
      },
    };

    expect(expectStableDetails(corrupted)).toContain(
      `image-layout:metadata-fingerprint-mismatch:layoutFingerprint:corrupted:${layout.deterministicMetadata.layoutFingerprint}`,
    );
  });

  test("catches relocation bytes that encode a different value than metadata", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".data"
            ? {
                ...section,
                bytes: [0, 0, 0, 0, 0, 0, 0, 0],
              }
            : section,
        ),
      appliedRelocations: (relocations) =>
        relocations.map((relocation) => ({
          ...relocation,
          patchedBytes: [0, 0, 0, 0, 0, 0, 0, 0],
        })),
    });

    const stableDetails = expectStableDetails(corrupted);

    expect(stableDetails).toContain(
      "image-layout:relocation-actual-encoded-value-mismatch:module:test:boot:reloc:data-pointer:0:4096",
    );
  });

  test("returns duplicate record diagnostics instead of throwing during metadata recompute", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      inputModules: (modules) => [...modules, modules[0]!],
    });

    const stableDetails = expectStableDetails(corrupted);

    expect(stableDetails).toContain("image-layout:duplicate-input-module:module:test:boot");
    expect(stableDetails).toContain(
      "image-layout:metadata-recompute-invalid:Conflicting input module stable key: module:test:boot.",
    );
  });

  test("catches split fact-spending aggregates", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      factSpending: () => [
        {
          stableKey: "fact-spent:test:boot",
          authority: "test",
          payload: "boot",
          sourceModuleKeys: ["module:test:boot"],
        },
        {
          stableKey: "fact-spent:test:boot-copy",
          authority: "test",
          payload: "boot",
          sourceModuleKeys: ["module:test:boot"],
        },
      ],
    });

    expect(expectStableDetails(corrupted)).toContain(
      "image-layout:fact-spending-aggregate-split:fact-spent:test:boot:fact-spent:test:boot-copy",
    );
  });

  test("slow validator rejects relocation value corruption independently", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      appliedRelocations: (relocations) =>
        relocations.map((relocation) => ({
          ...relocation,
          expectedEncodedValue: relocation.expectedEncodedValue + 1n,
        })),
    });

    const result = validateLinkedImageLayoutSlowly(corrupted);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:relocation-value-mismatch:module:test:boot:reloc:data-pointer:4097:4096",
    );
  });

  test("slow validator rejects relocation bytes that encode a different value", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".data"
            ? {
                ...section,
                bytes: [0, 0, 0, 0, 0, 0, 0, 0],
              }
            : section,
        ),
      appliedRelocations: (relocations) =>
        relocations.map((relocation) => ({
          ...relocation,
          patchedBytes: [0, 0, 0, 0, 0, 0, 0, 0],
        })),
    });

    const result = validateLinkedImageLayoutSlowly(corrupted);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:relocation-bytes-mismatch:module:test:boot:reloc:data-pointer:0:4096",
    );
  });

  test("slow validator recomputes contribution placement independently", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      sections: (sections) =>
        sections.map((section) =>
          section.stableKey === ".text"
            ? {
                ...section,
                contributions: section.contributions.map((contribution) => ({
                  ...contribution,
                  offsetBytes: 4,
                })),
              }
            : section,
        ),
    });

    const result = validateLinkedImageLayoutSlowly(corrupted);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:contribution-offset-mismatch:module:test:boot:section:.text:4:0",
    );
  });

  test("slow validator recomputes missing base relocation records independently", () => {
    const corrupted = mutateLayout(completeLayoutForTest(), {
      baseRelocations: () => [],
    });

    const result = validateLinkedImageLayoutSlowly(corrupted);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:base-relocation-missing:module:test:boot:reloc:data-pointer:base-reloc:dir64:.data:8192",
    );
  });

  test("slow validator accepts scaled pageoffset-12l encoded values", () => {
    const layout = layoutWithMainAtOffset(8, "pageoffset-12l", 1n, [0, 4, 0, 0], 8);

    const result = validateLinkedImageLayoutSlowly(layout);

    expect(result.kind).toBe("ok");
  });

  test("production verifier accepts scaled pageoffset-12l encoded values", () => {
    const layout = layoutWithMainAtOffset(8, "pageoffset-12l", 1n, [0, 4, 0, 0], 8);

    const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });

    expect(result.kind).toBe("ok");
  });

  test("production verifier rejects v1 addr32 absolute relocations", () => {
    const layout = layoutWithMainAtOffset(0, "addr32", 0x1000n, [0, 0x10, 0, 0]);

    expect(expectStableDetails(layout)).toContain(
      "image-layout:relocation-encoding-invalid:module:test:boot:reloc:data-pointer:relocation:addr32-absolute-rejected:module:test:boot:reloc:data-pointer",
    );
  });

  test("slow validator rejects v1 addr32 absolute relocations", () => {
    const layout = layoutWithMainAtOffset(0, "addr32", 0x1000n, [0, 0x10, 0, 0]);

    const result = validateLinkedImageLayoutSlowly(layout);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:relocation-value-invalid:module:test:boot:reloc:data-pointer:addr32-absolute-rejected",
    );
  });

  test("slow validator rejects unaligned branch distances", () => {
    const layout = layoutWithMainAtOffset(2, "branch26", 0n, [0, 0, 0, 0]);

    const result = validateLinkedImageLayoutSlowly(layout);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected slow validator error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "slow-image-layout:relocation-value-invalid:module:test:boot:reloc:data-pointer:unaligned-branch:-4094",
    );
  });

  test("slow validator recomputes section-relative values from the target section", () => {
    const layout = layoutWithMainAtOffset(8, "section-relative", 8n, [8, 0, 0, 0]);

    const result = validateLinkedImageLayoutSlowly(layout);

    expect(result.kind).toBe("ok");
  });
});

type LayoutMutators = {
  readonly inputModules?: (
    inputModules: AArch64LinkedImageLayout["inputModules"],
  ) => AArch64LinkedImageLayout["inputModules"];
  readonly sections?: (sections: readonly LinkedImageSection[]) => readonly LinkedImageSection[];
  readonly symbols?: (symbols: readonly ResolvedImageSymbol[]) => readonly ResolvedImageSymbol[];
  readonly appliedRelocations?: (
    relocations: readonly AppliedRelocation[],
  ) => readonly AppliedRelocation[];
  readonly baseRelocations?: (
    relocations: AArch64LinkedImageLayout["baseRelocations"],
  ) => AArch64LinkedImageLayout["baseRelocations"];
  readonly entry?: (entry: AArch64LinkedImageLayout["entry"]) => AArch64LinkedImageLayout["entry"];
  readonly provenance?: (
    provenance: readonly LinkedByteProvenance[],
  ) => readonly LinkedByteProvenance[];
  readonly factSpending?: (
    factSpending: readonly LinkedFactSpendingRecord[],
  ) => readonly LinkedFactSpendingRecord[];
  readonly unwindRecords?: (
    unwindRecords: AArch64LinkedImageLayout["unwindRecords"],
  ) => AArch64LinkedImageLayout["unwindRecords"];
};

function mutateLayout(
  layout: AArch64LinkedImageLayout,
  mutators: LayoutMutators,
): AArch64LinkedImageLayout {
  return {
    ...layout,
    inputModules: mutators.inputModules?.(layout.inputModules) ?? layout.inputModules,
    sections: mutators.sections?.(layout.sections) ?? layout.sections,
    symbols: mutators.symbols?.(layout.symbols) ?? layout.symbols,
    appliedRelocations:
      mutators.appliedRelocations?.(layout.appliedRelocations) ?? layout.appliedRelocations,
    baseRelocations: mutators.baseRelocations?.(layout.baseRelocations) ?? layout.baseRelocations,
    entry: mutators.entry?.(layout.entry) ?? layout.entry,
    provenance: mutators.provenance?.(layout.provenance) ?? layout.provenance,
    factSpending: mutators.factSpending?.(layout.factSpending) ?? layout.factSpending,
    unwindRecords: mutators.unwindRecords?.(layout.unwindRecords) ?? layout.unwindRecords,
  };
}

function expectStableDetails(layout: AArch64LinkedImageLayout): string[] {
  const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected verifier error");
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}

function layoutWithMainAtOffset(
  objectOffsetBytes: number,
  family: AppliedRelocation["family"],
  expectedEncodedValue: bigint,
  patchedBytes: readonly number[],
  accessScaleBytes?: number,
): AArch64LinkedImageLayout {
  const rva = 0x1000 + objectOffsetBytes;
  const mutated = mutateLayout(completeLayoutForTest(), {
    sections: (sections) =>
      sections.map((section) =>
        section.stableKey === ".data"
          ? {
              ...section,
              bytes: [...patchedBytes, ...section.bytes.slice(patchedBytes.length)],
            }
          : section,
      ),
    symbols: (symbols) =>
      symbols.map((symbol) =>
        symbol.symbolKey === "module:test:boot:symbol:main"
          ? { ...symbol, rva, objectOffsetBytes }
          : symbol,
      ),
    appliedRelocations: (relocations) =>
      relocations.map((relocation) => ({
        relocationKey: relocation.relocationKey,
        sourceModuleKey: relocation.sourceModuleKey,
        family,
        patchSectionKey: relocation.patchSectionKey,
        patchRva: relocation.patchRva,
        targetSymbolKey: relocation.targetSymbolKey,
        targetRva: rva,
        addend: 0n,
        ...(accessScaleBytes === undefined ? {} : { accessScaleBytes }),
        expectedEncodedValue,
        patchedBytes,
      })),
    baseRelocations: () => [],
    entry: (entry) => ({ ...entry, wrelaBootRva: rva }),
    unwindRecords: (records) =>
      records.map((record) =>
        record.functionSymbolKey === "module:test:boot:symbol:main"
          ? {
              ...record,
              functionStartRva: rva,
              functionEndRva: Math.max(record.functionEndRva, rva + 4),
            }
          : record,
      ),
  });
  return rebuildLayoutForTest(mutated);
}

function rebuildLayoutForTest(layout: AArch64LinkedImageLayout): AArch64LinkedImageLayout {
  return createAArch64LinkedImageLayout({
    targetKey: layout.targetKey,
    targetFingerprint: layout.targetFingerprint,
    targetPolicyFingerprint: layout.targetPolicyFingerprint,
    inputModules: layout.inputModules,
    sections: layout.sections,
    symbols: layout.symbols,
    appliedRelocations: layout.appliedRelocations,
    baseRelocations: layout.baseRelocations,
    entry: layout.entry,
    unwindRecords: layout.unwindRecords,
    dataDirectorySources: layout.dataDirectorySources,
    provenance: layout.provenance,
    factSpending: layout.factSpending,
    verification: layout.verification,
  });
}

function completeLayoutForTest(): AArch64LinkedImageLayout {
  const target = targetSurfaceForTest();
  return createAArch64LinkedImageLayout({
    targetKey: target.targetKey,
    targetFingerprint: target.backendSurfaceFingerprint,
    targetPolicyFingerprint: target.targetPolicyFingerprint,
    inputModules: [
      {
        moduleKey: "module:test:boot",
        moduleFingerprint: "fingerprint:module:test:boot",
      },
    ],
    sections: [
      section(
        ".text",
        "executable-text",
        0x60000020,
        0x1000,
        [
          0xc0, 0x03, 0x5f, 0xd6, 0x1f, 0x20, 0x03, 0xd5, 0x1f, 0x20, 0x03, 0xd5, 0xc0, 0x03, 0x5f,
          0xd6,
        ],
      ),
      section(
        ".data",
        "writable-data",
        0xc0000040,
        0x2000,
        [0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      ),
      section(".pdata", "unwind-pdata", 0x40000040, 0x3000, [0x00, 0x10, 0x00, 0x00]),
      section(".xdata", "unwind-xdata", 0x40000040, 0x4000, [0x01, 0x00, 0x00, 0x00]),
    ],
    symbols: [
      {
        symbolKey: "module:test:boot:symbol:main",
        linkageName: "Boot.main",
        binding: "global",
        sourceModuleKey: "module:test:boot",
        sectionKey: ".text",
        contributionKey: "module:test:boot:section:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "module:test:boot:symbol:entry",
        linkageName: "__wrela_uefi_entry",
        binding: "global",
        sourceModuleKey: "module:test:boot",
        sectionKey: ".text",
        contributionKey: "module:test:boot:section:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "module:test:boot:symbol:data",
        binding: "local",
        sourceModuleKey: "module:test:boot",
        sectionKey: ".data",
        contributionKey: "module:test:boot:section:.data",
        rva: 0x2000,
        objectOffsetBytes: 0,
      },
    ],
    appliedRelocations: [
      {
        relocationKey: "module:test:boot:reloc:data-pointer",
        sourceModuleKey: "module:test:boot",
        family: "addr64",
        patchSectionKey: ".data",
        patchRva: 0x2000,
        targetSymbolKey: "module:test:boot:symbol:main",
        targetRva: 0x1000,
        addend: 0n,
        expectedEncodedValue: 0x1000n,
        patchedBytes: [0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        baseRelocationKey: "base-reloc:dir64:.data:8192",
      },
    ],
    baseRelocations: [
      {
        stableKey: "base-reloc:dir64:.data:8192",
        kind: "dir64",
        sectionKey: ".data",
        rva: 0x2000,
        widthBytes: 8,
        sourceRelocationKey: "module:test:boot:reloc:data-pointer",
      },
    ],
    entry: {
      loaderEntryLinkageName: "__wrela_uefi_entry",
      loaderEntryRva: 0x1000,
      wrelaBootLinkageName: "Boot.main",
      wrelaBootRva: 0x1000,
    },
    unwindRecords: [
      {
        stableKey: "unwind:module:test:boot:symbol:main",
        functionSymbolKey: "module:test:boot:symbol:main",
        functionStartRva: 0x1000,
        functionEndRva: 0x1010,
        unwindInfoSectionKey: ".xdata",
        unwindInfoRva: 0x4000,
      },
    ],
    dataDirectorySources: [
      {
        stableKey: "directory:exception",
        directoryKind: "exception",
        sectionKey: ".pdata",
        rva: 0x3000,
        sizeBytes: 4,
      },
    ],
    provenance: [
      provenance("provenance:.text:boot", ".text", 0x1000, 16),
      provenance("provenance:.data:boot", ".data", 0x2000, 8),
      provenance("provenance:.pdata:boot", ".pdata", 0x3000, 4),
      provenance("provenance:.xdata:boot", ".xdata", 0x4000, 4),
    ],
    factSpending: [
      {
        stableKey: "fact-spent:test:boot",
        authority: "test",
        payload: "boot",
        sourceModuleKeys: ["module:test:boot"],
      },
    ],
    verification: {
      runs: [
        {
          verifierKey: "linker-fixture",
          runKey: "complete-layout",
          status: "passed",
        },
      ],
    },
  });
}

function section(
  stableKey: string,
  classKey: string,
  flags: number,
  rva: number,
  bytes: readonly number[],
): LinkedImageSection {
  return {
    stableKey,
    classKey,
    flags,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes: bytes.length,
    bytes,
    contributions: [
      {
        stableKey: `module:test:boot:section:${stableKey}`,
        sourceModuleKey: "module:test:boot",
        sourceObjectSectionKey: stableKey,
        sourceObjectSectionClass: classKey,
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: bytes.length,
        alignmentBytes: stableKey === ".text" ? 4 : 8,
      },
    ],
  };
}

function provenance(
  stableKey: string,
  sectionKey: string,
  rva: number,
  byteLength: number,
): LinkedByteProvenance {
  return {
    stableKey,
    sectionKey,
    rva,
    byteLength,
    sourceModuleKey: "module:test:boot",
    sourceObjectSectionKey: sectionKey,
    sourceObjectProvenanceKey: stableKey,
    factFamilies: ["fixture-bytes"],
  };
}

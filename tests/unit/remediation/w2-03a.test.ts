import { describe, expect, test } from "bun:test";

import { verifyLinkedImageLayout } from "../../../src/linker/verifier";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type LinkedImageSection,
} from "../../../src/linker/linked-image-layout";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";

describe("W2-03a linker writer-parity section verification", () => {
  test("rejects a first section RVA that does not exactly match target policy", () => {
    const layout = layoutWithSections([
      section(".text", 0x2000, [0xc0, 0x03, 0x5f, 0xd6]),
      section(".data", 0x3000, [0x00, 0x00, 0x00, 0x00]),
    ]);

    const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LINKER_LAYOUT_FIRST_SECTION_RVA_MISMATCH",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "image-layout:first-section-rva-mismatch:.text:8192:4096",
    );
  });

  test("rejects virtual-order gaps before PE writer handoff", () => {
    const layout = layoutWithSections([
      section(".text", 0x1000, [0xc0, 0x03, 0x5f, 0xd6]),
      section(".data", 0x3000, [0x00, 0x00, 0x00, 0x00]),
    ]);

    const result = verifyLinkedImageLayout({ layout, target: targetSurfaceForTest() });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "image-layout:section-rva-contiguity-mismatch:.text:.data:12288:8192",
    );
  });
});

function layoutWithSections(sections: readonly LinkedImageSection[]): AArch64LinkedImageLayout {
  return createAArch64LinkedImageLayout({
    targetKey: "target:test",
    targetFingerprint: "target:fingerprint:test",
    targetPolicyFingerprint: "target-policy:fingerprint:test",
    inputModules: [
      {
        moduleKey: "module:test:boot",
        moduleFingerprint: "fingerprint:module:test:boot",
      },
    ],
    sections,
    symbols: [
      {
        symbolKey: "module:test:boot:symbol:main",
        linkageName: "Boot.main",
        binding: "global",
        sourceModuleKey: "module:test:boot",
        sectionKey: ".text",
        contributionKey: "module:test:boot:section:.text",
        rva: sections[0]?.rva ?? 0,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "module:test:boot:symbol:entry",
        linkageName: "__wrela_uefi_entry",
        binding: "global",
        sourceModuleKey: "module:test:boot",
        sectionKey: ".text",
        contributionKey: "module:test:boot:section:.text",
        rva: sections[0]?.rva ?? 0,
        objectOffsetBytes: 0,
      },
    ],
    appliedRelocations: [],
    baseRelocations: [],
    entry: {
      loaderEntryLinkageName: "__wrela_uefi_entry",
      loaderEntryRva: sections[0]?.rva ?? 0,
      wrelaBootLinkageName: "Boot.main",
      wrelaBootRva: sections[0]?.rva ?? 0,
    },
    unwindRecords: [],
    dataDirectorySources: [],
    provenance: sections.map((item) => ({
      stableKey: `provenance:${item.stableKey}`,
      sectionKey: item.stableKey,
      rva: item.rva,
      byteLength: item.bytes.length,
      sourceModuleKey: "module:test:boot",
      sourceObjectSectionKey: item.stableKey,
      sourceObjectProvenanceKey: `provenance:${item.stableKey}`,
      factFamilies: ["fixture-bytes"],
    })),
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
          runKey: "w2-03a",
          status: "passed",
        },
      ],
    },
  });
}

function section(
  stableKey: string,
  rva: number,
  bytes: Uint8Array | readonly number[],
): LinkedImageSection {
  return {
    stableKey,
    classKey: stableKey === ".text" ? "executable-text" : "writable-data",
    flags: stableKey === ".text" ? 0x60000020 : 0xc0000040,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes: bytes.length,
    bytes: Uint8Array.from(bytes),
    contributions: [
      {
        stableKey: `module:test:boot:section:${stableKey}`,
        sourceModuleKey: "module:test:boot",
        sourceObjectSectionKey: stableKey,
        sourceObjectSectionClass: stableKey === ".text" ? "executable-text" : "writable-data",
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: bytes.length,
        alignmentBytes: 4,
      },
    ],
  };
}

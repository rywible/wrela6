import { describe, expect, test } from "bun:test";

import {
  type AArch64LinkedImageLayout,
  type LinkedImageSection,
  createAArch64LinkedImageLayout,
} from "../../../src/linker/linked-image-layout";

function linkedImageLayoutForModelTest(
  overrides: Partial<Parameters<typeof createAArch64LinkedImageLayout>[0]> = {},
): AArch64LinkedImageLayout {
  return createAArch64LinkedImageLayout({
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    targetFingerprint: "target:fingerprint",
    targetPolicyFingerprint: "target:policy:fingerprint",
    inputModules: [
      {
        moduleKey: "module:source:z",
        moduleFingerprint: "module:fingerprint:z",
      },
      {
        moduleKey: "module:source:a",
        moduleFingerprint: "module:fingerprint:a",
        syntheticProviderKey: "synthetic:provider",
      },
    ],
    sections: [
      linkedImageSection("section:.text:z", [0xcc]),
      linkedImageSection("section:.text:a", [0xaa, 0xbb]),
    ],
    symbols: [
      {
        symbolKey: "module:source:z:symbol:late",
        binding: "global",
        sourceModuleKey: "module:source:z",
        sectionKey: "section:.text:z",
        contributionKey: "module:source:z:section:.text",
        rva: 8192,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "module:source:a:symbol:early",
        linkageName: "EfiMain",
        binding: "local",
        sourceModuleKey: "module:source:a",
        sectionKey: "section:.text:a",
        contributionKey: "module:source:a:section:.text",
        rva: 4096,
        objectOffsetBytes: 4,
      },
    ],
    appliedRelocations: [
      {
        relocationKey: "module:source:z:reloc:call",
        sourceModuleKey: "module:source:z",
        family: "branch26",
        patchSectionKey: "section:.text:z",
        patchRva: 8192,
        targetSymbolKey: "module:source:a:symbol:early",
        targetRva: 4096,
        addend: 0n,
        expectedEncodedValue: -1024n,
        patchedBytes: [0, 0, 0, 20],
      },
    ],
    baseRelocations: [
      {
        stableKey: "base-reloc:dir64:section:.data:12288",
        kind: "dir64",
        sectionKey: "section:.data",
        rva: 12288,
        widthBytes: 8,
        sourceRelocationKey: "module:source:z:reloc:addr",
      },
    ],
    entry: {
      loaderEntryLinkageName: "EfiMain",
      loaderEntryRva: 4096,
      wrelaBootLinkageName: "wrela_boot",
      wrelaBootRva: 4112,
    },
    unwindRecords: [
      {
        stableKey: "unwind:z",
        functionSymbolKey: "module:source:z:symbol:late",
        functionStartRva: 8192,
        functionEndRva: 8208,
        unwindInfoSectionKey: "section:.xdata",
        unwindInfoRva: 16384,
      },
    ],
    dataDirectorySources: [
      {
        stableKey: "directory:exception",
        directoryKind: "exception",
        sectionKey: "section:.pdata",
        rva: 20480,
        sizeBytes: 12,
      },
    ],
    provenance: [
      {
        stableKey: "provenance:z",
        sectionKey: "section:.text:z",
        rva: 8192,
        byteLength: 4,
        sourceModuleKey: "module:source:z",
        factFamilies: ["ownership", "layout"],
      },
    ],
    factSpending: [
      {
        stableKey: "fact-spent:authority:z",
        authority: "authority",
        payload: "payload",
        sourceModuleKeys: ["module:source:z", "module:source:a"],
      },
    ],
    verification: {
      runs: [
        {
          verifierKey: "linked-image-layout",
          runKey: "model",
          status: "passed",
        },
      ],
    },
    ...overrides,
  });
}

function linkedImageSection(
  stableKey: string,
  bytes: Uint8Array | readonly number[],
): LinkedImageSection {
  return {
    stableKey,
    classKey: ".text",
    flags: 0x60000020,
    alignmentBytes: 4096,
    rva: stableKey.endsWith(":a") ? 4096 : 8192,
    virtualSizeBytes: bytes.length,
    bytes: Uint8Array.from(bytes),
    contributions: [
      {
        stableKey: stableKey.endsWith(":a")
          ? "module:source:a:section:.text"
          : "module:source:z:section:.text",
        sourceModuleKey: stableKey.endsWith(":a") ? "module:source:a" : "module:source:z",
        sourceObjectSectionKey: ".text",
        sourceObjectSectionClass: ".text",
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: bytes.length,
        alignmentBytes: 4096,
      },
    ],
  };
}

describe("createAArch64LinkedImageLayout", () => {
  test("layout metadata exposes every required fingerprint", () => {
    const layout = linkedImageLayoutForModelTest();

    expect(Object.keys(layout.deterministicMetadata)).toEqual([
      "schema",
      "schemaVersion",
      "inputFingerprint",
      "sectionFingerprint",
      "symbolFingerprint",
      "relocationFingerprint",
      "baseRelocationFingerprint",
      "entryFingerprint",
      "provenanceFingerprint",
      "layoutFingerprint",
    ]);
  });

  test("sorts unordered records by stable keys while preserving section order", () => {
    const layout = linkedImageLayoutForModelTest();

    expect(layout.inputModules.map((inputModule) => inputModule.moduleKey)).toEqual([
      "module:source:a",
      "module:source:z",
    ]);
    expect(layout.sections.map((section) => section.stableKey)).toEqual([
      "section:.text:z",
      "section:.text:a",
    ]);
    expect(layout.symbols.map((symbol) => symbol.symbolKey)).toEqual([
      "module:source:a:symbol:early",
      "module:source:z:symbol:late",
    ]);
    expect(layout.provenance[0]?.factFamilies).toEqual(["layout", "ownership"]);
    expect(layout.factSpending[0]?.sourceModuleKeys).toEqual([
      "module:source:a",
      "module:source:z",
    ]);
  });

  test("sorts base relocations by numeric rva", () => {
    const layout = linkedImageLayoutForModelTest({
      baseRelocations: [
        {
          stableKey: "base-reloc:dir64:section:.data:10000",
          kind: "dir64",
          sectionKey: "section:.data",
          rva: 10000,
          widthBytes: 8,
          sourceRelocationKey: "module:source:z:reloc:addr-high",
        },
        {
          stableKey: "base-reloc:dir64:section:.data:8192",
          kind: "dir64",
          sectionKey: "section:.data",
          rva: 8192,
          widthBytes: 8,
          sourceRelocationKey: "module:source:z:reloc:addr-low",
        },
      ],
    });

    expect(layout.baseRelocations.map((relocation) => relocation.rva)).toEqual([8192, 10000]);
  });

  test("rejects duplicate top-level stable keys", () => {
    const duplicateSection = linkedImageSection("section:.text:a", [0xdd]);

    expect(() =>
      linkedImageLayoutForModelTest({
        sections: [linkedImageSection("section:.text:a", [0xaa]), duplicateSection],
      }),
    ).toThrow(new RangeError("Conflicting section stable key: section:.text:a."));
  });

  test("rejects duplicate section contribution stable keys", () => {
    const contribution = linkedImageSection("section:.text:a", [0xaa]).contributions[0]!;

    expect(() =>
      linkedImageLayoutForModelTest({
        sections: [
          {
            ...linkedImageSection("section:.text:a", [0xaa]),
            contributions: [
              contribution,
              {
                ...contribution,
                sourceModuleKey: "module:source:z",
              },
            ],
          },
        ],
      }),
    ).toThrow(
      new RangeError("Conflicting section contribution stable key: module:source:a:section:.text."),
    );
  });

  test("sorts verifier runs without collapsing missing and empty stable details", () => {
    const layout = linkedImageLayoutForModelTest({
      verification: {
        runs: [
          {
            verifierKey: "verifier",
            runKey: "run",
            status: "passed",
            stableDetail: "",
          },
          {
            verifierKey: "verifier",
            runKey: "run",
            status: "passed",
          },
        ],
      },
    });

    expect(layout.verification.runs).toEqual([
      {
        verifierKey: "verifier",
        runKey: "run",
        status: "passed",
      },
      {
        verifierKey: "verifier",
        runKey: "run",
        status: "passed",
        stableDetail: "",
      },
    ]);
  });

  test("deeply freezes layout arrays and records", () => {
    const layout = linkedImageLayoutForModelTest();

    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.sections)).toBe(true);
    expect(Object.isFrozen(layout.sections[0])).toBe(true);
    expect(layout.sections[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(Object.isFrozen(layout.sections[0]?.contributions)).toBe(true);
    expect(Object.isFrozen(layout.sections[0]?.contributions[0])).toBe(true);
    expect(Object.isFrozen(layout.verification.runs)).toBe(true);
  });

  test("changes layout fingerprint when canonical layout content changes", () => {
    const original = linkedImageLayoutForModelTest();
    const changed = linkedImageLayoutForModelTest({
      sections: [linkedImageSection("section:.text:a", [0xaa, 0xbc])],
    });

    expect(changed.deterministicMetadata.layoutFingerprint).not.toBe(
      original.deterministicMetadata.layoutFingerprint,
    );
  });
});

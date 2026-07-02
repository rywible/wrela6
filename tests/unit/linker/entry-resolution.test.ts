import { describe, expect, test } from "bun:test";
import {
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest as objectTextSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  resolveLinkedImageEntry,
  type ResolveLinkedImageEntryInput,
} from "../../../src/linker/entry-resolution";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";
import type {
  AppliedRelocation,
  LinkedImageSection,
  ResolvedImageSymbol,
} from "../../../src/linker/linked-image-layout";
import type { NormalizedLinkGraph } from "../../../src/linker/object-normalization";

describe("resolveLinkedImageEntry", () => {
  test("resolves loader and Wrela boot symbols into linked image entry metadata", () => {
    const result = resolveLinkedImageEntry(entryResolutionFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected entry resolution to succeed");
    expect(result.value.entry).toEqual({
      loaderEntryLinkageName: "__wrela_uefi_entry",
      loaderEntryRva: 0x1000,
      wrelaBootLinkageName: "Boot.main",
      wrelaBootRva: 0x1010,
    });
  });

  test("rejects a missing loader entry symbol", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        symbols: [bootSymbolForTest()],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:missing-loader-symbol:__wrela_uefi_entry",
    ]);
  });

  test("rejects duplicate loader entry definitions", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        symbols: [
          loaderSymbolForTest(),
          loaderSymbolForTest({
            symbolKey: "module:test:entry-copy:symbol:__wrela_uefi_entry",
            sourceModuleKey: "module:test:entry-copy",
          }),
          bootSymbolForTest(),
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:duplicate-loader-symbol:__wrela_uefi_entry:module:test:entry-copy:symbol:__wrela_uefi_entry:module:test:entry:symbol:__wrela_uefi_entry",
    ]);
  });

  test("rejects a missing Wrela boot handoff symbol", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        symbols: [loaderSymbolForTest()],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:missing-boot-symbol:Boot.main",
    ]);
  });

  test("does not require a boot symbol when entry policy disables boot handoff", () => {
    const target = {
      ...targetSurfaceForTest(),
      entryPolicy: {
        loaderEntryLinkageName: "__wrela_uefi_entry",
        requiresBootHandoff: false,
        requiredEntrySectionClass: "executable" as const,
      },
    };

    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        target,
        symbols: [loaderSymbolForTest()],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected entry resolution");
    expect(result.value.entry.wrelaBootRva).toBe(0);
  });

  test("rejects a loader entry in a non-executable output section", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        sections: [dataSectionForTest()],
        symbols: [
          loaderSymbolForTest({
            sectionKey: ".data",
            contributionKey: "module:test:entry:section:.data",
          }),
          bootSymbolForTest(),
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:non-executable-section:__wrela_uefi_entry:.data",
    ]);
  });

  test("rejects a loader entry in a section whose class does not satisfy policy", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        sections: [
          {
            ...dataSectionForTest(),
            flags: 0x60000020,
          },
        ],
        symbols: [
          loaderSymbolForTest({
            sectionKey: ".data",
            contributionKey: "module:test:entry:section:.data",
          }),
          bootSymbolForTest(),
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:non-executable-section:__wrela_uefi_entry:.data",
    ]);
  });

  test("rejects a loader entry RVA outside PE32+ AddressOfEntryPoint range", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        symbols: [loaderSymbolForTest({ rva: 0x1_0000_0000 }), bootSymbolForTest()],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:rva-out-of-range:__wrela_uefi_entry:4294967296",
    ]);
  });

  test("rejects unresolved relocations in the loader entry contribution", () => {
    const result = resolveLinkedImageEntry(
      entryResolutionFixture({
        graph: graphWithLoaderRelocationForTest("entry:branch-to-boot"),
        appliedRelocations: [],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry:unresolved-relocation:module:test:entry:reloc:entry:branch-to-boot",
    ]);
  });
});

interface EntryResolutionFixtureInput {
  readonly target?: ResolveLinkedImageEntryInput["target"];
  readonly sections?: readonly LinkedImageSection[];
  readonly symbols?: readonly ResolvedImageSymbol[];
  readonly appliedRelocations?: readonly AppliedRelocation[];
  readonly graph?: NormalizedLinkGraph;
}

function entryResolutionFixture(
  input: EntryResolutionFixtureInput = {},
): ResolveLinkedImageEntryInput {
  return {
    target: input.target ?? targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    sections: input.sections ?? [textSectionForTest()],
    symbols: input.symbols ?? [loaderSymbolForTest(), bootSymbolForTest()],
    appliedRelocations: input.appliedRelocations ?? [],
    graph: input.graph,
  };
}

function textSectionForTest(): LinkedImageSection {
  return {
    stableKey: ".text",
    classKey: "executable-text",
    flags: 0x60000020,
    alignmentBytes: 4096,
    rva: 0x1000,
    virtualSizeBytes: 0x20,
    bytes: [0x00, 0x00, 0x00, 0x94, 0xc0, 0x03, 0x5f, 0xd6],
    contributions: [
      {
        stableKey: "module:test:entry:section:.text",
        sourceModuleKey: "module:test:entry",
        sourceObjectSectionKey: ".text.entry",
        sourceObjectSectionClass: "executable-text",
        outputSectionKey: ".text",
        offsetBytes: 0,
        sizeBytes: 4,
        alignmentBytes: 4,
      },
      {
        stableKey: "module:test:boot:section:.text",
        sourceModuleKey: "module:test:boot",
        sourceObjectSectionKey: ".text.boot",
        sourceObjectSectionClass: "executable-text",
        outputSectionKey: ".text",
        offsetBytes: 0x10,
        sizeBytes: 4,
        alignmentBytes: 4,
      },
    ],
  };
}

function dataSectionForTest(): LinkedImageSection {
  return {
    stableKey: ".data",
    classKey: "writable-data",
    flags: 0xc0000040,
    alignmentBytes: 4096,
    rva: 0x2000,
    virtualSizeBytes: 4,
    bytes: [0, 0, 0, 0],
    contributions: [
      {
        stableKey: "module:test:entry:section:.data",
        sourceModuleKey: "module:test:entry",
        sourceObjectSectionKey: ".data",
        sourceObjectSectionClass: "writable-data",
        outputSectionKey: ".data",
        offsetBytes: 0,
        sizeBytes: 4,
        alignmentBytes: 4,
      },
    ],
  };
}

function loaderSymbolForTest(input: Partial<ResolvedImageSymbol> = {}): ResolvedImageSymbol {
  return {
    symbolKey: input.symbolKey ?? "module:test:entry:symbol:__wrela_uefi_entry",
    linkageName: input.linkageName ?? "__wrela_uefi_entry",
    binding: input.binding ?? "global",
    sourceModuleKey: input.sourceModuleKey ?? "module:test:entry",
    sectionKey: input.sectionKey ?? ".text",
    contributionKey: input.contributionKey ?? "module:test:entry:section:.text",
    rva: input.rva ?? 0x1000,
    objectOffsetBytes: input.objectOffsetBytes ?? 0,
  };
}

function bootSymbolForTest(input: Partial<ResolvedImageSymbol> = {}): ResolvedImageSymbol {
  return {
    symbolKey: input.symbolKey ?? "module:test:boot:symbol:main",
    linkageName: input.linkageName ?? "Boot.main",
    binding: input.binding ?? "global",
    sourceModuleKey: input.sourceModuleKey ?? "module:test:boot",
    sectionKey: input.sectionKey ?? ".text",
    contributionKey: input.contributionKey ?? "module:test:boot:section:.text",
    rva: input.rva ?? 0x1010,
    objectOffsetBytes: input.objectOffsetBytes ?? 0,
  };
}

function graphWithLoaderRelocationForTest(relocationKey: string): NormalizedLinkGraph {
  const module = objectModuleForLinkTest({
    moduleKey: "module:test:entry",
    sections: [objectTextSectionForLinkTest({ stableKey: ".text.entry" })],
    symbols: [],
    relocations: [
      relocationForLinkTest({
        stableKey: relocationKey,
        sectionKey: ".text.entry",
        target: { kind: "linkage-name", linkageName: "Boot.main" },
      }),
    ],
  });

  return {
    modules: [
      {
        moduleKey: "module:test:entry",
        moduleFingerprint: "fingerprint:module:test:entry",
        objectModule: module.objectModule,
      },
    ],
    factSpending: [],
  };
}

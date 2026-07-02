import { describe, expect, test } from "bun:test";

import { linkAArch64Image, type AArch64LinkInputModule } from "../../../src/linker";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../../support/linker/linker-fixtures";

describe("AArch64 linked image layout integration", () => {
  test("links Boot.main with entry shim, unwind metadata, and deterministic layout", () => {
    const first = linkBootImage([bootModuleForIntegrationTest()]);
    const second = linkBootImage([bootModuleForIntegrationTest()]);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected linked images");

    const text = first.layout.sections.find((section) => section.stableKey === ".text");
    expect(text).toBeDefined();
    expect(text?.bytes.length).toBeGreaterThan(0);
    expect(first.layout.entry).toEqual({
      loaderEntryLinkageName: "__wrela_uefi_entry",
      loaderEntryRva: first.layout.entry.loaderEntryRva,
      wrelaBootLinkageName: "Boot.main",
      wrelaBootRva: first.layout.entry.wrelaBootRva,
    });
    expect(first.layout.entry.loaderEntryRva).toBeLessThan(first.layout.entry.wrelaBootRva);

    expect(first.layout.appliedRelocations).toContainEqual(
      expect.objectContaining({
        relocationKey: "module:synthetic:uefi-entry:entry:reloc:reloc:entry:branch-to-boot",
        family: "branch26",
        patchSectionKey: ".text",
        patchRva: first.layout.entry.loaderEntryRva,
        targetRva: first.layout.entry.wrelaBootRva,
      }),
    );
    expect(first.layout.unwindRecords).toEqual([
      expect.objectContaining({
        functionStartRva: first.layout.entry.wrelaBootRva,
        unwindInfoSectionKey: ".xdata",
      }),
    ]);
    expect(first.layout.dataDirectorySources).toContainEqual(
      expect.objectContaining({
        directoryKind: "exception",
        sectionKey: ".pdata",
      }),
    );
    expect(first.layout.deterministicMetadata.layoutFingerprint).toBe(
      second.layout.deterministicMetadata.layoutFingerprint,
    );
    expect(first.layout.deterministicMetadata.layoutFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  test("links caller relocation to another module global definition", () => {
    const result = linkBootImage([
      bootModuleForIntegrationTest(),
      callerModuleForIntegrationTest(),
      calleeModuleForIntegrationTest(),
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked image");
    expect(result.layout.appliedRelocations).toContainEqual(
      expect.objectContaining({
        relocationKey: "module:test:caller:reloc:call-callee",
        sourceModuleKey: "module:test:caller",
        targetSymbolKey: "module:test:callee:symbol:callee",
        family: "branch26",
      }),
    );
  });

  test("links addr64 data reference and emits dir64 base relocation", () => {
    const result = linkBootImage([bootModuleForIntegrationTest(), dataReferenceModuleForTest()]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked image");
    expect(result.layout.appliedRelocations).toContainEqual(
      expect.objectContaining({
        relocationKey: "module:test:data-ref:reloc:absolute-target",
        family: "addr64",
        patchSectionKey: ".data",
        baseRelocationKey: "base-reloc:dir64:.data:4096",
      }),
    );
    expect(result.layout.baseRelocations).toEqual([
      {
        stableKey: "base-reloc:dir64:.data:4096",
        kind: "dir64",
        sectionKey: ".data",
        rva: 0x1000,
        widthBytes: 8,
        sourceRelocationKey: "module:test:data-ref:reloc:absolute-target",
      },
    ]);
  });
});

function linkBootImage(objectModules: readonly AArch64LinkInputModule[]) {
  return linkAArch64Image({
    objectModules,
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });
}

function bootModuleForIntegrationTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:boot",
    sections: [textSectionForLinkTest({ stableKey: ".text.boot" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot",
      }),
    ],
  });
}

function callerModuleForIntegrationTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:caller",
    sections: [textSectionForLinkTest({ stableKey: ".text.caller", bytes: [0, 0, 0, 0x94] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "caller",
        linkageName: "Caller.main",
        sectionKey: ".text.caller",
      }),
      externalSymbolForLinkTest({
        stableKey: "extern:Callee.main",
        linkageName: "Callee.main",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "call-callee",
        sectionKey: ".text.caller",
        target: { kind: "linkage-name", linkageName: "Callee.main" },
        encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
      }),
    ],
  });
}

function calleeModuleForIntegrationTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:callee",
    sections: [textSectionForLinkTest({ stableKey: ".text.callee" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "callee",
        linkageName: "Callee.main",
        sectionKey: ".text.callee",
      }),
    ],
  });
}

function dataReferenceModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:data-ref",
    sections: [
      dataSectionForLinkTest({
        stableKey: ".data.pointer",
        bytes: [0xc0, 0x03, 0x5f, 0xd6, 0xc0, 0x03, 0x5f, 0xd6],
      }),
      textSectionForLinkTest({ stableKey: ".text.target" }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "pointer",
        linkageName: "Data.pointer",
        sectionKey: ".data.pointer",
      }),
      globalSymbolForLinkTest({
        stableKey: "target",
        linkageName: "Data.target",
        sectionKey: ".text.target",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "absolute-target",
        sectionKey: ".data.pointer",
        family: "addr64",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Data.target" },
      }),
    ],
  });
}

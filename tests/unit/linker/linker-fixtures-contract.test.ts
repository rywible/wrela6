import { describe, expect, test } from "bun:test";

import {
  bootModuleForTest,
  completeLinkedImageLayoutForVerifierTest,
  entryShimProviderForTest,
  linkedImageLayoutForTest,
  replaceResolvedSymbolForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
  veneerProviderForTest,
} from "../../support/linker/linker-fixtures";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  localSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";

describe("primitive linker fixture helpers", () => {
  test("object module helpers build frozen linker input with complete byte provenance", () => {
    const text = textSectionForLinkTest({ stableKey: ".text", bytes: [0, 0, 0, 0] });
    const data = dataSectionForLinkTest({ stableKey: ".data", bytes: [1, 2, 3, 4] });
    const local = localSymbolForLinkTest({ stableKey: "local", sectionKey: ".text" });
    const global = globalSymbolForLinkTest({
      stableKey: "main",
      linkageName: "Boot.main",
      sectionKey: ".text",
    });
    const external = externalSymbolForLinkTest({
      stableKey: "extern:Other.main",
      linkageName: "Other.main",
    });
    const relocation = relocationForLinkTest({
      stableKey: "reloc:call",
      sectionKey: ".text",
      target: { kind: "linkage-name", linkageName: "Other.main" },
    });

    const module = objectModuleForLinkTest({
      moduleKey: "module:test:contract",
      sections: [data, text],
      symbols: [local, global, external],
      relocations: [relocation],
    });

    expect(Object.isFrozen(module)).toBe(true);
    expect(module.moduleKey).toBe("module:test:contract");
    expect(module.objectModule.sections.map((section) => String(section.stableKey))).toEqual([
      ".data",
      ".text",
    ]);
    expect(
      module.objectModule.symbols.map((symbol) => [String(symbol.stableKey), symbol.kind]),
    ).toEqual([
      ["extern:Other.main", "external-declaration"],
      ["local", "local-definition"],
      ["main", "global-definition"],
    ]);
    expect(module.objectModule.relocations[0]).toMatchObject({
      stableKey: "reloc:call",
      addend: 0n,
      instructionPatch: {
        bitRange: [0, 25],
      },
    });
    expect(
      module.objectModule.byteProvenance.map((record) => ({
        sectionKey: String(record.sectionKey),
        startOffsetBytes: record.startOffsetBytes,
        byteLength: record.byteLength,
      })),
    ).toEqual([
      { sectionKey: ".data", startOffsetBytes: 0, byteLength: 4 },
      { sectionKey: ".text", startOffsetBytes: 0, byteLength: 4 },
    ]);
  });

  test("target, boot module, providers, and layout helpers expose frozen contract shapes", () => {
    const target = targetSurfaceForTest();
    const bootModule = bootModuleForTest("module:test:boot");
    const entryProvider = entryShimProviderForTest();
    const unwindProvider = unwindProviderForTest();
    const veneerProvider = veneerProviderForTest();
    const layout = linkedImageLayoutForTest({
      inputModules: [{ moduleKey: bootModule.moduleKey, moduleFingerprint: "fingerprint:boot" }],
    });
    const completeLayout = completeLinkedImageLayoutForVerifierTest();
    const verifierLayout = replaceResolvedSymbolForTest(
      completeLayout,
      "module:test:boot:symbol:main",
      { rva: 0x2220 },
    );

    expect(Object.isFrozen(target)).toBe(true);
    expect(target.targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
    expect(bootModule.moduleKey).toBe("module:test:boot");
    expect(entryProvider.providerKey).toBe("uefi-entry");
    expect(unwindProvider.providerKey).toBe("aarch64-unwind");
    expect(veneerProvider.providerKey).toBe("aarch64-veneer");
    expect(Object.isFrozen(layout)).toBe(true);
    expect(layout.inputModules[0]?.moduleKey).toBe("module:test:boot");
    expect(
      verifierLayout.symbols.find((symbol) => symbol.symbolKey === "module:test:boot:symbol:main")
        ?.rva,
    ).toBe(0x2220);
  });
});

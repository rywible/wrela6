import { describe, expect, test } from "bun:test";

import {
  createAArch64UefiEntrySyntheticObjectProvider,
  createAArch64UnwindSyntheticObjectProvider,
  type AArch64SyntheticObjectFactory,
} from "../../../src/linker/aarch64/aarch64-entry-objects";
import type {
  AArch64SyntheticObjectProviderInput,
  AArch64LinkInputModule,
} from "../../../src/linker";
import { authenticateAArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
  aarch64ObjectModule,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  aarch64ObjectUnwindRecord,
  type AArch64ObjectModule,
} from "../../../src/target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import { RPI5_BACKEND_CATALOGS } from "../../../src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data";
import type {
  AArch64InternalRelocationFamily,
  AArch64RelocationCatalog,
} from "../../../src/target/aarch64/backend/api/backend-catalog-interfaces";

const branchToLinkageNameBytes = Uint8Array.of(0x00, 0x00, 0x00, 0x94);
const retBytes = Uint8Array.of(0xc0, 0x03, 0x5f, 0xd6);

describe("AArch64 synthetic object providers", () => {
  test("entry provider is keyed by uefi-entry and emits a verified loader entry object", () => {
    const provider = createAArch64UefiEntrySyntheticObjectProvider({
      factory: entryObjectFactoryForTest(),
    });

    const result = provider.provideObjects(syntheticProviderInputForTest("Boot.main"));

    expect(provider.providerKey).toBe("uefi-entry");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected synthetic object");
    expect(result.modules.map((module) => module.objectKey)).toEqual(["entry"]);
    expect(result.modules.map((module) => module.moduleKey)).toEqual([
      "module:synthetic:uefi-entry:entry",
    ]);
    const objectModule = result.modules[0]!.objectModule;
    expect(objectModule.symbols).toContainEqual(
      expect.objectContaining({
        kind: "global-definition",
        stableKey: "symbol:__wrela_uefi_entry",
        linkageName: "__wrela_uefi_entry",
      }),
    );
    expect(objectModule.symbols).toContainEqual(
      expect.objectContaining({
        kind: "external-declaration",
        stableKey: "extern:Boot.main",
        linkageName: "Boot.main",
      }),
    );
    expect(objectModule.relocations).toContainEqual(
      expect.objectContaining({
        stableKey: "reloc:entry:branch-to-boot",
        target: { kind: "linkage-name", linkageName: "Boot.main" },
      }),
    );
    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("entry provider receives synthetic code bytes from the injected factory", () => {
    const codeBytes = Uint8Array.of(0x00, 0x00, 0x00, 0x14);
    const provider = createAArch64UefiEntrySyntheticObjectProvider({
      factory: entryObjectFactoryForTest({ entryCodeBytes: codeBytes }),
    });

    const result = provider.provideObjects(syntheticProviderInputForTest("Boot.main"));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected synthetic object");
    expect(result.modules[0]!.objectModule.sections[0]!.bytes).toEqual(codeBytes);
    expect(verifyAArch64ObjectModule({ objectModule: result.modules[0]!.objectModule }).kind).toBe(
      "ok",
    );
  });

  test("entry provider verifies output with injected verifier catalogs", () => {
    const provider = createAArch64UefiEntrySyntheticObjectProvider({
      factory: entryObjectFactoryForTest(),
      relocationCatalog: relocationCatalogWithoutBranch26ForTest(),
    });

    const result = provider.provideObjects(syntheticProviderInputForTest("Boot.main"));

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected synthetic verification error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "synthetic-object:verification-failed:module:synthetic:uefi-entry:entry:object-verifier:relocation-family-unmapped:reloc:entry:branch-to-boot:branch26",
    ]);
  });

  test("unwind provider emits verified relocation-bearing pdata and xdata objects", () => {
    const provider = createAArch64UnwindSyntheticObjectProvider({
      factory: entryObjectFactoryForTest(),
    });

    const result = provider.provideObjects(
      syntheticProviderInputForTest("Boot.main", {
        objectModules: [moduleWithUnwindRecordForTest()],
      }),
    );

    expect(provider.providerKey).toBe("aarch64-unwind");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected unwind synthetic object");
    expect(result.modules.map((module) => module.moduleKey)).toEqual([
      "module:synthetic:aarch64-unwind:unwind",
    ]);
    const objectModule = result.modules[0]!.objectModule;
    expect(objectModule.sections.map((section) => section.classKey)).toEqual([
      AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
      AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
    ]);
    expect(objectModule.relocations.map((relocation) => String(relocation.sectionKey))).toEqual([
      ".pdata",
      ".xdata",
    ]);
    expect(objectModule.relocations.map((relocation) => relocation.target)).toEqual([
      { kind: "linkage-name", linkageName: "Func.main" },
      { kind: "linkage-name", linkageName: "Func.main" },
    ]);
    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });
});

function entryObjectFactoryForTest(
  input: { readonly entryCodeBytes?: Uint8Array | readonly number[] } = {},
): AArch64SyntheticObjectFactory {
  return {
    createEntryObject: () => ({
      kind: "ok",
      codeBytes: Uint8Array.from(input.entryCodeBytes ?? branchToLinkageNameBytes),
      relocations: [
        {
          stableKey: "reloc:entry:branch-to-boot",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          instructionPatch: {
            bitRange: [0, 25],
            encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
          },
        },
      ],
    }),
    createUnwindObjects: () => ({
      kind: "ok",
      objects: [
        {
          objectKey: "unwind",
          pdataBytes: branchToLinkageNameBytes,
          xdataBytes: branchToLinkageNameBytes,
          functionLinkageName: "Func.main",
          frameShape: "frameless-leaf",
          pdataRelocation: {
            stableKey: "reloc:pdata:function",
            offsetBytes: 0,
            widthBytes: 4,
            family: "branch26",
            instructionPatch: {
              bitRange: [0, 25],
              encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
            },
          },
          xdataRelocation: {
            stableKey: "reloc:xdata:function",
            offsetBytes: 0,
            widthBytes: 4,
            family: "branch26",
            instructionPatch: {
              bitRange: [0, 25],
              encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
            },
          },
        },
      ],
    }),
  };
}

function syntheticProviderInputForTest(
  wrelaBootLinkageName: string,
  input: { readonly objectModules?: readonly AArch64LinkInputModule[] } = {},
): AArch64SyntheticObjectProviderInput {
  const targetResult = authenticateAArch64LinkerTargetSurface();
  if (targetResult.kind !== "ok") throw new Error("expected authenticated target surface");
  return {
    target: targetResult.value,
    entry: { wrelaBootLinkageName },
    objectModules: input.objectModules ?? [emptyInputModuleForTest()],
  };
}

function emptyInputModuleForTest(): AArch64LinkInputModule {
  return {
    moduleKey: "module:test:empty",
    objectModule: emptyObjectModuleForTest("empty"),
  };
}

function moduleWithUnwindRecordForTest(): AArch64LinkInputModule {
  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: "backend-target-surface-fingerprint",
    closedImagePlanFingerprint: "closed-image-plan:unwind-source",
    sections: [
      aarch64ObjectSection({
        stableKey: ".text",
        classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
        bytes: retBytes,
        fragments: [{ stableKey: "fragment:text", startOffsetBytes: 0, sizeBytes: 4 }],
      }),
    ],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: "func",
        linkageName: "Func.main",
        sectionKey: ".text",
        offsetBytes: 0,
      }),
    ],
    unwindRecords: [
      aarch64ObjectUnwindRecord({
        stableKey: "unwind:func",
        sectionKey: ".text",
        frameShape: "frameless-leaf",
      }),
    ],
  });
  return { moduleKey: "module:test:with-unwind", objectModule };
}

function emptyObjectModuleForTest(closedImagePlanKey: string): AArch64ObjectModule {
  return aarch64ObjectModule({
    targetBackendSurfaceFingerprint: "backend-target-surface-fingerprint",
    closedImagePlanFingerprint: `closed-image-plan:${closedImagePlanKey}`,
  });
}

function relocationCatalogWithoutBranch26ForTest(): AArch64RelocationCatalog {
  const mappings = RPI5_BACKEND_CATALOGS.relocationCatalog.mappings.filter(
    (mapping) => mapping.internalFamily !== "branch26",
  );

  return Object.freeze({
    ...RPI5_BACKEND_CATALOGS.relocationCatalog,
    fingerprint: "backend-relocation-catalog:test-without-branch26",
    mappings: Object.freeze(mappings),
    mappingFor: (family: AArch64InternalRelocationFamily) =>
      mappings.find((mapping) => mapping.internalFamily === family),
  });
}

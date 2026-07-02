import { describe, expect, test } from "bun:test";

import { linkAArch64Image, type AArch64LinkInputModule } from "../../../src/linker";
import {
  aarch64ObjectModule,
  type AArch64ObjectModule,
} from "../../../src/target/aarch64/backend/object/object-module";
import {
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { compileTinyAArch64ObjectForLinkTest } from "../../support/linker/aarch64-normalized-link-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../../support/linker/linker-fixtures";

describe("AArch64 backend object to linker integration", () => {
  test("links backend fixture output with synthetic entry and unwind providers", () => {
    const backend = compileTinyAArch64ObjectForLinkTest();
    const backendModule = backendObjectForLinkTest(backend.objectModule);
    const result = linkAArch64Image({
      objectModules: [backendModule, bootAdapterObjectForBackendFixture()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked image");

    expect(result.layout.sections.map((section) => section.stableKey)).toContain(".text");
    expect(result.layout.symbols).toContainEqual(
      expect.objectContaining({
        linkageName: "Boot.main",
        sourceModuleKey: "module:test:backend-adapter",
      }),
    );
    expect(result.layout.inputModules).toContainEqual(
      expect.objectContaining({
        moduleKey: "module:user:backend",
        moduleFingerprint: backendModule.objectModule.deterministicMetadata.moduleFingerprint,
      }),
    );
    expect(result.layout.inputModules.map((module) => module.syntheticProviderKey)).toEqual(
      expect.arrayContaining(["uefi-entry", "aarch64-unwind"]),
    );
    expect(result.layout.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceModuleKey: "module:test:backend-adapter",
          sourceObjectSectionKey: ".text.boot-adapter",
        }),
        expect.objectContaining({
          sourceSyntheticObjectKey: "entry",
        }),
        expect.objectContaining({
          sourceSyntheticObjectKey: "unwind",
        }),
      ]),
    );
    expect(result.layout.appliedRelocations).toContainEqual(
      expect.objectContaining({
        relocationKey: "module:synthetic:uefi-entry:entry:reloc:reloc:entry:branch-to-boot",
        targetSymbolKey: "module:test:backend-adapter:symbol:main",
      }),
    );
  });
});

function backendObjectForLinkTest(objectModule: AArch64ObjectModule): AArch64LinkInputModule {
  return {
    moduleKey: "module:user:backend",
    objectModule: aarch64ObjectModule({
      ...objectModule,
      targetBackendSurfaceFingerprint: targetSurfaceForTest().backendSurfaceFingerprint,
    }),
  };
}

function bootAdapterObjectForBackendFixture(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:backend-adapter",
    sections: [textSectionForLinkTest({ stableKey: ".text.boot-adapter" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot-adapter",
      }),
    ],
  });
}

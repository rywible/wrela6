import {
  createAArch64UefiEntrySyntheticObjectProvider,
  createAArch64UnwindSyntheticObjectProvider,
  type AArch64SyntheticObjectFactory,
} from "../../../src/linker/aarch64/aarch64-entry-objects";
import type {
  AArch64LinkInputModule,
  AArch64LinkerVeneerProvider,
  AArch64SyntheticObjectProvider,
} from "../../../src/linker";
import {
  authenticateAArch64LinkerTargetSurface,
  type AArch64LinkerTargetSurface,
} from "../../../src/linker/image-layout-policy";
import {
  createAArch64LinkedImageLayout,
  type AArch64LinkedImageLayout,
  type LinkedImageInputModule,
  type ResolvedImageSymbol,
} from "../../../src/linker/linked-image-layout";
import { objectModuleForLinkTest, textSectionForLinkTest } from "./aarch64-object-link-fixtures";

export interface LinkedImageLayoutForTestInput {
  readonly inputModules?: readonly LinkedImageInputModule[];
  readonly symbols?: readonly ResolvedImageSymbol[];
}

const entryCodeBytes = Uint8Array.of(0x00, 0x00, 0x00, 0x94);
const targetSurface = targetSurfaceForTest();

export function targetSurfaceForTest(): AArch64LinkerTargetSurface {
  const result = authenticateAArch64LinkerTargetSurface();
  if (result.kind !== "ok") throw new Error("expected authenticated test target surface");
  return result.value;
}

export function bootModuleForTest(moduleKey = "module:test:boot"): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey,
    sections: [textSectionForLinkTest({ stableKey: ".text" })],
  });
}

export function entryShimProviderForTest(): AArch64SyntheticObjectProvider {
  return createAArch64UefiEntrySyntheticObjectProvider({
    factory: syntheticObjectFactoryForTest(),
  });
}

export function unwindProviderForTest(): AArch64SyntheticObjectProvider {
  return createAArch64UnwindSyntheticObjectProvider({ factory: syntheticObjectFactoryForTest() });
}

export function veneerProviderForTest(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: "aarch64-veneer",
    provideVeneer: () =>
      Object.freeze({
        kind: "ok" as const,
        modules: Object.freeze([
          Object.freeze({
            objectKey: "veneer",
            moduleKey: "module:synthetic:aarch64-veneer:veneer",
            objectModule: objectModuleForLinkTest({
              moduleKey: "module:synthetic:aarch64-veneer:veneer",
              sections: [textSectionForLinkTest({ stableKey: ".text.veneer" })],
            }).objectModule,
          }),
        ]),
      }),
  });
}

export function linkedImageLayoutForTest(
  input: LinkedImageLayoutForTestInput = {},
): AArch64LinkedImageLayout {
  return createAArch64LinkedImageLayout({
    targetKey: targetSurface.targetKey,
    targetFingerprint: targetSurface.backendSurfaceFingerprint,
    targetPolicyFingerprint: targetSurface.targetPolicyFingerprint,
    inputModules: input.inputModules ?? [
      {
        moduleKey: "module:test:boot",
        moduleFingerprint: "fingerprint:module:test:boot",
      },
    ],
    sections: [
      {
        stableKey: ".text",
        classKey: "executable-text",
        flags: targetSurface.constants.sectionFlags[".text"] ?? 0,
        alignmentBytes: 4096,
        rva: 0x1000,
        virtualSizeBytes: 4,
        bytes: [0xc0, 0x03, 0x5f, 0xd6],
        contributions: [
          {
            stableKey: "module:test:boot:section:.text",
            sourceModuleKey: "module:test:boot",
            sourceObjectSectionKey: ".text",
            sourceObjectSectionClass: "executable-text",
            outputSectionKey: ".text",
            offsetBytes: 0,
            sizeBytes: 4,
            alignmentBytes: 4,
          },
        ],
      },
    ],
    symbols: input.symbols ?? defaultResolvedSymbols(),
    appliedRelocations: [],
    baseRelocations: [],
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
        functionEndRva: 0x1004,
        unwindInfoSectionKey: ".xdata",
        unwindInfoRva: 0x3000,
      },
    ],
    dataDirectorySources: [
      {
        stableKey: "directory:exception",
        directoryKind: "exception",
        sectionKey: ".pdata",
        rva: 0x2000,
        sizeBytes: 8,
      },
    ],
    provenance: [
      {
        stableKey: "provenance:.text",
        sectionKey: ".text",
        rva: 0x1000,
        byteLength: 4,
        sourceModuleKey: "module:test:boot",
        sourceObjectSectionKey: ".text",
        sourceObjectProvenanceKey: "provenance:.text",
        factFamilies: ["fixture-bytes"],
      },
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
          runKey: "layout",
          status: "passed",
        },
      ],
    },
  });
}

export function completeLinkedImageLayoutForVerifierTest(): AArch64LinkedImageLayout {
  return linkedImageLayoutForTest();
}

export function replaceResolvedSymbolForTest(
  layout: AArch64LinkedImageLayout,
  symbolKey: string,
  replacement: Partial<ResolvedImageSymbol>,
): AArch64LinkedImageLayout {
  return linkedImageLayoutForTest({
    inputModules: layout.inputModules,
    symbols: layout.symbols.map((symbol) =>
      symbol.symbolKey === symbolKey ? { ...symbol, ...replacement } : symbol,
    ),
  });
}

function defaultResolvedSymbols(): readonly ResolvedImageSymbol[] {
  return [
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
  ];
}

function syntheticObjectFactoryForTest(): AArch64SyntheticObjectFactory {
  return Object.freeze({
    createEntryObject: () => ({
      kind: "ok" as const,
      codeBytes: entryCodeBytes,
      relocations: [
        {
          stableKey: "reloc:entry:branch-to-boot",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          instructionPatch: {
            bitRange: [0, 25] as const,
            encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
          },
        },
      ],
    }),
    createUnwindObjects: () => ({
      kind: "ok" as const,
      objects: [
        {
          objectKey: "unwind",
          pdataBytes: entryCodeBytes,
          xdataBytes: entryCodeBytes,
          functionLinkageName: "Boot.main",
          frameShape: "frameless-leaf",
          pdataRelocation: {
            stableKey: "reloc:pdata:function",
            offsetBytes: 0,
            widthBytes: 4,
            family: "branch26",
            instructionPatch: {
              bitRange: [0, 25] as const,
              encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
            },
          },
          xdataRelocation: {
            stableKey: "reloc:xdata:function",
            offsetBytes: 0,
            widthBytes: 4,
            family: "branch26",
            instructionPatch: {
              bitRange: [0, 25] as const,
              encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
            },
          },
        },
      ],
    }),
  });
}

import { describe, expect, test } from "bun:test";

import {
  linkAArch64Image,
  type AArch64LinkInputModule,
  type LinkAArch64ImageResult,
} from "../../../src/linker";
import { aarch64ObjectSectionClassKey } from "../../../src/target/aarch64/backend/api/ids";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import {
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectUnwindRecord,
} from "../../../src/target/aarch64/backend/object/object-module";
import {
  byteProvenanceForTest,
  sectionForTest,
} from "../../support/target/aarch64/backend/object-module-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../../support/linker/linker-fixtures";

const EXPECTED_STAGE_KEYS = [
  "authenticate-link-target",
  "materialize-synthetic-objects",
  "verify-input-objects",
  "normalize-link-graph",
  "resolve-symbols",
  "layout-sections",
  "materialize-symbol-rvas",
  "plan-relocations",
  "apply-relocations",
  "resolve-entry",
  "materialize-unwind-metadata",
  "verify-linked-image",
];

describe("AArch64 link orchestration", () => {
  test("links Boot.main with entry and unwind providers through every public stage", () => {
    const result = linkSuccessfulImage([bootModuleForOrchestrationTest()]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked image");
    expect(verifierKeys(result)).toEqual(EXPECTED_STAGE_KEYS);
    expect(result.verification.runs.map((run) => run.status)).toEqual(
      EXPECTED_STAGE_KEYS.map(() => "passed"),
    );
    expect(result.layout.verification.runs.map((run) => run.verifierKey)).toEqual([
      ...EXPECTED_STAGE_KEYS,
    ]);
    expect(result.layout.entry.loaderEntryLinkageName).toBe("__wrela_uefi_entry");
    expect(result.layout.entry.wrelaBootLinkageName).toBe("Boot.main");
    expect(result.layout.entry.loaderEntryRva).toBeGreaterThanOrEqual(0);
    expect(result.layout.entry.wrelaBootRva).toBeGreaterThanOrEqual(0);
    expect(result.layout.unwindRecords.length).toBeGreaterThan(0);
    expect(result.layout.dataDirectorySources.map((source) => source.directoryKind)).toContain(
      "exception",
    );
    expect(result.layout.verification.runs.some((run) => run.status === "failed")).toBe(false);
  });

  test("unresolved external stops before layout and returns no partial layout", () => {
    const result = linkAArch64Image({
      objectModules: [unresolvedExternalModuleForTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected link error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toContain("resolve-symbols");
    expect(verifierKeys(result)).not.toContain("layout-sections");
  });

  test("shuffling equivalent input modules produces identical fingerprints and labels", () => {
    const first = linkSuccessfulImage([bootModuleForOrchestrationTest(), dataModuleForTest("a")]);
    const second = linkSuccessfulImage([dataModuleForTest("a"), bootModuleForOrchestrationTest()]);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected linked images");
    expect(first.layout.deterministicMetadata.layoutFingerprint).toBe(
      second.layout.deterministicMetadata.layoutFingerprint,
    );
    expect(sectionAndSymbolLabels(first)).toEqual(sectionAndSymbolLabels(second));
  });

  test("input verification failure has no partial layout and stops at verify-input-objects", () => {
    const result = linkAArch64Image({
      objectModules: [badSectionModuleForTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input verification error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual([
      "authenticate-link-target",
      "materialize-synthetic-objects",
      "verify-input-objects",
    ]);
    expect(result.verification.runs.at(-1)?.status).toBe("failed");
  });

  test("input verification runs the backend object verifier before graph normalization", () => {
    const result = linkAArch64Image({
      objectModules: [
        missingObjectRelocationDeclarationModuleForTest(),
        foreignRelocationTargetModuleForTest(),
      ],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected backend object verification error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual([
      "authenticate-link-target",
      "materialize-synthetic-objects",
      "verify-input-objects",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "linker-input:object-verifier:module:test:missing-reloc-declaration:object-verifier:symbol-missing:reloc:foreign:Foreign.target",
    );
  });

  test("malformed caller module entries return verify-input diagnostics instead of throwing", () => {
    const result = linkAArch64Image({
      objectModules: [{ moduleKey: "module:test:missing-object" } as never],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed module error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("verify-input-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:missing-object-module:module:test:missing-object",
    ]);
  });

  test("malformed caller object modules return verify-input diagnostics instead of throwing", () => {
    const result = linkAArch64Image({
      objectModules: [{ moduleKey: "module:test:malformed-object", objectModule: {} } as never],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed object module error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("verify-input-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "linker-input:malformed-object-module:module:test:malformed-object:sections",
    );
  });

  test("malformed synthetic provider output returns materialization diagnostics instead of throwing", () => {
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        {
          providerKey: "bad-provider",
          provideObjects: () => ({
            kind: "ok" as const,
            modules: [
              { moduleKey: "module:synthetic:bad-provider:entry", objectKey: "entry" } as never,
            ],
          }),
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-provider-module:bad-provider:0",
    ]);
  });

  test("malformed synthetic provider object modules return materialization diagnostics", () => {
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        {
          providerKey: "bad-provider",
          provideObjects: () => ({
            kind: "ok" as const,
            modules: [
              {
                objectKey: "entry",
                moduleKey: "module:synthetic:bad-provider:entry",
                objectModule: {},
              } as never,
            ],
          }),
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider object module error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-provider-module:bad-provider:0",
    ]);
  });

  test("malformed synthetic provider metadata returns materialization diagnostics", () => {
    const target = targetSurfaceForTest();
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target,
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        {
          providerKey: "bad-provider",
          provideObjects: () => ({
            kind: "ok" as const,
            modules: [
              {
                objectKey: "entry",
                moduleKey: "module:synthetic:bad-provider:entry",
                objectModule: {
                  targetBackendSurfaceFingerprint: target.backendSurfaceFingerprint,
                  closedImagePlanFingerprint: "closed-image-plan:bad-provider",
                  sections: [],
                  symbols: [],
                  relocations: [],
                  literalPools: [],
                  veneers: [],
                  unwindRecords: [],
                  diagnostics: [],
                  byteProvenance: [],
                  factSpending: [],
                },
              } as never,
            ],
          }),
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider metadata error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-provider-module:bad-provider:0",
    ]);
  });

  test("malformed provider module arrays return materialization diagnostics", () => {
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [
        {
          providerKey: "bad-provider",
          provideObjects: () =>
            ({
              kind: "ok" as const,
            }) as never,
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider modules error");
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-provider-modules:bad-provider",
    ]);
  });

  test("malformed synthetic provider lists return materialization diagnostics", () => {
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: {} as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider list error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-synthetic-providers",
    ]);
  });

  test("malformed synthetic provider entries return materialization diagnostics", () => {
    const result = linkAArch64Image({
      objectModules: [bootModuleForOrchestrationTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [{} as never],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected malformed provider entry error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("materialize-synthetic-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "linker-input:malformed-synthetic-provider:0",
    ]);
  });

  test("duplicate addr64 base relocation keys fail during relocation application without throwing", () => {
    const result = linkAArch64Image({
      objectModules: [duplicateBaseRelocationModuleForTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate base relocation error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("apply-relocations"));
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith(
          "relocation:base-relocation-duplicate:base-reloc:dir64:.data:",
        ),
      ),
    ).toBe(true);
  });

  test("duplicate byte provenance stable keys fail during input verification without throwing", () => {
    const result = linkAArch64Image({
      objectModules: [duplicateByteProvenanceModuleForTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate provenance error");
    expect("layout" in result).toBe(false);
    expect(verifierKeys(result)).toEqual(expectedFailedStageKeys("verify-input-objects"));
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "linker-input:object-verifier:module:test:duplicate-provenance:object-verifier:duplicate-byte-provenance-stable-key:.text.boot:provenance:duplicate",
    );
  });

  test("links source unwind records through the synthetic unwind provider without duplicate metadata", () => {
    const result = linkAArch64Image({
      objectModules: [badUnwindModuleForTest()],
      target: targetSurfaceForTest(),
      entry: { wrelaBootLinkageName: "Boot.main" },
      syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked image");
    expect(result.layout.unwindRecords).toHaveLength(1);
    expect(result.layout.unwindRecords[0]).toEqual(
      expect.objectContaining({
        functionSymbolKey: "module:test:bad-unwind:symbol:main",
      }),
    );
  });

  test.each([
    {
      name: "authenticate-link-target",
      result: () =>
        linkAArch64Image({
          objectModules: [bootModuleForOrchestrationTest()],
          target: { ...targetSurfaceForTest(), targetKey: "bad-target" },
          entry: { wrelaBootLinkageName: "Boot.main" },
        }),
      failedStage: "authenticate-link-target",
    },
    {
      name: "materialize-synthetic-objects",
      result: () =>
        linkAArch64Image({
          objectModules: [bootModuleForOrchestrationTest()],
          target: targetSurfaceForTest(),
          entry: { wrelaBootLinkageName: "Boot.main" },
          syntheticObjects: [
            {
              providerKey: "bad",
              provideObjects: () => ({
                kind: "ok" as const,
                modules: [],
              }),
            },
          ],
        }),
      failedStage: "materialize-synthetic-objects",
    },
    {
      name: "normalize-link-graph",
      result: () =>
        linkAArch64Image({
          objectModules: [
            moduleWithFactForOrchestrationTest("module:test:fact:a", "packet-length"),
            moduleWithFactForOrchestrationTest("module:test:fact:b", "other-payload"),
          ],
          target: targetSurfaceForTest(),
          entry: { wrelaBootLinkageName: "Boot.main" },
          syntheticObjects: [entryShimProviderForTest()],
        }),
      failedStage: "normalize-link-graph",
    },
    {
      name: "apply-relocations",
      result: () =>
        linkAArch64Image({
          objectModules: [outOfRangeBranchModuleForTest()],
          target: targetSurfaceForTest(),
          entry: { wrelaBootLinkageName: "Boot.main" },
          syntheticObjects: [entryShimProviderForTest()],
        }),
      failedStage: "apply-relocations",
    },
    {
      name: "resolve-entry",
      result: () =>
        linkAArch64Image({
          objectModules: [bootModuleForOrchestrationTest()],
          target: targetSurfaceForTest(),
          entry: { wrelaBootLinkageName: "Boot.main" },
        }),
      failedStage: "resolve-entry",
    },
    {
      name: "materialize-unwind-metadata",
      result: () =>
        linkAArch64Image({
          objectModules: [badUnwindModuleForTest()],
          target: targetSurfaceForTest(),
          entry: { wrelaBootLinkageName: "Boot.main" },
          syntheticObjects: [entryShimProviderForTest()],
        }),
      failedStage: "materialize-unwind-metadata",
    },
  ])("stops at $name without a partial layout", ({ result, failedStage }) => {
    const linked = result();

    expect(linked.kind).toBe("error");
    if (linked.kind !== "error") throw new Error("expected stage failure");
    expect("layout" in linked).toBe(false);
    expect(verifierKeys(linked)).toEqual(expectedFailedStageKeys(failedStage));
    expect(linked.verification.runs.at(-1)?.status).toBe("failed");
  });
});

function linkSuccessfulImage(
  objectModules: readonly AArch64LinkInputModule[],
): LinkAArch64ImageResult {
  return linkAArch64Image({
    objectModules,
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });
}

function bootModuleForOrchestrationTest(): AArch64LinkInputModule {
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

function dataModuleForTest(stableKey: string): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: `module:test:data:${stableKey}`,
    sections: [textSectionForLinkTest({ stableKey: `.text.${stableKey}` })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: `function:${stableKey}`,
        linkageName: `Data.${stableKey}`,
        sectionKey: `.text.${stableKey}`,
      }),
    ],
  });
}

function unresolvedExternalModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:unresolved",
    sections: [textSectionForLinkTest({ stableKey: ".text.unresolved", bytes: [0, 0, 0, 0x94] })],
    symbols: [
      externalSymbolForLinkTest({
        stableKey: "extern:Missing.symbol",
        linkageName: "Missing.symbol",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "reloc:missing",
        sectionKey: ".text.unresolved",
        target: { kind: "linkage-name", linkageName: "Missing.symbol" },
        encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
      }),
    ],
  });
}

function badSectionModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:bad-section",
    sections: [
      {
        ...textSectionForLinkTest({ stableKey: ".unknown" }),
        classKey: aarch64ObjectSectionClassKey("unknown-section-class"),
      },
    ],
  });
}

function missingObjectRelocationDeclarationModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:missing-reloc-declaration",
    sections: [textSectionForLinkTest({ stableKey: ".text.boot", bytes: [0, 0, 0, 0x94] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "reloc:foreign",
        sectionKey: ".text.boot",
        target: { kind: "linkage-name", linkageName: "Foreign.target" },
        encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
      }),
    ],
  });
}

function foreignRelocationTargetModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:foreign-target",
    sections: [textSectionForLinkTest({ stableKey: ".text.foreign" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "foreign-target",
        linkageName: "Foreign.target",
        sectionKey: ".text.foreign",
      }),
    ],
  });
}

function moduleWithFactForOrchestrationTest(
  moduleKey: string,
  payload: string,
): AArch64LinkInputModule {
  const module = objectModuleForLinkTest({ moduleKey });
  return {
    ...module,
    objectModule: aarch64ObjectModule({
      targetBackendSurfaceFingerprint: module.objectModule.targetBackendSurfaceFingerprint,
      closedImagePlanFingerprint: module.objectModule.closedImagePlanFingerprint,
      sections: module.objectModule.sections,
      symbols: module.objectModule.symbols,
      relocations: module.objectModule.relocations,
      literalPools: module.objectModule.literalPools,
      veneers: module.objectModule.veneers,
      unwindRecords: module.objectModule.unwindRecords,
      byteProvenance: module.objectModule.byteProvenance,
      factSpending: [
        {
          stableKey: "fact-spent:bounds:packet-length",
          authority: "bounds",
          payload,
        },
      ],
    }),
  };
}

function outOfRangeBranchModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:out-of-range",
    sections: [textSectionForLinkTest({ stableKey: ".text.range", bytes: [0, 0, 0, 0x94] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.range",
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: "reloc:too-far",
        sectionKey: ".text.range",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: "Boot.main" },
        addend: 134_217_728n,
        bitRange: [0, 25],
        encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
      }),
    ],
  });
}

function duplicateBaseRelocationModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:duplicate-base-reloc",
    sections: [
      textSectionForLinkTest({ stableKey: ".text.boot" }),
      dataSectionForLinkTest({
        stableKey: ".data.ptr",
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
        alignmentBytes: 8,
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "reloc:pointer:a",
        sectionKey: ".data.ptr",
        offsetBytes: 0,
        widthBytes: 8,
        family: "addr64",
        target: { kind: "linkage-name", linkageName: "Boot.main" },
      }),
      relocationForLinkTest({
        stableKey: "reloc:pointer:b",
        sectionKey: ".data.ptr",
        offsetBytes: 0,
        widthBytes: 8,
        family: "addr64",
        target: { kind: "linkage-name", linkageName: "Boot.main" },
      }),
    ],
  });
}

function duplicateByteProvenanceModuleForTest(): AArch64LinkInputModule {
  const module = bootModuleForOrchestrationTest();
  return {
    ...module,
    moduleKey: "module:test:duplicate-provenance",
    objectModule: {
      ...module.objectModule,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "provenance:duplicate",
          sectionKey: ".text.boot",
          startOffsetBytes: 0,
          byteLength: 2,
        }),
        byteProvenanceForTest({
          stableKey: "provenance:duplicate",
          sectionKey: ".text.boot",
          startOffsetBytes: 2,
          byteLength: 2,
        }),
      ],
    },
  } as unknown as AArch64LinkInputModule;
}

function badUnwindModuleForTest(): AArch64LinkInputModule {
  const module = objectModuleForLinkTest({
    moduleKey: "module:test:bad-unwind",
    sections: [
      textSectionForLinkTest({ stableKey: ".text.boot" }),
      sectionForTest({
        stableKey: ".xdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
        alignmentBytes: 4,
        bytes: [0xc0, 0x03, 0x5f, 0xd6],
      }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot",
      }),
    ],
  });
  return {
    ...module,
    objectModule: aarch64ObjectModule({
      targetBackendSurfaceFingerprint: module.objectModule.targetBackendSurfaceFingerprint,
      closedImagePlanFingerprint: module.objectModule.closedImagePlanFingerprint,
      sections: module.objectModule.sections,
      symbols: module.objectModule.symbols,
      relocations: module.objectModule.relocations,
      literalPools: module.objectModule.literalPools,
      veneers: module.objectModule.veneers,
      unwindRecords: [
        aarch64ObjectUnwindRecord({
          stableKey: "unwind:main",
          sectionKey: ".text.boot",
          frameShape: "leaf",
        }),
      ],
      byteProvenance: module.objectModule.byteProvenance,
      factSpending: module.objectModule.factSpending,
    }),
  };
}

function verifierKeys(result: LinkAArch64ImageResult): readonly string[] {
  return result.verification.runs.map((run) => run.verifierKey);
}

function expectedFailedStageKeys(failedStage: string): readonly string[] {
  const index = EXPECTED_STAGE_KEYS.indexOf(failedStage);
  return [...EXPECTED_STAGE_KEYS.slice(0, index), failedStage];
}

function sectionAndSymbolLabels(result: Extract<LinkAArch64ImageResult, { readonly kind: "ok" }>) {
  return {
    sections: result.layout.sections.map((section) => ({
      stableKey: section.stableKey,
      contributions: section.contributions.map((contribution) => contribution.stableKey),
    })),
    symbols: result.layout.symbols.map((symbol) => ({
      symbolKey: symbol.symbolKey,
      linkageName: symbol.linkageName,
    })),
  };
}

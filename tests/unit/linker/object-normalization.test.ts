import { describe, expect, test } from "bun:test";

import {
  normalizeAArch64LinkInputs,
  type NormalizedLinkGraph,
} from "../../../src/linker/object-normalization";
import { authenticateAArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import {
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
  globalSymbolForLinkTest,
  externalSymbolForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import type { AArch64LinkInputModule } from "../../../src/linker";
import type { AArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import type { AArch64ObjectModule } from "../../../src/target/aarch64/backend/object/object-module";

describe("AArch64 object input normalization", () => {
  test("sorts and freezes modules while coalescing identical fact-spending records", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: [
        moduleWithFact("module:test:z", "packet-length"),
        moduleWithFact("module:test:a", "packet-length"),
      ],
    });

    expect(result.kind).toBe("ok");
    const graph = expectGraph(result);
    expect(graph.modules.map((module) => module.moduleKey)).toEqual([
      "module:test:a",
      "module:test:z",
    ]);
    expect(graph.factSpending).toEqual([
      {
        stableKey: "fact-spent:bounds:packet-length",
        authority: "bounds",
        payload: "packet-length",
        sourceModuleKeys: ["module:test:a", "module:test:z"],
      },
    ]);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.modules)).toBe(true);
    expect(Object.isFrozen(graph.modules[0])).toBe(true);
    expect(Object.isFrozen(graph.factSpending[0]?.sourceModuleKeys)).toBe(true);
  });

  test("rejects missing, empty, and duplicate module keys", () => {
    const target = targetSurfaceForNormalizationTest();
    const cases: readonly [string, readonly AArch64LinkInputModule[], readonly string[]][] = [
      ["empty list", [], ["linker-input:empty-object-modules"]],
      ["missing", [unsafeModule({ moduleKey: undefined })], ["linker-input:missing-module-key"]],
      ["empty", [unsafeModule({ moduleKey: "" })], ["linker-input:empty-module-key"]],
      [
        "duplicate",
        [
          objectModuleForLinkTest({ moduleKey: "module:test:dup" }),
          objectModuleForLinkTest({ moduleKey: "module:test:dup" }),
        ],
        ["linker-input:duplicate-module-key:module:test:dup"],
      ],
      ["malformed entry", [undefined as never], ["linker-input:malformed-module-entry:0"]],
      [
        "missing object module",
        [{ moduleKey: "module:test:missing-object" } as never],
        ["linker-input:missing-object-module:module:test:missing-object"],
      ],
      [
        "malformed object module",
        [{ moduleKey: "module:test:malformed-object", objectModule: {} } as never],
        [
          "linker-input:malformed-object-module:module:test:malformed-object:byteProvenance",
          "linker-input:malformed-object-module:module:test:malformed-object:deterministicMetadata",
          "linker-input:malformed-object-module:module:test:malformed-object:diagnostics",
          "linker-input:malformed-object-module:module:test:malformed-object:factSpending",
          "linker-input:malformed-object-module:module:test:malformed-object:literalPools",
          "linker-input:malformed-object-module:module:test:malformed-object:relocations",
          "linker-input:malformed-object-module:module:test:malformed-object:sections",
          "linker-input:malformed-object-module:module:test:malformed-object:symbols",
          "linker-input:malformed-object-module:module:test:malformed-object:unwindRecords",
          "linker-input:malformed-object-module:module:test:malformed-object:veneers",
        ],
      ],
    ];

    for (const [, objectModules, stableDetails] of cases) {
      const result = normalizeAArch64LinkInputs({ target, objectModules });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected module key error");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code as string)).toEqual(
        stableDetails.map(() => "LINKER_INPUT_INVALID"),
      );
      expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
        ...stableDetails,
      ]);
    }
  });

  test("rejects malformed object module lists before reading entries", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: undefined as never,
    });

    expectStableDetails(result, ["linker-input:malformed-object-modules"]);
  });

  test("rejects object modules missing deterministic metadata before freezing normalized modules", () => {
    const target = targetSurfaceForNormalizationTest();
    const result = normalizeAArch64LinkInputs({
      target,
      objectModules: [
        {
          moduleKey: "module:test:missing-metadata",
          objectModule: {
            targetBackendSurfaceFingerprint: target.backendSurfaceFingerprint,
            closedImagePlanFingerprint: "closed-image-plan:missing-metadata",
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
    });

    expectStableDetails(result, [
      "linker-input:malformed-object-module:module:test:missing-metadata:deterministicMetadata",
    ]);
  });

  test("rejects backend target fingerprints that do not match the linker target", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:bad-target",
          targetBackendSurfaceFingerprint: "other-backend-target",
        }),
      ],
    });

    expectStableDetails(result, [
      "linker-input:target-fingerprint-mismatch:module:test:bad-target",
    ]);
  });

  test("rejects unknown section classes using target policy", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:unknown-section-class",
          sections: [textSectionForLinkTest({ stableKey: ".mystery" })].map((section) => ({
            ...section,
            classKey: "mystery-class" as never,
          })),
        }),
      ],
    });

    expectStableDetails(result, [
      "linker-input:unknown-section-class:module:test:unknown-section-class:.mystery:mystery-class",
    ]);
  });

  test("rejects definitions with missing sections and externals carrying a section", () => {
    const target = targetSurfaceForNormalizationTest();
    const missingSection = withObjectModuleOverride(objectModuleForLinkTest({}), {
      symbols: [globalSymbolForLinkTest({ stableKey: "main", sectionKey: ".missing" as never })],
    });
    const externalWithSection = withObjectModuleOverride(objectModuleForLinkTest({}), {
      symbols: [
        {
          ...externalSymbolForLinkTest({ stableKey: "ext" }),
          sectionKey: ".text",
        } as never,
      ],
    });

    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [missingSection] }), [
      "linker-input:symbol-section-missing:module:test:object:main:.missing",
    ]);
    expectStableDetails(
      normalizeAArch64LinkInputs({ target, objectModules: [externalWithSection] }),
      ["linker-input:external-symbol-has-section:module:test:object:ext"],
    );
  });

  test("rejects invalid relocation patch ranges and unknown relocation families", () => {
    const target = targetSurfaceForNormalizationTest();
    const outOfBounds = withObjectModuleOverride(
      objectModuleForLinkTest({
        moduleKey: "module:test:reloc-bounds",
        relocations: [
          relocationForLinkTest({
            stableKey: "call",
            offsetBytes: 0,
            widthBytes: 4,
            target: { kind: "linkage-name", linkageName: "Boot.main" },
            encodingOwner: { opcode: "bl", catalogEntryKey: "bl" },
          }),
        ],
      }),
      {
        relocations: [
          {
            ...relocationForLinkTest({
              stableKey: "call",
              offsetBytes: 0,
              widthBytes: 4,
              target: { kind: "linkage-name", linkageName: "Boot.main" },
              encodingOwner: { opcode: "bl", catalogEntryKey: "bl" },
            }),
            offsetBytes: 2,
          },
        ],
      },
    );
    const unknownFamily = objectModuleForLinkTest({
      moduleKey: "module:test:reloc-family",
      relocations: [
        relocationForLinkTest({
          stableKey: "call",
          family: "not-real",
          target: { kind: "linkage-name", linkageName: "Boot.main" },
        }),
      ],
    });

    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [outOfBounds] }), [
      "linker-input:relocation-patch-out-of-bounds:module:test:reloc-bounds:call:.text:2:4",
    ]);
    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [unknownFamily] }), [
      "linker-input:unknown-relocation-family:module:test:reloc-family:call:not-real",
    ]);
  });

  test("rejects negative relocation offsets and non-positive relocation widths", () => {
    const target = targetSurfaceForNormalizationTest();
    const negativeOffset = withObjectModuleOverride(objectModuleForLinkTest({}), {
      relocations: [
        {
          ...relocationForLinkTest({
            stableKey: "call",
            target: { kind: "linkage-name", linkageName: "Boot.main" },
            encodingOwner: { opcode: "bl", catalogEntryKey: "bl" },
          }),
          offsetBytes: -1,
        },
      ],
    });
    const nonPositiveWidth = withObjectModuleOverride(objectModuleForLinkTest({}), {
      relocations: [
        {
          ...relocationForLinkTest({
            stableKey: "call",
            target: { kind: "linkage-name", linkageName: "Boot.main" },
            encodingOwner: { opcode: "bl", catalogEntryKey: "bl" },
          }),
          widthBytes: 0,
        },
      ],
    });

    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [negativeOffset] }), [
      "linker-input:relocation-patch-out-of-bounds:module:test:object:call:.text:-1:4",
    ]);
    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [nonPositiveWidth] }), [
      "linker-input:relocation-patch-out-of-bounds:module:test:object:call:.text:0:0",
    ]);
  });

  test("rejects instruction relocations without instruction patch or encoding-owner metadata", () => {
    const target = targetSurfaceForNormalizationTest();
    const noBitRange = withObjectModuleOverride(objectModuleForLinkTest({}), {
      relocations: [
        {
          ...relocationForLinkTest({
            stableKey: "call",
            target: { kind: "linkage-name", linkageName: "Boot.main" },
            encodingOwner: { opcode: "bl", catalogEntryKey: "bl" },
          }),
          instructionPatch: undefined,
        },
      ],
    });
    const noOwner = objectModuleForLinkTest({
      moduleKey: "module:test:no-owner",
      relocations: [
        relocationForLinkTest({
          stableKey: "call",
          encodingOwner: undefined,
          target: { kind: "linkage-name", linkageName: "Boot.main" },
        }),
      ],
    });

    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [noBitRange] }), [
      "linker-input:instruction-relocation-missing-patch:module:test:object:call",
    ]);
    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [noOwner] }), [
      "linker-input:instruction-relocation-missing-encoding-owner:module:test:no-owner:call",
    ]);
  });

  test("rejects low-12 load/store relocations without access scale bytes", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:low12",
          relocations: [
            relocationForLinkTest({
              stableKey: "load-low12",
              family: "pageoffset-12l",
              target: { kind: "linkage-name", linkageName: "Boot.main" },
              encodingOwner: { opcode: "ldr-x-unsigned-immediate", catalogEntryKey: "ldr" },
            }),
          ],
        }),
      ],
    });

    expectStableDetails(result, [
      "linker-input:low12-load-store-missing-access-scale:module:test:low12:load-low12",
    ]);
  });

  test("rejects non-empty sections without full byte provenance coverage", () => {
    const module = withObjectModuleOverride(objectModuleForLinkTest({}), {
      byteProvenance: [],
    });

    expectStableDetails(
      normalizeAArch64LinkInputs({
        target: targetSurfaceForNormalizationTest(),
        objectModules: [module],
      }),
      ["linker-input:byte-provenance-gap:module:test:object:.text:0"],
    );
  });

  test("rejects overlapping byte provenance ranges without per-byte coverage state", () => {
    const module = withObjectModuleOverride(objectModuleForLinkTest({}), {
      byteProvenance: [
        {
          stableKey: "provenance:first",
          sectionKey: ".text" as never,
          startOffsetBytes: 0,
          byteLength: 3,
          source: "test",
          factFamilies: [],
        },
        {
          stableKey: "provenance:overlap",
          sectionKey: ".text" as never,
          startOffsetBytes: 2,
          byteLength: 2,
          source: "test",
          factFamilies: [],
        },
      ],
    });

    expectStableDetails(
      normalizeAArch64LinkInputs({
        target: targetSurfaceForNormalizationTest(),
        objectModules: [module],
      }),
      ["linker-input:byte-provenance-overlap:module:test:object:.text:provenance:overlap:2:3"],
    );
  });

  test("rejects byte provenance outside its source section", () => {
    const overflow = withObjectModuleOverride(objectModuleForLinkTest({}), {
      byteProvenance: [
        {
          stableKey: "provenance:overflow",
          sectionKey: ".text" as never,
          startOffsetBytes: 0,
          byteLength: 5,
          source: "test",
          factFamilies: [],
        },
      ],
    });
    const negative = withObjectModuleOverride(objectModuleForLinkTest({}), {
      byteProvenance: [
        {
          stableKey: "provenance:negative",
          sectionKey: ".text" as never,
          startOffsetBytes: -1,
          byteLength: 5,
          source: "test",
          factFamilies: [],
        },
      ],
    });
    const missingSection = withObjectModuleOverride(objectModuleForLinkTest({}), {
      byteProvenance: [
        {
          stableKey: "provenance:missing",
          sectionKey: ".missing" as never,
          startOffsetBytes: 0,
          byteLength: 1,
          source: "test",
          factFamilies: [],
        },
      ],
    });
    const target = targetSurfaceForNormalizationTest();

    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [overflow] }), [
      "linker-input:byte-provenance-gap:module:test:object:.text:0",
      "linker-input:byte-provenance-out-of-bounds:module:test:object:provenance:overflow:.text:0:5",
    ]);
    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [negative] }), [
      "linker-input:byte-provenance-gap:module:test:object:.text:0",
      "linker-input:byte-provenance-out-of-bounds:module:test:object:provenance:negative:.text:-1:5",
    ]);
    expectStableDetails(normalizeAArch64LinkInputs({ target, objectModules: [missingSection] }), [
      "linker-input:byte-provenance-gap:module:test:object:.text:0",
      "linker-input:byte-provenance-section-missing:module:test:object:provenance:missing:.missing",
    ]);
  });

  test("rejects conflicting fact-spending records with stable detail including the stable key", () => {
    const result = normalizeAArch64LinkInputs({
      target: targetSurfaceForNormalizationTest(),
      objectModules: [
        moduleWithFact("module:test:a", "packet-length"),
        moduleWithFact("module:test:b", "different-payload"),
      ],
    });

    expectStableDetails(result, [
      "linker-input:fact-spending-conflict:fact-spent:bounds:packet-length",
    ]);
  });
});

function targetSurfaceForNormalizationTest(): AArch64LinkerTargetSurface {
  const result = authenticateAArch64LinkerTargetSurface();
  if (result.kind !== "ok") throw new Error("expected authenticated target surface");
  return result.value;
}

function moduleWithFact(moduleKey: string, payload: string): AArch64LinkInputModule {
  const module = objectModuleForLinkTest({ moduleKey });
  return withObjectModuleOverride(module, {
    factSpending: [
      {
        stableKey: "fact-spent:bounds:packet-length",
        authority: "bounds",
        payload,
      },
    ],
  });
}

function unsafeModule(input: { readonly moduleKey: string | undefined }): AArch64LinkInputModule {
  return {
    moduleKey: input.moduleKey as string,
    objectModule: objectModuleForLinkTest({ moduleKey: "module:test:unsafe" }).objectModule,
  };
}

function withObjectModuleOverride(
  module: AArch64LinkInputModule,
  overrides: Partial<AArch64ObjectModule>,
): AArch64LinkInputModule {
  return Object.freeze({
    ...module,
    objectModule: Object.freeze({
      ...module.objectModule,
      ...overrides,
    }) as AArch64ObjectModule,
  });
}

function expectGraph(result: ReturnType<typeof normalizeAArch64LinkInputs>): NormalizedLinkGraph {
  if (result.kind !== "ok") throw new Error("expected normalized graph");
  return result.value;
}

function expectStableDetails(
  result: ReturnType<typeof normalizeAArch64LinkInputs>,
  stableDetails: readonly string[],
): void {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected normalization error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code as string)).toEqual(
    stableDetails.map(() => "LINKER_INPUT_INVALID"),
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    ...stableDetails,
  ]);
}

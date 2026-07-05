import { describe, expect, test } from "bun:test";
import { authenticateAArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";
import { AARCH64_PRODUCTION_RELOCATION_FAMILIES } from "../../../src/linker/aarch64/aarch64-relocation-policy";
import {
  AARCH64_PRODUCTION_SECTION_MAPPINGS,
  WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
} from "../../../src/linker/aarch64/aarch64-section-policy";
import { layoutImageSections } from "../../../src/linker/section-layout";
import {
  normalizedGraphForTest,
  paddingFixtureForTest,
} from "../../support/linker/aarch64-normalized-link-fixtures";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";
import {
  dataSectionForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";

describe("layoutImageSections", () => {
  test("adds deterministic padding provenance for aligned contributions", () => {
    const fixture = paddingFixtureForTest();
    const result = layoutImageSections({
      target: targetSurfaceForTest(),
      graph: fixture.graph,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.sections.map((section) => section.stableKey)).toEqual([".text"]);
    expect(Array.from(result.value.sections[0]!.bytes)).toEqual([
      0xc0, 0x03, 0x5f, 0xd6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.value.contributions.map((contribution) => contribution.stableKey)).toEqual([
      "module:test:padding:a:section:.text",
      "module:test:padding:b:section:.text",
    ]);
    expect(result.value.contributions[1]!.offsetBytes).toBe(16);
    expect(result.value.provenance.map((entry) => entry.stableKey)).toContain(
      "padding:.text:module:test:padding:b:section:.text:4",
    );
  });

  test("uses target contribution alignment when it exceeds object alignment", () => {
    const target = authenticatedTargetWithContributionAlignmentForTest({
      contributionAlignmentBytesByOutputSection: { ".text": 32 },
    });
    const graph = normalizedGraphForTest({
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:target-align:a",
          sections: [
            textSectionForLinkTest({ stableKey: ".text.a", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
          ],
          symbols: [
            globalSymbolForLinkTest({
              stableKey: "align-a",
              linkageName: "Align.a",
              sectionKey: ".text.a",
            }),
          ],
        }),
        objectModuleForLinkTest({
          moduleKey: "module:test:target-align:b",
          sections: [
            textSectionForLinkTest({ stableKey: ".text.b", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
          ],
          symbols: [
            globalSymbolForLinkTest({
              stableKey: "align-b",
              linkageName: "Align.b",
              sectionKey: ".text.b",
            }),
          ],
        }),
      ],
    });

    const result = layoutImageSections({ target, graph });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.contributions.map((contribution) => contribution.offsetBytes)).toEqual([
      0, 32,
    ]);
    expect(result.value.provenance.map((entry) => entry.stableKey)).toContain(
      "padding:.text:module:test:target-align:b:section:.text.b:4",
    );
  });

  test("orders sections by target policy and contributions by policy priority then object identity", () => {
    const graph = textAndDataGraphForSectionOrderTest();

    const result = layoutImageSections({ target: targetSurfaceForTest(), graph });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.sections.map((section) => section.stableKey)).toEqual([".text", ".data"]);
    expect(result.value.contributions.map((contribution) => contribution.stableKey)).toEqual([
      "module:test:sort:a:section:.text.a",
      "module:test:sort:z:section:.text.z",
      "module:test:sort:z:section:.data.z",
    ]);
    expect(result.value.sections.map((section) => section.rva)).toEqual([0x1000, 0x2000]);
  });

  test("places the first linked section at the target first section RVA", () => {
    const result = layoutImageSections({
      target: targetSurfaceForTest(),
      graph: normalizedGraphForTest({
        objectModules: [
          objectModuleForLinkTest({
            moduleKey: "module:test:first-section",
            sections: [textSectionForLinkTest({ stableKey: ".text.boot" })],
          }),
        ],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected section layout");
    expect(result.value.sections[0]?.rva).toBe(0x1000);
  });

  test("orders sections deterministically for policy-equivalent section flag insertion order", () => {
    const graph = textAndDataGraphForSectionOrderTest();
    const canonicalTarget = targetSurfaceForTest();
    const reversedFlagsTarget = targetSurfaceWithReversedSectionFlagInsertionOrder();

    expect(reversedFlagsTarget.targetPolicyFingerprint).toBe(
      canonicalTarget.targetPolicyFingerprint,
    );

    const canonical = layoutImageSections({ target: canonicalTarget, graph });
    const reversed = layoutImageSections({ target: reversedFlagsTarget, graph });

    expect(canonical.kind).toBe("ok");
    expect(reversed.kind).toBe("ok");
    if (canonical.kind !== "ok" || reversed.kind !== "ok") throw new Error("expected layouts");
    expect(reversed.value.sections.map(sectionRvaLabel)).toEqual(
      canonical.value.sections.map(sectionRvaLabel),
    );
    expect(reversed.value.sections.map(sectionRvaLabel)).toEqual([".text:4096", ".data:8192"]);
  });

  test("shifts object byte provenance to linked RVAs and preserves source fields", () => {
    const result = layoutImageSections({
      target: targetSurfaceForTest(),
      graph: normalizedGraphForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.provenance).toContainEqual({
      stableKey: "module:test:boot:provenance:provenance:.text",
      sectionKey: ".text",
      rva: 0x1000,
      byteLength: 4,
      sourceModuleKey: "module:test:boot",
      sourceObjectSectionKey: ".text",
      sourceObjectProvenanceKey: "provenance:.text",
      factFamilies: ["fixture-bytes"],
    });
  });

  test("rejects section layout that exceeds the target image size policy", () => {
    const target = {
      ...targetSurfaceForTest(),
      constants: {
        ...targetSurfaceForTest().constants,
        maxImageSizeBytes: 0,
      },
    };
    const graph = normalizedGraphForTest({
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:oversize",
          sections: [
            textSectionForLinkTest({
              stableKey: ".text",
              bytes: [0xc0, 0x03, 0x5f, 0xd6],
            }),
          ],
        }),
      ],
    });

    const result = layoutImageSections({ target, graph });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "section-layout:image-size-exceeds-policy:4100:0",
    );
  });

  test("rejects unsafe integer values while aligning section RVAs", () => {
    const target = {
      ...targetSurfaceForTest(),
      constants: {
        ...targetSurfaceForTest().constants,
        sectionAlignmentBytes: Number.MAX_SAFE_INTEGER + 1,
      },
    };
    const graph = normalizedGraphForTest({
      objectModules: [
        objectModuleForLinkTest({
          moduleKey: "module:test:overflow-text",
          sections: [
            textSectionForLinkTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
          ],
        }),
      ],
    });

    const result = layoutImageSections({ target, graph });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "section-layout:integer-overflow:section-rva:.text",
    );
  });
});

function authenticatedTargetWithContributionAlignmentForTest(input: {
  readonly contributionAlignmentBytes?: number;
  readonly contributionAlignmentBytesByOutputSection?: Readonly<Record<string, number>>;
  readonly contributionAlignmentBytesByObjectSectionClass?: Readonly<Record<string, number>>;
}) {
  const result = authenticateAArch64LinkerTargetSurface({
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    backendSurfaceFingerprint: "backend-target-surface-fingerprint",
    relocationCatalogFingerprint: "relocation-catalog-fingerprint",
    constants: WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
    sectionMappings: AARCH64_PRODUCTION_SECTION_MAPPINGS,
    relocationFamilies: AARCH64_PRODUCTION_RELOCATION_FAMILIES,
    entryPolicy: {
      loaderEntryLinkageName: "__wrela_uefi_entry",
      requiresBootHandoff: true,
      requiredEntrySectionClass: "executable",
    },
    baseRelocationPolicy: {
      families: ["addr64"],
      kindByFamily: { addr64: "dir64" },
    },
    contributionAlignment: input,
  });
  if (result.kind !== "ok") throw new Error("expected contribution alignment target");
  return result.value;
}

function textAndDataGraphForSectionOrderTest() {
  return normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:sort:z",
        sections: [
          textSectionForLinkTest({ stableKey: ".text.z", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
          dataSectionForLinkTest({ stableKey: ".data.z", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
        ],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "sort-z",
            linkageName: "Sort.z",
            sectionKey: ".text.z",
          }),
        ],
      }),
      objectModuleForLinkTest({
        moduleKey: "module:test:sort:a",
        sections: [
          textSectionForLinkTest({ stableKey: ".text.a", bytes: [0xc0, 0x03, 0x5f, 0xd6] }),
        ],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "sort-a",
            linkageName: "Sort.a",
            sectionKey: ".text.a",
          }),
        ],
      }),
    ],
  });
}

function targetSurfaceWithReversedSectionFlagInsertionOrder() {
  const canonical = targetSurfaceForTest();
  const result = authenticateAArch64LinkerTargetSurface({
    targetKey: canonical.targetKey,
    backendSurfaceFingerprint: canonical.backendSurfaceFingerprint,
    relocationCatalogFingerprint: canonical.relocationCatalogFingerprint,
    constants: {
      ...canonical.constants,
      sectionFlags: Object.fromEntries(Object.entries(canonical.constants.sectionFlags).reverse()),
    },
    sectionMappings: canonical.sectionMappings,
    relocationFamilies: canonical.relocationFamilies,
    entryPolicy: canonical.entryPolicy,
    baseRelocationPolicy: canonical.baseRelocationPolicy,
  });
  if (result.kind !== "ok") throw new Error("expected authenticated reversed section flags target");
  return result.value;
}

function sectionRvaLabel(section: { readonly stableKey: string; readonly rva: number }): string {
  return `${section.stableKey}:${section.rva}`;
}

import { describe, expect, test } from "bun:test";

import {
  authenticateAArch64LinkerTargetSurface,
  type AArch64LinkerTargetConstants,
  type AArch64LinkerTargetSurfaceInput,
} from "../../../src/linker/image-layout-policy";
import {
  AARCH64_PRODUCTION_RELOCATION_FAMILIES,
  AARCH64_LINK_RELOCATION_BOUNDS,
} from "../../../src/linker/aarch64/aarch64-relocation-policy";
import {
  AARCH64_PRODUCTION_SECTION_MAPPINGS,
  WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
} from "../../../src/linker/aarch64/aarch64-section-policy";

function productionTargetInputForTest(
  overrides: Partial<AArch64LinkerTargetSurfaceInput> = {},
): AArch64LinkerTargetSurfaceInput {
  return {
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
      kindByFamily: {
        addr64: "dir64",
      },
    },
    ...overrides,
  };
}

describe("authenticateAArch64LinkerTargetSurface", () => {
  test("authenticates the production linker target surface", () => {
    const result = authenticateAArch64LinkerTargetSurface();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected target surface");
    expect(result.value.targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
    expect(result.value.constants).toEqual({
      preferredImageBase: 0n,
      sectionAlignmentBytes: 4096,
      machine: 0xaa64,
      subsystem: 10,
      maxImageSizeBytes: 128 * 1024 * 1024,
      sectionFlags: {
        ".text": 0x60000020,
        ".rdata": 0x40000040,
        ".data": 0xc0000040,
        ".pdata": 0x40000040,
        ".xdata": 0x40000040,
        ".debug$wrela": 0x42000040,
      },
    });
    expect(result.value.outputSectionByObjectClass.get("executable-text")).toBe(".text");
    expect(result.value.objectClassesByOutputSection.get(".rdata")).toEqual(["read-only-data"]);
    expect(result.value.relocationPolicyByFamily.get("addr32")?.allowAbsoluteForV1).toBe(false);
    expect(result.value.entryPolicy.loaderEntryLinkageName).toBe("__wrela_uefi_entry");
    expect(result.value.entryPolicy.requiresBootHandoff).toBe(true);
    expect(result.value.entryPolicy.requiredEntrySectionClass).toBe("executable");
    expect(result.value.baseRelocationPolicy.kindByFamily.addr64).toBe("dir64");
    expect(result.value.targetPolicyFingerprint).toBe("stable-hash:c58c72c5e64e85f9");
  });

  test("returns immutable lookup tables without map mutators", () => {
    const result = authenticateAArch64LinkerTargetSurface();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected target surface");
    expect(result.value.outputSectionByObjectClass.get("executable-text")).toBe(".text");
    expect(result.value.objectClassesByOutputSection.get(".rdata")).toEqual(["read-only-data"]);
    expect(result.value.relocationPolicyByFamily.get("addr32")?.allowAbsoluteForV1).toBe(false);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.constants)).toBe(true);
    expect(Object.isFrozen(result.value.constants.sectionFlags)).toBe(true);
    expect(Object.isFrozen(result.value.sectionMappings)).toBe(true);
    expect(Object.isFrozen(result.value.relocationFamilies)).toBe(true);
    expect("set" in result.value.outputSectionByObjectClass).toBe(false);
    expect("delete" in result.value.objectClassesByOutputSection).toBe(false);
    expect("clear" in result.value.relocationPolicyByFamily).toBe(false);
  });

  test("rejects duplicate section mappings and duplicate output sections deterministically", () => {
    const input = productionTargetInputForTest({
      sectionMappings: [
        { objectSectionClass: "executable-text", outputSectionKey: ".text" },
        { objectSectionClass: "executable-text", outputSectionKey: ".rdata" },
        { objectSectionClass: "read-only-data", outputSectionKey: ".text" },
      ],
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:duplicate-output-section:.text",
      "target-policy:duplicate-section-mapping:executable-text",
      "target-policy:missing-section-mapping:debug-provenance",
      "target-policy:missing-section-mapping:unwind-pdata",
      "target-policy:missing-section-mapping:unwind-xdata",
      "target-policy:missing-section-mapping:writable-data",
    ]);
  });

  test("rejects section mappings that differ from the canonical output section policy", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        sectionMappings: [
          { objectSectionClass: "debug-provenance", outputSectionKey: ".debug$wrela" },
          { objectSectionClass: "executable-text", outputSectionKey: ".rdata" },
          { objectSectionClass: "read-only-data", outputSectionKey: ".rdata2" },
          { objectSectionClass: "surprise", outputSectionKey: ".surprise" },
          { objectSectionClass: "unwind-pdata", outputSectionKey: ".pdata" },
          { objectSectionClass: "unwind-xdata", outputSectionKey: ".xdata" },
          { objectSectionClass: "writable-data", outputSectionKey: ".data" },
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected section policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-section-mapping:executable-text:.rdata:expected:.text",
      "target-policy:invalid-section-mapping:read-only-data:.rdata2:expected:.rdata",
      "target-policy:unexpected-output-section:.rdata2",
      "target-policy:unexpected-output-section:.surprise",
      "target-policy:unexpected-section-mapping:surprise:.surprise",
    ]);
  });

  test("rejects missing and duplicate relocation families deterministically", () => {
    const input = productionTargetInputForTest({
      relocationFamilies: [
        { family: "branch26", bounds: AARCH64_LINK_RELOCATION_BOUNDS.branch26 },
        { family: "branch26", bounds: AARCH64_LINK_RELOCATION_BOUNDS.branch26 },
      ],
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:duplicate-relocation-family:branch26",
      "target-policy:missing-relocation-family:addr32",
      "target-policy:missing-relocation-family:addr32nb",
      "target-policy:missing-relocation-family:addr64",
      "target-policy:missing-relocation-family:branch14",
      "target-policy:missing-relocation-family:branch19",
      "target-policy:missing-relocation-family:pagebase-rel21",
      "target-policy:missing-relocation-family:pageoffset-12a",
      "target-policy:missing-relocation-family:pageoffset-12l",
      "target-policy:missing-relocation-family:rel32",
      "target-policy:missing-relocation-family:section-relative",
    ]);
  });

  test("rejects invalid target constants deterministically", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        constants: {
          ...WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
          preferredImageBase: 1n,
          sectionAlignmentBytes: 8192,
          machine: 0x8664,
          sectionFlags: {
            ...WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS.sectionFlags,
            ".text": 0x40000040,
          },
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected constants policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-constant:machine:34404",
      "target-policy:invalid-constant:preferredImageBase:1",
      "target-policy:invalid-constant:sectionAlignmentBytes:8192",
      "target-policy:invalid-section-flag:.text:1073741888",
    ]);
  });

  test("rejects malformed full target surface inputs without throwing", () => {
    const result = authenticateAArch64LinkerTargetSurface({
      targetKey: "wrela-uefi-aarch64-rpi5-v1",
    } as unknown as AArch64LinkerTargetSurfaceInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input shape error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-input-shape",
    ]);
  });

  test("rejects extra canonical constants and section flags", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        constants: {
          ...WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
          debugMode: 1,
          sectionFlags: {
            ...WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS.sectionFlags,
            ".surprise": 0,
          },
        } as unknown as AArch64LinkerTargetConstants,
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected exact constants policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:unexpected-constant:debugMode",
      "target-policy:unexpected-section-flag:.surprise",
    ]);
  });

  test("rejects relocation bounds that differ from the canonical policy", () => {
    const input = productionTargetInputForTest({
      relocationFamilies: productionTargetInputForTest().relocationFamilies.map((policy) =>
        policy.family === "branch26"
          ? { ...policy, bounds: { ...policy.bounds, maximum: 0n } }
          : policy,
      ),
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation bounds policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-relocation-bounds:branch26",
    ]);
  });

  test("rejects relocation field slices that differ from the canonical policy", () => {
    const input = productionTargetInputForTest({
      relocationFamilies: productionTargetInputForTest().relocationFamilies.map((policy) => {
        if (policy.family !== "pagebase-rel21") return policy;
        return {
          ...policy,
          fieldSlices: [
            { encodedValueStartBit: 2, instructionStartBit: 5, bitCount: 19 },
            { encodedValueStartBit: 0, instructionStartBit: 29, bitCount: 2 },
          ],
        };
      }),
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation field slice policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-relocation-field-slices:pagebase-rel21",
    ]);
  });

  test("rejects missing canonical relocation field slices", () => {
    const input = productionTargetInputForTest({
      relocationFamilies: productionTargetInputForTest().relocationFamilies.map((policy) =>
        policy.family === "pagebase-rel21" ? { ...policy, fieldSlices: undefined } : policy,
      ),
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing field slice policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-relocation-field-slices:pagebase-rel21",
    ]);
  });

  test("rejects addr32 absolute relocation allowance in v1", () => {
    const input = productionTargetInputForTest({
      relocationFamilies: productionTargetInputForTest().relocationFamilies.map((policy) =>
        policy.family === "addr32" ? { ...policy, allowAbsoluteForV1: true } : policy,
      ),
    });

    const result = authenticateAArch64LinkerTargetSurface(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected addr32 policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-relocation-allow-absolute-for-v1:addr32:true",
    ]);
  });

  test("rejects entry policy that differs from the canonical loader entry", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        entryPolicy: {
          loaderEntryLinkageName: "not_the_loader_entry",
          requiresBootHandoff: true,
          requiredEntrySectionClass: "executable",
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-loader-entry-linkage-name:not_the_loader_entry",
    ]);
  });

  test("rejects entry policy that differs from canonical boot handoff and section class", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        entryPolicy: {
          loaderEntryLinkageName: "__wrela_uefi_entry",
          requiresBootHandoff: false,
          requiredEntrySectionClass: "data",
        },
      } as unknown as Partial<AArch64LinkerTargetSurfaceInput>),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected entry policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-required-entry-section-class:data",
      "target-policy:invalid-requires-boot-handoff:false",
    ]);
  });

  test("rejects base relocation policy that differs from canonical dir64 addr64 policy", () => {
    const result = authenticateAArch64LinkerTargetSurface(
      productionTargetInputForTest({
        baseRelocationPolicy: {
          families: ["addr32", "addr64"],
          kindByFamily: {
            addr32: "highlow",
            addr64: "highlow",
          },
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected base relocation policy error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "target-policy:invalid-base-relocation-families:addr32,addr64",
      "target-policy:invalid-base-relocation-kind:addr64:highlow",
      "target-policy:unexpected-base-relocation-kind:addr32",
    ]);
  });
});

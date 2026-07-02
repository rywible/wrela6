import { describe, expect, test } from "bun:test";
import {
  PE_COFF_WRITER_DIAGNOSTIC_CODES,
  authenticateAArch64PeCoffEfiWriterTargetSurface,
} from "../../../src/pe-coff";
import {
  dir64RelocationForTest,
  productionWriterTargetInputForTest,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

describe("AArch64 PE/COFF EFI writer target", () => {
  test("authenticates the production target constants and section names", () => {
    const result = authenticateAArch64PeCoffEfiWriterTargetSurface({
      linkedTargetPolicyFingerprint: "stable-hash:linker-policy",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected authenticated writer target");
    expect(result.value.targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
    expect(result.value.machine).toBe(0xaa64);
    expect(result.value.optionalHeaderMagic).toBe(0x20b);
    expect(result.value.subsystem).toBe(10);
    expect(result.value.imageBase).toBe(0n);
    expect(result.value.sectionAlignmentBytes).toBe(4096);
    expect(result.value.fileAlignmentBytes).toBe(512);
    expect(result.value.firstSectionRva).toBe(4096);
    expect(result.value.maxImageSizeBytes).toBe(128 * 1024 * 1024);
    expect(result.value.numberOfRvaAndSizes).toBe(16);
    expect(result.value.peHeaderOffsetBytes).toBe(0x80);
    expect(result.value.coffTimestamp).toBe(0);
    expect(result.value.majorLinkerVersion).toBe(0);
    expect(result.value.minorLinkerVersion).toBe(0);
    expect(result.value.majorOperatingSystemVersion).toBe(0);
    expect(result.value.minorOperatingSystemVersion).toBe(0);
    expect(result.value.majorImageVersion).toBe(0);
    expect(result.value.minorImageVersion).toBe(0);
    expect(result.value.majorSubsystemVersion).toBe(0);
    expect(result.value.minorSubsystemVersion).toBe(0);
    expect(result.value.sizeOfStackReserveBytes).toBe(0n);
    expect(result.value.sizeOfStackCommitBytes).toBe(0n);
    expect(result.value.sizeOfHeapReserveBytes).toBe(0n);
    expect(result.value.sizeOfHeapCommitBytes).toBe(0n);
    expect(result.value.dllCharacteristics).toBe(0);
    expect(result.value.serializedSectionNames[".debug$wrela"]).toBe(".debug");
    expect(result.value.linkedTargetPolicyFingerprint).toBe("stable-hash:linker-policy");
    expect(result.value.targetPolicyFingerprint).toMatch(/^stable-hash:[0-9a-f]{16}$/);
  });

  test("rejects mismatched target key, changed constants, invalid names, duplicates, and missing names", () => {
    const input = productionWriterTargetInputForTest();
    const result = authenticateAArch64PeCoffEfiWriterTargetSurface({
      ...input,
      targetKey: "other-target",
      machine: 0xaa65,
      serializedSectionNames: {
        ".text": ".text",
        ".rdata": ".text",
        ".data": ".data",
        ".pdata": ".pdata-long",
        ".xdata": ".xd\u{00e1}ta",
        ".debug$wrela": ".debug",
        ".reloc": ".rel\0oc",
        ".surprise": ".extra",
      },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code as string)).toEqual(
      result.diagnostics.map(() => "PE_COFF_TARGET_AUTH_FAILED"),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      expect.arrayContaining([
        "target:key:other-target",
        "target:constant:machine:43621",
        "target:unexpected-section-name:.surprise",
        "target:section-name-too-long:.pdata:.pdata-long",
        "target:section-name-non-ascii:.xdata:.xd\u{00e1}ta",
        "target:section-name-nul:.reloc",
        "target:duplicate-section-name:.text",
      ]),
    );
  });

  test("rejects missing linked target policy fingerprints before hashing", () => {
    const result = authenticateAArch64PeCoffEfiWriterTargetSurface(
      {} as Parameters<typeof authenticateAArch64PeCoffEfiWriterTargetSurface>[0],
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target:linked-target-policy-fingerprint:missing",
    );
  });

  test("fingerprint is deterministic under input key reordering", () => {
    const first = writerTargetForTest();
    const input = productionWriterTargetInputForTest();
    const reordered = authenticateAArch64PeCoffEfiWriterTargetSurface({
      serializedSectionNames: input.serializedSectionNames,
      linkedTargetPolicyFingerprint: input.linkedTargetPolicyFingerprint,
      dllCharacteristics: input.dllCharacteristics,
      sizeOfHeapCommitBytes: input.sizeOfHeapCommitBytes,
      sizeOfHeapReserveBytes: input.sizeOfHeapReserveBytes,
      sizeOfStackCommitBytes: input.sizeOfStackCommitBytes,
      sizeOfStackReserveBytes: input.sizeOfStackReserveBytes,
      minorSubsystemVersion: input.minorSubsystemVersion,
      majorSubsystemVersion: input.majorSubsystemVersion,
      minorImageVersion: input.minorImageVersion,
      majorImageVersion: input.majorImageVersion,
      minorOperatingSystemVersion: input.minorOperatingSystemVersion,
      majorOperatingSystemVersion: input.majorOperatingSystemVersion,
      minorLinkerVersion: input.minorLinkerVersion,
      majorLinkerVersion: input.majorLinkerVersion,
      coffTimestamp: input.coffTimestamp,
      peHeaderOffsetBytes: input.peHeaderOffsetBytes,
      numberOfRvaAndSizes: input.numberOfRvaAndSizes,
      maxImageSizeBytes: input.maxImageSizeBytes,
      firstSectionRva: input.firstSectionRva,
      fileAlignmentBytes: input.fileAlignmentBytes,
      sectionAlignmentBytes: input.sectionAlignmentBytes,
      imageBase: input.imageBase,
      subsystem: input.subsystem,
      optionalHeaderMagic: input.optionalHeaderMagic,
      machine: input.machine,
      targetKey: input.targetKey,
    });

    expect(reordered.kind).toBe("ok");
    if (reordered.kind !== "ok") throw new Error("expected reordered target");
    expect(reordered.value.targetPolicyFingerprint).toBe(first.targetPolicyFingerprint);
    expect(PE_COFF_WRITER_DIAGNOSTIC_CODES).toContain("PE_COFF_TARGET_AUTH_FAILED");
  });

  test("fixtures expose only target input, target, and DIR64 relocation helpers", () => {
    const relocation = dir64RelocationForTest({ rva: 0x2008 });

    expect(writerTargetForTest().targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
    expect(relocation).toEqual({
      stableKey: "base-reloc:dir64:.data:8200",
      kind: "dir64",
      sectionKey: ".data",
      rva: 0x2008,
      widthBytes: 8,
      sourceRelocationKey: "module:test:reloc:absolute",
    });
  });
});

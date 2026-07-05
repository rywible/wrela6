import { describe, expect, test } from "bun:test";

import { linkAArch64Image } from "../../../src/linker";
import {
  PE_FILE_ALIGNMENT_BYTES,
  PE_IMAGE_REL_BASED_DIR64,
  PE_MACHINE_ARM64,
  PE_SECTION_ALIGNMENT_BYTES,
  PE_SUBSYSTEM_EFI_APPLICATION,
  authenticateAArch64PeCoffEfiWriterTargetSurface,
  parsePeCoffImage,
  writeAArch64PeCoffEfiImage,
} from "../../../src/pe-coff";
import {
  peCoffDataRelocationLinkInputForTest,
  productionWriterTargetInputForTest,
  writerTargetForLinkedLayout,
} from "../../support/pe-coff/pe-coff-fixtures";

const IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE = 0x0040;
const IMAGE_DLLCHARACTERISTICS_NX_COMPAT = 0x0100;
const BASE_RELOCATION_DIRECTORY_INDEX = 5;

describe("PE/COFF UEFI artifact conformance", () => {
  test("emits an AArch64 EFI application with UEFI v1 image base and alignment constants", () => {
    const linked = linkAArch64Image(peCoffDataRelocationLinkInputForTest());
    expect(linked.kind).toBe("ok");
    if (linked.kind !== "ok") throw new Error("expected linked image");

    const written = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(linked.layout),
      layout: linked.layout,
    });
    expect(written.kind).toBe("ok");
    if (written.kind !== "ok") throw new Error("expected EFI artifact");

    const parsed = parsePeCoffImage(written.artifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed PE/COFF image");

    expect(parsed.value.coffHeader.machine).toBe(PE_MACHINE_ARM64);
    expect(parsed.value.optionalHeader.subsystem).toBe(PE_SUBSYSTEM_EFI_APPLICATION);
    expect(parsed.value.optionalHeader.imageBase).toBe(0n);
    expect(parsed.value.optionalHeader.sectionAlignmentBytes).toBe(PE_SECTION_ALIGNMENT_BYTES);
    expect(parsed.value.optionalHeader.fileAlignmentBytes).toBe(PE_FILE_ALIGNMENT_BYTES);
  });

  test("emits a base relocation directory and parsed DIR64 entry when linked DIR64 relocations exist", () => {
    const linked = linkAArch64Image(peCoffDataRelocationLinkInputForTest());
    expect(linked.kind).toBe("ok");
    if (linked.kind !== "ok") throw new Error("expected linked image");

    const expectedRelocation = linked.layout.baseRelocations.find(
      (relocation) => relocation.kind === "dir64",
    );
    expect(expectedRelocation).toBeDefined();
    if (expectedRelocation === undefined) throw new Error("expected linked DIR64 relocation");

    const written = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(linked.layout),
      layout: linked.layout,
    });
    expect(written.kind).toBe("ok");
    if (written.kind !== "ok") throw new Error("expected EFI artifact");

    const parsed = parsePeCoffImage(written.artifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed PE/COFF image");

    const relocationDirectory = parsed.value.dataDirectories[BASE_RELOCATION_DIRECTORY_INDEX];
    const relocationSection = parsed.value.sectionHeaders.find(
      (section) => section.name === ".reloc",
    );
    expect(relocationSection).toBeDefined();
    if (relocationSection === undefined) throw new Error("expected .reloc section");
    expect(relocationDirectory).toEqual({
      rva: relocationSection.rva,
      sizeBytes: 12,
    });
    expect(relocationDirectory?.rva).not.toBe(0);
    expect(relocationDirectory?.sizeBytes).not.toBe(0);
    expect(parsed.value.baseRelocationBlocks.flatMap((block) => block.entries)).toContainEqual({
      type: PE_IMAGE_REL_BASED_DIR64,
      offset: expectedRelocation.rva - (expectedRelocation.rva & ~0xfff),
      rva: expectedRelocation.rva,
    });
  });

  test("pins UEFI v1 DLL characteristics with DYNAMIC_BASE and NX_COMPAT both unset", () => {
    const linked = linkAArch64Image(peCoffDataRelocationLinkInputForTest());
    expect(linked.kind).toBe("ok");
    if (linked.kind !== "ok") throw new Error("expected linked image");

    const written = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(linked.layout),
      layout: linked.layout,
    });
    expect(written.kind).toBe("ok");
    if (written.kind !== "ok") throw new Error("expected EFI artifact");

    const parsed = parsePeCoffImage(written.artifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed PE/COFF image");

    expect(parsed.value.optionalHeader.dllCharacteristics).toBe(0);
    expect(
      parsed.value.optionalHeader.dllCharacteristics & IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE,
    ).toBe(0);
    expect(
      parsed.value.optionalHeader.dllCharacteristics & IMAGE_DLLCHARACTERISTICS_NX_COMPAT,
    ).toBe(0);
  });

  test("rejects a target that enables DYNAMIC_BASE for UEFI images", () => {
    const result = authenticateAArch64PeCoffEfiWriterTargetSurface({
      ...productionWriterTargetInputForTest(),
      dllCharacteristics: IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target:constant:dllCharacteristics:64",
    );
  });
});

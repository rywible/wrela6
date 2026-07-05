import { describe, expect, test } from "bun:test";

import { linkAArch64Image } from "../../../src/linker";
import {
  PE_HEADER_OFFSET_BYTES,
  PE_IMAGE_REL_BASED_DIR64,
  PE_MACHINE_ARM64,
  PE_SUBSYSTEM_EFI_APPLICATION,
  PE32_PLUS_MAGIC,
  parsePeCoffImage,
  writeAArch64PeCoffEfiImage,
} from "../../../src/pe-coff";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../../support/linker/linker-fixtures";
import {
  bootModuleForPeCoffIntegrationTest,
  peCoffDataRelocationLinkInputForTest,
  writerTargetForLinkedLayout,
} from "../../support/pe-coff/pe-coff-fixtures";

describe("AArch64 PE/COFF EFI writer integration", () => {
  test("links and writes a PE32+ EFI application", () => {
    const firstLinked = linkTinyBootImage();
    const secondLinked = linkTinyBootImage();
    expect(firstLinked.kind).toBe("ok");
    expect(secondLinked.kind).toBe("ok");
    if (firstLinked.kind !== "ok" || secondLinked.kind !== "ok") {
      throw new Error("expected linked images");
    }

    const firstWritten = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(firstLinked.layout),
      layout: firstLinked.layout,
    });
    const secondWritten = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(secondLinked.layout),
      layout: secondLinked.layout,
    });
    expect(firstWritten.kind).toBe("ok");
    expect(secondWritten.kind).toBe("ok");
    if (firstWritten.kind !== "ok" || secondWritten.kind !== "ok") {
      throw new Error("expected EFI artifacts");
    }

    expect(Array.from(firstWritten.artifact.bytes.slice(0, 2))).toEqual([0x4d, 0x5a]);
    expect(
      firstWritten.artifact.bytes.slice(PE_HEADER_OFFSET_BYTES, PE_HEADER_OFFSET_BYTES + 4),
    ).toEqual(Uint8Array.of(0x50, 0x45, 0x00, 0x00));
    expect(firstWritten.artifact.bytes).toEqual(secondWritten.artifact.bytes);
    expect(firstWritten.artifact.deterministicMetadata.imageFingerprint).toBe(
      secondWritten.artifact.deterministicMetadata.imageFingerprint,
    );

    const parsed = parsePeCoffImage(firstWritten.artifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed image");
    expect(parsed.value.coffHeader.machine).toBe(PE_MACHINE_ARM64);
    expect(parsed.value.optionalHeader.magic).toBe(PE32_PLUS_MAGIC);
    expect(parsed.value.optionalHeader.subsystem).toBe(PE_SUBSYSTEM_EFI_APPLICATION);
    expect(parsed.value.optionalHeader.addressOfEntryPoint).toBe(
      firstLinked.layout.entry.loaderEntryRva,
    );

    const linkedText = firstLinked.layout.sections.find((section) => section.stableKey === ".text");
    const parsedText = parsed.value.sectionHeaders.find((section) => section.name === ".text");
    expect(linkedText).toBeDefined();
    expect(parsedText).toBeDefined();
    if (linkedText === undefined || parsedText === undefined) {
      throw new Error("expected linked and parsed text sections");
    }
    expect(Array.from(parsedText.bytes)).toEqual(Array.from(linkedText.bytes));

    const exceptionSource = firstLinked.layout.dataDirectorySources.find(
      (source) => source.directoryKind === "exception",
    );
    expect(exceptionSource).toBeDefined();
    if (exceptionSource === undefined) throw new Error("expected exception directory source");
    expect(parsed.value.dataDirectories[3]).toEqual({
      rva: exceptionSource.rva,
      sizeBytes: exceptionSource.sizeBytes,
    });
  });

  test("serializes linked DIR64 base relocations into .reloc", () => {
    const linked = linkAArch64Image(peCoffDataRelocationLinkInputForTest());
    expect(linked.kind).toBe("ok");
    if (linked.kind !== "ok") throw new Error("expected linked image");
    expect(linked.layout.baseRelocations).toEqual([
      expect.objectContaining({ kind: "dir64", widthBytes: 8 }),
    ]);

    const written = writeAArch64PeCoffEfiImage({
      target: writerTargetForLinkedLayout(linked.layout),
      layout: linked.layout,
    });
    expect(written.kind).toBe("ok");
    if (written.kind !== "ok") throw new Error("expected EFI artifact");

    const parsed = parsePeCoffImage(written.artifact.bytes);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected parsed image");
    const parsedReloc = parsed.value.sectionHeaders.find((section) => section.name === ".reloc");
    expect(parsedReloc).toBeDefined();
    if (parsedReloc === undefined) throw new Error("expected .reloc section");
    expect(parsed.value.dataDirectories[5]).toEqual({
      rva: parsedReloc.rva,
      sizeBytes: 12,
    });
    expect(parsed.value.baseRelocationBlocks.flatMap((block) => block.entries)).toContainEqual(
      expect.objectContaining({
        type: PE_IMAGE_REL_BASED_DIR64,
        rva: linked.layout.baseRelocations[0]?.rva,
      }),
    );
  });
});

function linkTinyBootImage() {
  return linkAArch64Image({
    objectModules: [bootModuleForPeCoffIntegrationTest()],
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });
}

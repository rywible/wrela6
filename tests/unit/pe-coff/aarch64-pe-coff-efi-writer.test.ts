import { describe, expect, test } from "bun:test";

import { computePeImageChecksum, pe32PlusChecksumFileOffset } from "../../../src/pe-coff";
import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DATA_DIRECTORY_COUNT,
  PE_HEADER_OFFSET_BYTES,
  PE_SECTION_HEADER_SIZE_BYTES,
  PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
} from "../../../src/pe-coff/headers";
import { serializePlannedPeCoffImage } from "../../../src/pe-coff";
import { writeAArch64PeCoffEfiImage } from "../../../src/pe-coff";
import {
  linkedImageLayoutForPeCoffTest,
  plannedImageForWriterTest,
  serializedBytesForPlannedImage,
  writerTargetForTest,
} from "../../support/pe-coff/pe-coff-fixtures";

const PE_SIGNATURE_SIZE_BYTES = 4;
const COFF_HEADER_OFFSET = PE_HEADER_OFFSET_BYTES + PE_SIGNATURE_SIZE_BYTES;
const OPTIONAL_HEADER_OFFSET = COFF_HEADER_OFFSET + PE_COFF_FILE_HEADER_SIZE_BYTES;
const SECTION_TABLE_OFFSET = OPTIONAL_HEADER_OFFSET + PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES;

describe("AArch64 PE/COFF EFI writer", () => {
  test("writes a deterministic EFI artifact through the public orchestration API", () => {
    const target = writerTargetForTest();
    const layout = linkedImageLayoutForPeCoffTest();

    const first = writeAArch64PeCoffEfiImage({ target, layout });
    const second = writeAArch64PeCoffEfiImage({ target, layout });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected artifacts");
    expect(first.artifact.artifactName).toBe("wrela.efi");
    expect(first.artifact.mediaType).toBe("application/vnd.microsoft.portable-executable");
    expect(first.artifact.fileExtension).toBe(".efi");
    expect(first.artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(first.artifact.bytes).toEqual(second.artifact.bytes);
    expect(first.artifact.deterministicMetadata).toEqual(second.artifact.deterministicMetadata);
    expect(first.artifact.deterministicMetadata).toEqual({
      schema: "wrela.pe-coff-efi-image",
      schemaVersion: 1,
      linkedLayoutFingerprint: layout.deterministicMetadata.layoutFingerprint,
      writerTargetFingerprint: target.targetPolicyFingerprint,
      sectionTableFingerprint: expect.stringMatching(/^stable-hash:/),
      dataDirectoryFingerprint: expect.stringMatching(/^stable-hash:/),
      baseRelocationTableFingerprint: expect.stringMatching(/^stable-hash:/),
      headerFingerprint: expect.stringMatching(/^stable-hash:/),
      imageFingerprint: expect.stringMatching(/^stable-hash:/),
    });
    expect(first.verification.runs.map((run) => `${run.runKey}:${run.status}`)).toEqual([
      "target:passed",
      "input-layout:passed",
      "base-relocations:passed",
      "sections:passed",
      "headers:passed",
      "serialize:passed",
      "parse:passed",
      "verify:passed",
    ]);
    expect(first.artifact.verification).toEqual(first.verification);
  });

  test("uses the supplied EFI artifact file name", () => {
    const result = writeAArch64PeCoffEfiImage({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
      artifactName: "bootaa64.efi",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected artifact");
    expect(result.artifact.artifactName).toBe("bootaa64.efi");
  });

  test("rejects artifact names with path separators before layout validation", () => {
    const result = writeAArch64PeCoffEfiImage({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
      artifactName: "out/wrela.efi",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "artifact-name:path-separator:out/wrela.efi",
    );
    expect(result.verification.runs.map((run) => `${run.runKey}:${run.status}`)).toEqual([
      "target:failed",
    ]);
  });

  test("reauthenticates the writer target before planning bytes", () => {
    const result = writeAArch64PeCoffEfiImage({
      target: {
        ...writerTargetForTest(),
        targetPolicyFingerprint: "stable-hash:forged",
      },
      layout: linkedImageLayoutForPeCoffTest(),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `target:fingerprint:stable-hash:forged:expected:${writerTargetForTest().targetPolicyFingerprint}`,
    );
    expect(result.verification.runs.map((run) => `${run.runKey}:${run.status}`)).toEqual([
      "target:failed",
    ]);
  });

  test("rejects partial writer target surfaces even when fingerprints match", () => {
    const target = writerTargetForTest();
    const partialTarget = {
      linkedTargetPolicyFingerprint: target.linkedTargetPolicyFingerprint,
      targetPolicyFingerprint: target.targetPolicyFingerprint,
    } as unknown as ReturnType<typeof writerTargetForTest>;

    const result = writeAArch64PeCoffEfiImage({
      target: partialTarget,
      layout: linkedImageLayoutForPeCoffTest(),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "target:surface:missing:targetKey",
    );
    expect(result.verification.runs.map((run) => `${run.runKey}:${run.status}`)).toEqual([
      "target:failed",
    ]);
  });

  test("rejects artifact names without the efi extension deterministically", () => {
    const result = writeAArch64PeCoffEfiImage({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest(),
      artifactName: "wrela.bin",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "artifact-name:extension:wrela.bin",
    );
  });

  test("reports passed stages before a staged input-layout validation failure", () => {
    const result = writeAArch64PeCoffEfiImage({
      target: writerTargetForTest(),
      layout: linkedImageLayoutForPeCoffTest({
        entryRva: 0x3000,
      }),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "entry:outside-executable-section:12288",
    );
    expect(result.verification.runs.map((run) => `${run.runKey}:${run.status}`)).toEqual([
      "target:passed",
      "input-layout:failed",
    ]);
  });

  test("serializes DOS, PE, COFF, optional header, directories, and section table at fixed offsets", () => {
    const plannedImage = plannedImageForWriterTest();

    const result = serializePlannedPeCoffImage(plannedImage);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized image");
    const bytes = result.value.bytes;
    expect(bytes[0]).toBe(0x4d);
    expect(bytes[1]).toBe(0x5a);
    expect(readU32Le(bytes, 0x3c)).toBe(PE_HEADER_OFFSET_BYTES);
    expect(bytes.slice(2, 0x3c).every((byte) => byte === 0)).toBe(true);
    expect(bytes.slice(0x40, PE_HEADER_OFFSET_BYTES).every((byte) => byte === 0)).toBe(true);

    expect(Array.from(bytes.slice(PE_HEADER_OFFSET_BYTES, PE_HEADER_OFFSET_BYTES + 4))).toEqual([
      0x50, 0x45, 0x00, 0x00,
    ]);
    expect(readU16Le(bytes, COFF_HEADER_OFFSET)).toBe(0xaa64);
    expect(readU16Le(bytes, COFF_HEADER_OFFSET + 2)).toBe(plannedImage.sections.length);
    expect(readU16Le(bytes, COFF_HEADER_OFFSET + 16)).toBe(0xf0);
    expect(readU16Le(bytes, OPTIONAL_HEADER_OFFSET)).toBe(0x20b);
    const checksumOffset = pe32PlusChecksumFileOffset(PE_HEADER_OFFSET_BYTES);
    const checksum = readU32Le(bytes, checksumOffset);
    expect(checksum).not.toBe(0);
    expect(checksum).toBe(result.value.checksum);
    expect(checksum).toBe(computePeImageChecksum(bytes, checksumOffset));
    expect(result.value.headers.optionalHeader.checksum).toBe(checksum);
    expect(plannedImage.headers.optionalHeader.checksum).toBe(0);
    expect(readU32Le(bytes, OPTIONAL_HEADER_OFFSET + 108)).toBe(PE_DATA_DIRECTORY_COUNT);
    expect(readU32Le(bytes, OPTIONAL_HEADER_OFFSET + 112 + 3 * 8)).toBe(0x2000);
    expect(readU32Le(bytes, OPTIONAL_HEADER_OFFSET + 112 + 3 * 8 + 4)).toBe(0x08);
    expect(SECTION_TABLE_OFFSET).toBe(0x188);
  });

  test("writes null-padded section names, raw pointers, raw sizes, bodies, and zero padding", () => {
    const plannedImage = plannedImageForWriterTest();

    const result = serializePlannedPeCoffImage(plannedImage);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected serialized image");
    const bytes = result.value.bytes;

    for (const [index, section] of plannedImage.sections.entries()) {
      const headerOffset = SECTION_TABLE_OFFSET + index * PE_SECTION_HEADER_SIZE_BYTES;
      expect(Array.from(bytes.slice(headerOffset, headerOffset + 8))).toEqual(
        asciiNullPadded(section.serializedName, 8),
      );
      expect(readU32Le(bytes, headerOffset + 16)).toBe(section.rawDataSizeBytes);
      expect(readU32Le(bytes, headerOffset + 20)).toBe(section.rawDataPointerBytes);
      expect(
        Array.from(
          bytes.slice(
            section.rawDataPointerBytes,
            section.rawDataPointerBytes + section.bytes.length,
          ),
        ),
      ).toEqual(Array.from(section.bytes));
      expect(
        bytes
          .slice(
            section.rawDataPointerBytes + section.bytes.length,
            section.rawDataPointerBytes + section.rawDataSizeBytes,
          )
          .every((byte) => byte === 0),
      ).toBe(true);
    }

    const finalSection = plannedImage.sections.at(-1);
    if (finalSection === undefined) throw new Error("expected sections");
    expect(bytes).toHaveLength(finalSection.rawDataPointerBytes + finalSection.rawDataSizeBytes);
    expect(serializedBytesForPlannedImage(plannedImage)).toEqual(bytes);
  });

  test("fails when the byte writer reports a field-width error", () => {
    const plannedImage = plannedImageForWriterTest({
      headers: {
        ...plannedImageForWriterTest().headers,
        coffHeader: {
          ...plannedImageForWriterTest().headers.coffHeader,
          machine: 0x1_0000,
        },
      },
    });

    const result = serializePlannedPeCoffImage(plannedImage);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "byte-writer:range:u16:65536",
    );
  });

  test("fails deterministically when a planned section name does not fit PE image headers", () => {
    const plannedImage = plannedImageForWriterTest({
      sections: [
        {
          ...plannedImageForWriterTest().sections[0]!,
          serializedName: ".toolongname",
        },
      ],
    });

    const result = serializePlannedPeCoffImage(plannedImage);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "section-name:too-long:.text:.toolongname",
    );
  });
});

function readU16Le(bytes: ArrayLike<number>, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32Le(bytes: ArrayLike<number>, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! * 2 ** 24)
  );
}

function asciiNullPadded(value: string, width: number): number[] {
  const encoded = [...value].map((character) => character.charCodeAt(0));
  return [...encoded, ...Array.from({ length: width - encoded.length }, () => 0)];
}

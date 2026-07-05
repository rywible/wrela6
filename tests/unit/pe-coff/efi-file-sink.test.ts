import { describe, expect, test } from "bun:test";

import {
  createPeCoffEfiFileSink,
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffEfiImageArtifact,
  type PeCoffWriterVerificationSummary,
} from "../../../src/pe-coff";

const FILE_SINK_TEST_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-file-sink-test",
      runKey: "fake-write",
      status: "passed" as const,
    }),
  ]),
});

describe("PE/COFF EFI file sink", () => {
  test("uses the injected write function", () => {
    const writes: { readonly artifactName: string; readonly bytes: Uint8Array }[] = [];
    const sink = createPeCoffEfiFileSink({
      writeBytes: (artifactName, bytes) => {
        writes.push({ artifactName, bytes: Uint8Array.from(bytes) });
        return peCoffOk({
          value: undefined,
          verification: FILE_SINK_TEST_VERIFICATION,
        });
      },
    });

    const result = sink.writeArtifact(efiArtifactForSinkTest({ artifactName: "boot.efi" }));

    expect(result.kind).toBe("ok");
    expect(
      writes.map((write) => ({ artifactName: write.artifactName, bytes: Array.from(write.bytes) })),
    ).toEqual([{ artifactName: "boot.efi", bytes: [0x4d, 0x5a] }]);
    expect(writes[0]?.bytes).toBeInstanceOf(Uint8Array);
  });

  test("rejects path separators and non-efi extensions before writing", () => {
    const writes: string[] = [];
    const sink = createPeCoffEfiFileSink({
      writeBytes: (artifactName) => {
        writes.push(artifactName);
        return peCoffOk({
          value: undefined,
          verification: FILE_SINK_TEST_VERIFICATION,
        });
      },
    });

    const pathResult = sink.writeArtifact(efiArtifactForSinkTest({ artifactName: "out/boot.efi" }));
    const extensionResult = sink.writeArtifact(
      efiArtifactForSinkTest({ artifactName: "boot.bin" }),
    );

    expect(pathResult.kind).toBe("error");
    expect(extensionResult.kind).toBe("error");
    expect(pathResult.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "artifact-name:path-separator:out/boot.efi",
    );
    expect(extensionResult.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "artifact-name:extension:boot.bin",
    );
    expect(writes).toEqual([]);
  });

  test("returns deterministic diagnostics for malformed direct artifact input", () => {
    const writes: string[] = [];
    const sink = createPeCoffEfiFileSink({
      writeBytes: (artifactName) => {
        writes.push(artifactName);
        return peCoffOk({
          value: undefined,
          verification: FILE_SINK_TEST_VERIFICATION,
        });
      },
    });

    const result = sink.writeArtifact({
      ...efiArtifactForSinkTest(),
      artifactName: null,
    } as unknown as PeCoffEfiImageArtifact);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "artifact-name:type:null",
    );
    expect(writes).toEqual([]);
  });

  test("returns injected write failures without throwing", () => {
    const sink = createPeCoffEfiFileSink({
      writeBytes: () =>
        peCoffError({
          diagnostics: [
            peCoffWriterDiagnostic({
              code: "PE_COFF_FILE_SINK_FAILED",
              ownerKey: "fake-sink",
              stableDetail: "fake-write:failed",
            }),
          ],
          verification: FILE_SINK_TEST_VERIFICATION,
        }),
    });

    const result = sink.writeArtifact(efiArtifactForSinkTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "fake-write:failed",
    );
  });
});

function efiArtifactForSinkTest(
  input: Partial<PeCoffEfiImageArtifact> = {},
): PeCoffEfiImageArtifact {
  return Object.freeze({
    artifactName: "wrela.efi",
    mediaType: "application/vnd.microsoft.portable-executable",
    fileExtension: ".efi",
    bytes: Uint8Array.of(0x4d, 0x5a),
    deterministicMetadata: Object.freeze({
      schema: "wrela.pe-coff-efi-image",
      schemaVersion: 1,
      linkedLayoutFingerprint: "linked-layout",
      writerTargetFingerprint: "stable-hash:target",
      sectionTableFingerprint: "stable-hash:sections",
      dataDirectoryFingerprint: "stable-hash:directories",
      baseRelocationTableFingerprint: "stable-hash:relocations",
      headerFingerprint: "stable-hash:headers",
      imageFingerprint: "stable-hash:image",
    }),
    verification: FILE_SINK_TEST_VERIFICATION,
    ...input,
  });
}

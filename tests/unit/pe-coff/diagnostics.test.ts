import { describe, expect, test } from "bun:test";
import {
  PE_COFF_WRITER_DIAGNOSTIC_CODES,
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  peCoffWriterDiagnosticCode,
  peCoffWriterVerificationSummary,
  sortPeCoffWriterDiagnostics,
  type PeCoffEfiImageArtifact,
  type PeCoffEfiDeterministicMetadata,
} from "../../../src/pe-coff";

const passedVerification = peCoffWriterVerificationSummary({
  runs: [
    {
      verifierKey: "pe-coff-writer-test",
      runKey: "diagnostics",
      status: "passed",
    },
  ],
});

describe("PE/COFF writer diagnostics", () => {
  test("registers exactly the v1 writer diagnostic codes", () => {
    expect([...PE_COFF_WRITER_DIAGNOSTIC_CODES]).toEqual([
      "PE_COFF_TARGET_AUTH_FAILED",
      "PE_COFF_INPUT_INVALID",
      "PE_COFF_SECTION_PLANNING_FAILED",
      "PE_COFF_DATA_DIRECTORY_PLANNING_FAILED",
      "PE_COFF_RELOCATION_SERIALIZATION_FAILED",
      "PE_COFF_HEADER_PLANNING_FAILED",
      "PE_COFF_SERIALIZATION_FAILED",
      "PE_COFF_PARSE_FAILED",
      "PE_COFF_VERIFICATION_FAILED",
      "PE_COFF_FILE_SINK_FAILED",
    ]);

    expect(() => peCoffWriterDiagnosticCode("PE_COFF_NOT_REAL")).toThrow(
      "Unknown PE/COFF writer diagnostic code",
    );
  });

  test("normalizes provenance and sorts diagnostics deterministically", () => {
    const diagnostics = sortPeCoffWriterDiagnostics([
      peCoffWriterDiagnostic({
        code: "PE_COFF_INPUT_INVALID",
        ownerKey: "writer",
        rootCauseKey: "section",
        stableDetail: "section:b",
        provenance: ["z", "a"],
      }),
      peCoffWriterDiagnostic({
        code: "PE_COFF_INPUT_INVALID",
        ownerKey: "writer",
        rootCauseKey: "section",
        stableDetail: "section:a",
        provenance: ["b", "a"],
      }),
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "section:a",
      "section:b",
    ]);
    expect(diagnostics[0]?.provenance).toEqual(["a", "b"]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
    expect(Object.isFrozen(diagnostics[0]?.provenance)).toBe(true);
  });

  test("result helpers freeze records and sort diagnostics", () => {
    const result = peCoffOk({
      value: { artifactName: "test.efi" },
      diagnostics: [
        peCoffWriterDiagnostic({
          code: "PE_COFF_INPUT_INVALID",
          ownerKey: "owner:b",
          stableDetail: "b",
        }),
        peCoffWriterDiagnostic({
          code: "PE_COFF_INPUT_INVALID",
          ownerKey: "owner:a",
          stableDetail: "a",
        }),
      ],
      verification: passedVerification,
    });

    expect(result.kind).toBe("ok");
    expect(result.diagnostics.map((diagnostic) => diagnostic.ownerKey)).toEqual([
      "owner:a",
      "owner:b",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);

    const error = peCoffError({
      diagnostics: [
        peCoffWriterDiagnostic({
          code: "PE_COFF_SERIALIZATION_FAILED",
          ownerKey: "writer",
          stableDetail: "range",
        }),
      ],
      verification: passedVerification,
    });
    expect(error.kind).toBe("error");
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("exports deterministic metadata and artifact shapes", () => {
    const metadata: PeCoffEfiDeterministicMetadata = {
      schema: "wrela.pe-coff-efi-image",
      schemaVersion: 1,
      linkedLayoutFingerprint: "linked",
      writerTargetFingerprint: "target",
      sectionTableFingerprint: "sections",
      dataDirectoryFingerprint: "directories",
      baseRelocationTableFingerprint: "relocations",
      headerFingerprint: "headers",
      imageFingerprint: "image",
    };
    const artifact: PeCoffEfiImageArtifact = {
      artifactName: "test.efi",
      mediaType: "application/vnd.microsoft.portable-executable",
      fileExtension: ".efi",
      bytes: Object.freeze([0x4d, 0x5a]),
      deterministicMetadata: metadata,
      verification: passedVerification,
    };

    expect(artifact.deterministicMetadata.schema).toBe("wrela.pe-coff-efi-image");
    expect(artifact.deterministicMetadata.imageFingerprint).toBe("image");
    expect(artifact.mediaType).toBe("application/vnd.microsoft.portable-executable");
  });
});

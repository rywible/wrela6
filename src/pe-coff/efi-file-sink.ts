import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffEfiImageArtifact,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";

const EFI_FILE_EXTENSION = ".efi";

const FILE_SINK_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-efi-file-sink",
      runKey: "write-artifact",
      status: "passed" as const,
    }),
  ]),
});

export interface CreatePeCoffEfiFileSinkInput {
  readonly writeBytes: (
    artifactName: string,
    bytes: Uint8Array | readonly number[],
  ) => PeCoffWriterResult<void>;
}

export interface PeCoffEfiFileSink {
  readonly writeArtifact: (artifact: PeCoffEfiImageArtifact) => PeCoffWriterResult<void>;
}

export function createPeCoffEfiFileSink(input: CreatePeCoffEfiFileSinkInput): PeCoffEfiFileSink {
  return Object.freeze({
    writeArtifact: (artifact: PeCoffEfiImageArtifact) => {
      const artifactValue: unknown = artifact;
      if (
        artifactValue === null ||
        artifactValue === undefined ||
        typeof artifactValue !== "object"
      ) {
        return peCoffError({
          diagnostics: [fileSinkDiagnostic(`artifact:shape:${String(artifactValue)}`)],
          verification: FILE_SINK_VERIFICATION,
        });
      }

      const artifactRecord = artifactValue as Readonly<Record<string, unknown>>;
      const artifactName = artifactRecord.artifactName;
      if (typeof artifactName !== "string") {
        return peCoffError({
          diagnostics: [fileSinkDiagnostic(`artifact-name:type:${String(artifactName)}`)],
          verification: FILE_SINK_VERIFICATION,
        });
      }

      const diagnostics = validateArtifactName(artifactName);
      if (diagnostics.length > 0) {
        return peCoffError({ diagnostics, verification: FILE_SINK_VERIFICATION });
      }

      try {
        const writeResult = input.writeBytes(artifactName, Uint8Array.from(artifact.bytes));
        if (writeResult.kind === "error") return writeResult;
        return peCoffOk({
          value: undefined,
          diagnostics: writeResult.diagnostics,
          verification: FILE_SINK_VERIFICATION,
        });
      } catch {
        return peCoffError({
          diagnostics: [fileSinkDiagnostic(`write:exception:${artifactName}`)],
          verification: FILE_SINK_VERIFICATION,
        });
      }
    },
  });
}

function validateArtifactName(artifactName: string): readonly PeCoffWriterDiagnostic[] {
  if (artifactName.includes("/") || artifactName.includes("\\")) {
    return Object.freeze([fileSinkDiagnostic(`artifact-name:path-separator:${artifactName}`)]);
  }
  if (!artifactName.endsWith(EFI_FILE_EXTENSION)) {
    return Object.freeze([fileSinkDiagnostic(`artifact-name:extension:${artifactName}`)]);
  }
  if (artifactName.length === EFI_FILE_EXTENSION.length) {
    return Object.freeze([fileSinkDiagnostic(`artifact-name:empty-stem:${artifactName}`)]);
  }
  return Object.freeze([]);
}

function fileSinkDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_FILE_SINK_FAILED",
    ownerKey: "pe-coff-efi-file-sink",
    stableDetail,
  });
}

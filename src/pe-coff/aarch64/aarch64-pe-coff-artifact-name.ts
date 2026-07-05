import { peCoffWriterDiagnostic, type PeCoffWriterDiagnostic } from "../diagnostics";

export const PE_COFF_EFI_FILE_EXTENSION = ".efi";

export function validatePeCoffEfiArtifactName(
  artifactName: string,
): readonly PeCoffWriterDiagnostic[] {
  if (typeof artifactName !== "string") {
    return Object.freeze([artifactNameDiagnostic(`artifact-name:type:${String(artifactName)}`)]);
  }
  if (artifactName.includes("/") || artifactName.includes("\\")) {
    return Object.freeze([artifactNameDiagnostic(`artifact-name:path-separator:${artifactName}`)]);
  }
  if (!artifactName.endsWith(PE_COFF_EFI_FILE_EXTENSION)) {
    return Object.freeze([artifactNameDiagnostic(`artifact-name:extension:${artifactName}`)]);
  }
  if (artifactName.length === PE_COFF_EFI_FILE_EXTENSION.length) {
    return Object.freeze([artifactNameDiagnostic(`artifact-name:empty-stem:${artifactName}`)]);
  }
  return Object.freeze([]);
}

function artifactNameDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_INPUT_INVALID",
    ownerKey: "aarch64-pe-coff-efi-writer",
    stableDetail,
  });
}

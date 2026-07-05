import type { AArch64LinkedImageLayout } from "../../linker";
import { stableHash, stableJson } from "../../shared/stable-json";
import {
  authenticateAArch64PeCoffEfiWriterTargetSurface,
  type AArch64PeCoffEfiWriterTargetSurface,
  type AArch64PeCoffEfiWriterTargetSurfaceInput,
} from "./aarch64-pe-coff-target";
import {
  PE_COFF_EFI_FILE_EXTENSION,
  validatePeCoffEfiArtifactName,
} from "./aarch64-pe-coff-artifact-name";
import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffEfiDeterministicMetadata,
  type PeCoffEfiImageArtifact,
  type PeCoffWriterResult,
  type PeCoffWriterVerifierRun,
  type PeCoffWriterVerificationSummary,
} from "../diagnostics";
import { PE_SIGNATURE_BYTES } from "../headers";
import { createPeByteWriter, type PeByteWriter } from "../pe-byte-writer";
import { finalizePeImageChecksum } from "../pe-image-checksum-finalization";
import {
  planPeCoffSections,
  planPeDataDirectories,
  planPeHeaders,
  validateLinkedImageForPeCoffWriter,
  type PlannedPeCoffSection,
  type PlannedPeHeaders,
} from "../pe-file-layout";
import { parsePeCoffImage } from "../pe-parser";
import { serializePeBaseRelocations } from "../pe-relocations";
import { verifyParsedPeCoffImage } from "../pe-verifier";

const IMAGE_SERIALIZATION_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-pe-coff-efi-writer",
      runKey: "serialize-planned-image",
      status: "passed" as const,
    }),
  ]),
});

export interface PlannedPeCoffImage {
  readonly headers: PlannedPeHeaders;
  readonly sections: readonly PlannedPeCoffSection[];
}

export interface SerializedPlannedPeCoffImage {
  readonly bytes: Uint8Array;
  readonly headers: PlannedPeHeaders;
  readonly checksum: number;
}

type WriteOperation = () => PeCoffWriterResult<number>;

const DEFAULT_EFI_ARTIFACT_NAME = "wrela.efi";
const PE_COFF_EFI_MEDIA_TYPE = "application/vnd.microsoft.portable-executable";

const ORCHESTRATION_STAGES = [
  "target",
  "input-layout",
  "base-relocations",
  "sections",
  "headers",
  "serialize",
  "parse",
  "verify",
] as const;

type PeCoffWriterOrchestrationStage = (typeof ORCHESTRATION_STAGES)[number];

export interface WriteAArch64PeCoffEfiImageInput {
  readonly layout: AArch64LinkedImageLayout;
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly artifactName?: string;
}

export type WriteAArch64PeCoffEfiImageResult =
  | {
      readonly kind: "ok";
      readonly artifact: PeCoffEfiImageArtifact;
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    };

export function writeAArch64PeCoffEfiImage(
  input: WriteAArch64PeCoffEfiImageInput,
): WriteAArch64PeCoffEfiImageResult {
  const artifactName = input.artifactName ?? DEFAULT_EFI_ARTIFACT_NAME;
  const authenticatedTarget = authenticateWriterTarget(input.target);
  const artifactNameDiagnostics = validatePeCoffEfiArtifactName(artifactName);
  if (authenticatedTarget.kind === "error" || artifactNameDiagnostics.length > 0) {
    const targetDiagnostics =
      authenticatedTarget.kind === "error"
        ? [...artifactNameDiagnostics, ...authenticatedTarget.diagnostics]
        : artifactNameDiagnostics;
    return orchestrationError("target", targetDiagnostics);
  }
  const target = authenticatedTarget.target;

  const inputLayout = validateLinkedImageForPeCoffWriter({
    target,
    layout: input.layout,
  });
  if (inputLayout.kind === "error") {
    return orchestrationError("input-layout", inputLayout.diagnostics);
  }

  const baseRelocations = serializePeBaseRelocations({
    target,
    relocations: input.layout.baseRelocations,
  });
  if (baseRelocations.kind === "error") {
    return orchestrationError("base-relocations", baseRelocations.diagnostics);
  }

  const plannedSections = planPeCoffSections({
    target,
    layout: input.layout,
    baseRelocationTableBytes: baseRelocations.value.bytes,
  });
  if (plannedSections.kind === "error") {
    return orchestrationError("sections", plannedSections.diagnostics);
  }

  const dataDirectories = planPeDataDirectories({
    target,
    layout: input.layout,
    sections: plannedSections.value.sections,
    baseRelocationTableSizeBytes: baseRelocations.value.bytes.length,
  });
  if (dataDirectories.kind === "error") {
    return orchestrationError("headers", dataDirectories.diagnostics);
  }

  const headers = planPeHeaders({
    target,
    layout: input.layout,
    sections: plannedSections.value.sections,
    dataDirectories: dataDirectories.value.directories,
  });
  if (headers.kind === "error") {
    return orchestrationError("headers", headers.diagnostics);
  }

  const plannedImage: PlannedPeCoffImage = Object.freeze({
    headers: headers.value,
    sections: plannedSections.value.sections,
  });
  const serialized = serializePlannedPeCoffImage(plannedImage);
  if (serialized.kind === "error") {
    return orchestrationError("serialize", serialized.diagnostics);
  }

  const parsed = parsePeCoffImage(serialized.value.bytes);
  if (parsed.kind === "error") {
    return orchestrationError("parse", parsed.diagnostics);
  }

  const plannedImageWithChecksum: PlannedPeCoffImage = Object.freeze({
    headers: serialized.value.headers,
    sections: plannedImage.sections,
  });
  const verified = verifyParsedPeCoffImage({
    planned: plannedImageWithChecksum,
    parsed: parsed.value,
  });
  if (verified.kind === "error") {
    return orchestrationError("verify", verified.diagnostics);
  }

  const verification = orchestrationVerification();
  const bytes = Uint8Array.from(serialized.value.bytes);
  const artifact = Object.freeze({
    artifactName,
    mediaType: PE_COFF_EFI_MEDIA_TYPE,
    fileExtension: PE_COFF_EFI_FILE_EXTENSION,
    bytes,
    deterministicMetadata: deterministicMetadata({
      layout: input.layout,
      target,
      baseRelocations: baseRelocations.value,
      sections: plannedSections.value.sections,
      dataDirectories: dataDirectories.value.directories,
      headers: serialized.value.headers,
      bytes,
    }),
    verification,
  });

  return Object.freeze({
    kind: "ok" as const,
    artifact,
    diagnostics: Object.freeze([]),
    verification,
  });
}

export function serializePlannedPeCoffImage(
  image: PlannedPeCoffImage,
): PeCoffWriterResult<SerializedPlannedPeCoffImage> {
  const writer = createPeByteWriter();
  const diagnostics: PeCoffWriterDiagnostic[] = [];

  writeDosHeader(writer, diagnostics, image);
  writePeSignature(writer, diagnostics, image.headers);
  writeCoffHeader(writer, diagnostics, image.headers);
  writeOptionalHeader(writer, diagnostics, image.headers);
  writeSectionTable(writer, diagnostics, image.sections);
  writeSectionBodies(writer, diagnostics, image.sections);

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: IMAGE_SERIALIZATION_VERIFICATION,
    });
  }

  const finalized = finalizePeImageChecksum({ writer, headers: image.headers });
  if (finalized.kind === "error") {
    return peCoffError({
      diagnostics: finalized.diagnostics,
      verification: IMAGE_SERIALIZATION_VERIFICATION,
    });
  }

  return peCoffOk({
    value: finalized.value,
    verification: IMAGE_SERIALIZATION_VERIFICATION,
  });
}

type AuthenticatedWriterTargetResult =
  | {
      readonly kind: "ok";
      readonly target: AArch64PeCoffEfiWriterTargetSurface;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
    };

const AUTHENTICATED_TARGET_SURFACE_FIELDS = [
  "targetKey",
  "linkedTargetPolicyFingerprint",
  "machine",
  "optionalHeaderMagic",
  "subsystem",
  "imageBase",
  "sectionAlignmentBytes",
  "fileAlignmentBytes",
  "firstSectionRva",
  "maxImageSizeBytes",
  "numberOfRvaAndSizes",
  "peHeaderOffsetBytes",
  "coffTimestamp",
  "majorLinkerVersion",
  "minorLinkerVersion",
  "majorOperatingSystemVersion",
  "minorOperatingSystemVersion",
  "majorImageVersion",
  "minorImageVersion",
  "majorSubsystemVersion",
  "minorSubsystemVersion",
  "sizeOfStackReserveBytes",
  "sizeOfStackCommitBytes",
  "sizeOfHeapReserveBytes",
  "sizeOfHeapCommitBytes",
  "dllCharacteristics",
  "serializedSectionNames",
  "targetPolicyFingerprint",
] as const satisfies readonly (keyof AArch64PeCoffEfiWriterTargetSurface)[];

function authenticateWriterTarget(target: unknown): AuthenticatedWriterTargetResult {
  if (target === null || target === undefined || typeof target !== "object") {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([targetDiagnostic(`target:shape:${String(target)}`)]),
    });
  }

  const record = target as Readonly<Record<string, unknown>>;
  const surfaceDiagnostics = validateAuthenticatedTargetSurface(record);
  if (surfaceDiagnostics.length > 0) {
    return Object.freeze({ kind: "error" as const, diagnostics: surfaceDiagnostics });
  }

  const candidate = target as Partial<AArch64PeCoffEfiWriterTargetSurface>;
  const authentication = authenticateAArch64PeCoffEfiWriterTargetSurface({
    linkedTargetPolicyFingerprint: candidate.linkedTargetPolicyFingerprint as string,
    targetKey: candidate.targetKey,
    machine: candidate.machine,
    optionalHeaderMagic: candidate.optionalHeaderMagic,
    subsystem: candidate.subsystem,
    imageBase: candidate.imageBase,
    sectionAlignmentBytes: candidate.sectionAlignmentBytes,
    fileAlignmentBytes: candidate.fileAlignmentBytes,
    firstSectionRva: candidate.firstSectionRva,
    maxImageSizeBytes: candidate.maxImageSizeBytes,
    numberOfRvaAndSizes: candidate.numberOfRvaAndSizes,
    peHeaderOffsetBytes: candidate.peHeaderOffsetBytes,
    coffTimestamp: candidate.coffTimestamp,
    majorLinkerVersion: candidate.majorLinkerVersion,
    minorLinkerVersion: candidate.minorLinkerVersion,
    majorOperatingSystemVersion: candidate.majorOperatingSystemVersion,
    minorOperatingSystemVersion: candidate.minorOperatingSystemVersion,
    majorImageVersion: candidate.majorImageVersion,
    minorImageVersion: candidate.minorImageVersion,
    majorSubsystemVersion: candidate.majorSubsystemVersion,
    minorSubsystemVersion: candidate.minorSubsystemVersion,
    sizeOfStackReserveBytes: candidate.sizeOfStackReserveBytes,
    sizeOfStackCommitBytes: candidate.sizeOfStackCommitBytes,
    sizeOfHeapReserveBytes: candidate.sizeOfHeapReserveBytes,
    sizeOfHeapCommitBytes: candidate.sizeOfHeapCommitBytes,
    dllCharacteristics: candidate.dllCharacteristics,
    serializedSectionNames: candidate.serializedSectionNames,
  } satisfies AArch64PeCoffEfiWriterTargetSurfaceInput);
  if (authentication.kind === "error") {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: authentication.diagnostics,
    });
  }

  const diagnostics: PeCoffWriterDiagnostic[] = [];
  if (candidate.targetPolicyFingerprint !== authentication.value.targetPolicyFingerprint) {
    diagnostics.push(
      targetDiagnostic(
        `target:fingerprint:${String(candidate.targetPolicyFingerprint)}:expected:${authentication.value.targetPolicyFingerprint}`,
      ),
    );
  }
  if (diagnostics.length > 0) {
    return Object.freeze({ kind: "error" as const, diagnostics: Object.freeze(diagnostics) });
  }
  return Object.freeze({ kind: "ok" as const, target: authentication.value });
}

function validateAuthenticatedTargetSurface(
  target: Readonly<Record<string, unknown>>,
): readonly PeCoffWriterDiagnostic[] {
  const diagnostics: PeCoffWriterDiagnostic[] = [];
  for (const field of AUTHENTICATED_TARGET_SURFACE_FIELDS) {
    if (!Object.hasOwn(target, field) || target[field] === undefined || target[field] === null) {
      diagnostics.push(targetDiagnostic(`target:surface:missing:${field}`));
    }
  }
  return Object.freeze(diagnostics);
}

function orchestrationError(
  stage: PeCoffWriterOrchestrationStage,
  diagnostics: readonly PeCoffWriterDiagnostic[],
): WriteAArch64PeCoffEfiImageResult {
  return peCoffError({
    diagnostics,
    verification: orchestrationVerification(stage),
  });
}

function orchestrationVerification(
  failedStage?: PeCoffWriterOrchestrationStage,
): PeCoffWriterVerificationSummary {
  const runs: PeCoffWriterVerifierRun[] = [];
  for (const stage of ORCHESTRATION_STAGES) {
    if (failedStage === undefined) {
      runs.push(orchestrationRun(stage, "passed"));
      continue;
    }
    runs.push(orchestrationRun(stage, stage === failedStage ? "failed" : "passed"));
    if (stage === failedStage) break;
  }
  return Object.freeze({ runs: Object.freeze(runs) });
}

function orchestrationRun(
  stage: PeCoffWriterOrchestrationStage,
  status: PeCoffWriterVerifierRun["status"],
): PeCoffWriterVerifierRun {
  return Object.freeze({
    verifierKey: "aarch64-pe-coff-efi-writer",
    runKey: stage,
    status,
  });
}

function targetDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_TARGET_AUTH_FAILED",
    ownerKey: "aarch64-pe-coff-efi-writer",
    stableDetail,
  });
}

interface DeterministicMetadataInput {
  readonly layout: AArch64LinkedImageLayout;
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly baseRelocations: unknown;
  readonly sections: readonly PlannedPeCoffSection[];
  readonly dataDirectories: unknown;
  readonly headers: PlannedPeHeaders;
  readonly bytes: Uint8Array;
}

function deterministicMetadata(input: DeterministicMetadataInput): PeCoffEfiDeterministicMetadata {
  const linkedLayoutFingerprint = input.layout.deterministicMetadata.layoutFingerprint;
  const writerTargetFingerprint = input.target.targetPolicyFingerprint;
  const sectionTableFingerprint = stableFingerprint(input.sections);
  const dataDirectoryFingerprint = stableFingerprint(input.dataDirectories);
  const baseRelocationTableFingerprint = stableFingerprint(input.baseRelocations);
  const headerFingerprint = stableFingerprint(input.headers);
  return Object.freeze({
    schema: "wrela.pe-coff-efi-image",
    schemaVersion: 1,
    linkedLayoutFingerprint,
    writerTargetFingerprint,
    sectionTableFingerprint,
    dataDirectoryFingerprint,
    baseRelocationTableFingerprint,
    headerFingerprint,
    imageFingerprint: stableFingerprint({
      linkedLayoutFingerprint,
      writerTargetFingerprint,
      sectionTableFingerprint,
      dataDirectoryFingerprint,
      baseRelocationTableFingerprint,
      headerFingerprint,
      bytes: input.bytes,
    }),
  });
}

function stableFingerprint(value: unknown): string {
  return `stable-hash:${stableHash(stableJson(value))}`;
}

function collectWriteDiagnostics(
  diagnostics: PeCoffWriterDiagnostic[],
  operation: WriteOperation,
): void {
  const result = operation();
  if (result.kind === "error") diagnostics.push(...result.diagnostics);
}

function writeZeroesUntil(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  offset: number,
): void {
  collectWriteDiagnostics(diagnostics, () => writer.writeZeroes(offset - writer.offset()));
}

function writeDosHeader(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  image: PlannedPeCoffImage,
): void {
  collectWriteDiagnostics(diagnostics, () => writer.writeU8(0x4d));
  collectWriteDiagnostics(diagnostics, () => writer.writeU8(0x5a));
  writeZeroesUntil(writer, diagnostics, 0x3c);
  collectWriteDiagnostics(diagnostics, () =>
    writer.writeU32Le(image.headers.dosHeader.peHeaderOffsetBytes),
  );
  writeZeroesUntil(writer, diagnostics, image.headers.dosHeader.peHeaderOffsetBytes);
}

function writePeSignature(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  headers: PlannedPeHeaders,
): void {
  writeZeroesUntil(writer, diagnostics, headers.dosHeader.peHeaderOffsetBytes);
  collectWriteDiagnostics(diagnostics, () => writer.writeBytes(PE_SIGNATURE_BYTES));
}

function writeCoffHeader(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  headers: PlannedPeHeaders,
): void {
  const header = headers.coffHeader;
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.machine));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.numberOfSections));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.timeDateStamp));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.pointerToSymbolTable));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.numberOfSymbols));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.sizeOfOptionalHeader));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.characteristics));
}

function writeOptionalHeader(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  headers: PlannedPeHeaders,
): void {
  const header = headers.optionalHeader;
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.magic));
  collectWriteDiagnostics(diagnostics, () => writer.writeU8(header.majorLinkerVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU8(header.minorLinkerVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.sizeOfCodeBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.sizeOfInitializedDataBytes));
  collectWriteDiagnostics(diagnostics, () =>
    writer.writeU32Le(header.sizeOfUninitializedDataBytes),
  );
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.addressOfEntryPoint));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.baseOfCode));
  collectWriteDiagnostics(diagnostics, () => writer.writeU64Le(header.imageBase));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.sectionAlignmentBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.fileAlignmentBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.majorOperatingSystemVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.minorOperatingSystemVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.majorImageVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.minorImageVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.majorSubsystemVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.minorSubsystemVersion));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.win32VersionValue));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.sizeOfImageBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.sizeOfHeadersBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.checksum));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.subsystem));
  collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(header.dllCharacteristics));
  collectWriteDiagnostics(diagnostics, () => writer.writeU64Le(header.sizeOfStackReserveBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU64Le(header.sizeOfStackCommitBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU64Le(header.sizeOfHeapReserveBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU64Le(header.sizeOfHeapCommitBytes));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.loaderFlags));
  collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(header.numberOfRvaAndSizes));

  for (const directory of header.dataDirectories) {
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(directory.rva));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(directory.sizeBytes));
  }
}

function writeSectionTable(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  sections: readonly PlannedPeCoffSection[],
): void {
  for (const section of sections) {
    const nameBytes = sectionNameBytes(section);
    if (nameBytes.kind === "error") {
      diagnostics.push(...nameBytes.diagnostics);
    } else {
      collectWriteDiagnostics(diagnostics, () => writer.writeBytes(nameBytes.value));
    }
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(section.virtualSizeBytes));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(section.rva));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(section.rawDataSizeBytes));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(section.rawDataPointerBytes));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(0));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(0));
    collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(0));
    collectWriteDiagnostics(diagnostics, () => writer.writeU16Le(0));
    collectWriteDiagnostics(diagnostics, () => writer.writeU32Le(section.characteristics));
  }
}

function writeSectionBodies(
  writer: PeByteWriter,
  diagnostics: PeCoffWriterDiagnostic[],
  sections: readonly PlannedPeCoffSection[],
): void {
  for (const section of sections) {
    writeZeroesUntil(writer, diagnostics, section.rawDataPointerBytes);
    collectWriteDiagnostics(diagnostics, () => writer.writeBytes(section.bytes));
    writeZeroesUntil(writer, diagnostics, section.rawDataPointerBytes + section.rawDataSizeBytes);
  }
}

function serializationDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_SERIALIZATION_FAILED",
    ownerKey: "aarch64-pe-coff-efi-writer",
    stableDetail,
  });
}

function sectionNameBytes(section: PlannedPeCoffSection): PeCoffWriterResult<readonly number[]> {
  const nameBytes = [...section.serializedName].map((character) => character.charCodeAt(0));
  if (nameBytes.length > 8) {
    return peCoffError({
      diagnostics: [
        serializationDiagnostic(
          `section-name:too-long:${section.sectionKey}:${section.serializedName}`,
        ),
      ],
      verification: IMAGE_SERIALIZATION_VERIFICATION,
    });
  }
  return peCoffOk({
    value: Object.freeze([...nameBytes, ...Array.from({ length: 8 - nameBytes.length }, () => 0)]),
    verification: IMAGE_SERIALIZATION_VERIFICATION,
  });
}

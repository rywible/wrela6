import type { PeCoffEfiImageArtifact } from "../../pe-coff";
import type { UefiAArch64TargetResult } from "./result";

export interface UefiAArch64SmokePolicy {
  readonly kind: "disabled" | "qemu";
  readonly allowSkip?: boolean;
}

export interface UefiAArch64SmokeReport {
  readonly status: "disabled" | "skipped" | "passed" | "failed";
  readonly stableDetail: string;
  readonly observedMarkers: readonly string[];
  readonly targetDriverFingerprint?: string;
}

export interface UefiAArch64TargetMetadata {
  readonly schema: "wrela.uefi-aarch64-image";
  readonly schemaVersion: 1;
  readonly targetDriverFingerprint: string;
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly entryThunkFingerprint: string;
  readonly firmwareAbiFingerprint: string;
  readonly statusPolicyFingerprint: string;
  readonly watchdogPolicyFingerprint: string;
  readonly peCoffImageFingerprint: string;
  readonly finalImageFingerprint: string;
}

export interface UefiAArch64ImageArtifact {
  readonly artifactName: string;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly targetMetadata: UefiAArch64TargetMetadata;
  readonly smoke?: UefiAArch64SmokeReport;
}

export interface UefiAArch64ArtifactSink {
  readonly writeArtifact: (
    artifact: UefiAArch64ImageArtifact,
  ) => UefiAArch64TargetResult<{ readonly writtenPath?: string }>;
}

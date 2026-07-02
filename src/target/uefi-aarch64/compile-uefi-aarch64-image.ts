import { stableHash } from "../../shared/stable-json";
import type { UefiAArch64ImageArtifact, UefiAArch64ArtifactSink } from "./artifact";
import type { UefiAArch64TargetDiagnostic } from "./diagnostics";
import { sortUefiAArch64TargetDiagnostics, uefiAArch64TargetDiagnostic } from "./diagnostics";
import { fingerprintUefiAArch64FirmwareAbi } from "./firmware-abi";
import type { CompilerPackageInput } from "./package-input";
import {
  productionPackagePipelineDependencies,
  runUefiAArch64PackagePipelineToOptIr,
  type UefiAArch64StageRecord,
  type UefiAArch64PackagePipelineDependencies,
} from "./package-pipeline";
import { runUefiAArch64BinarySpine, type UefiAArch64BinarySpineOutput } from "./binary-spine";
import type { UefiAArch64TargetVerificationSummary, UefiAArch64TargetVerifierRun } from "./result";
import {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
  type UefiAArch64TargetDriverSurface,
  type UefiAArch64TargetDriverSurfaceInput,
} from "./target-driver-surface";
import { fingerprintUefiAArch64StatusPolicy } from "./status-conversion";
import { fingerprintUefiAArch64WatchdogPolicy } from "./watchdog-policy";
import type { UefiAArch64SmokeRequest } from "./qemu-smoke";

export interface CompileUefiAArch64ImageInput {
  readonly packageInput: CompilerPackageInput;
  readonly target?: UefiAArch64TargetDriverSurfaceInput;
  readonly artifactName?: string;
  readonly output?: UefiAArch64ArtifactSink;
  readonly smoke?: UefiAArch64SmokeRequest;
  readonly packagePipelineDependencies?: UefiAArch64PackagePipelineDependencies;
}

export type CompileUefiAArch64ImageResult =
  | {
      readonly kind: "ok";
      readonly artifact: UefiAArch64ImageArtifact;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    };

export function compileUefiAArch64Image(
  input: CompileUefiAArch64ImageInput,
): CompileUefiAArch64ImageResult {
  const recorder = createCompileVerificationRecorder();
  const target = authenticateUefiAArch64TargetDriverSurface(
    input.target ?? canonicalUefiAArch64TargetDriverSurfaceInput(),
  );
  if (target.kind === "error") {
    recorder.failed("target-driver-authenticate");
    return compileError(target.diagnostics, recorder.summary());
  }
  recorder.passed("target-driver-authenticate");

  const packagePipeline = runUefiAArch64PackagePipelineToOptIr(
    {
      packageInput: input.packageInput,
      target: target.value,
    },
    input.packagePipelineDependencies ?? productionPackagePipelineDependencies(),
  );
  if (packagePipeline.kind === "error") {
    recorder.recordNestedFailure(packagePipeline.verification, "package-pipeline");
    return compileError(packagePipeline.diagnostics, recorder.summary());
  }
  recorder.recordStages(packagePipeline.value.stages);

  const binarySpine = runUefiAArch64BinarySpine({
    target: target.value,
    optIr: packagePipeline.value,
    artifactName: input.artifactName,
  });
  if (binarySpine.kind === "error") {
    recorder.recordNestedFailure(binarySpine.verification, "binary-spine");
    return compileError(binarySpine.diagnostics, recorder.summary());
  }
  recorder.recordStages(binarySpine.value.stages);

  const artifact = createUefiAArch64ImageArtifact({
    target: target.value,
    binarySpine: binarySpine.value,
    smoke: input.smoke,
  });

  if (input.output !== undefined) {
    const sinkResult = writeUefiAArch64ArtifactSink(input.output, artifact);
    if (sinkResult.kind === "error") {
      recorder.failed("artifact-sink");
      return compileError(sinkResult.diagnostics, recorder.summary());
    }
    recorder.passed("artifact-sink");
  }

  return Object.freeze({
    kind: "ok" as const,
    artifact,
    diagnostics: Object.freeze([]),
    verification: recorder.summary(),
  });
}

export function createUefiAArch64TargetMetadata(input: {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly entryThunkFingerprint: string;
  readonly peCoffArtifact: UefiAArch64BinarySpineOutput["peCoffArtifact"];
}) {
  return Object.freeze({
    schema: "wrela.uefi-aarch64-image" as const,
    schemaVersion: 1 as const,
    targetDriverFingerprint: input.target.targetDriverFingerprint,
    aarch64TargetFingerprint: input.target.aarch64TargetFingerprint,
    backendTargetFingerprint: input.target.backendTargetFingerprint,
    linkerTargetFingerprint: input.target.linkerTargetFingerprint,
    peCoffWriterTargetFingerprint: input.target.peCoffWriterTargetFingerprint,
    semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
    proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
    entryThunkFingerprint: input.entryThunkFingerprint,
    firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(input.target.firmwareAbi),
    statusPolicyFingerprint: fingerprintUefiAArch64StatusPolicy(input.target.statusPolicy),
    watchdogPolicyFingerprint: fingerprintUefiAArch64WatchdogPolicy(input.target.watchdogPolicy),
    peCoffImageFingerprint: input.peCoffArtifact.deterministicMetadata.imageFingerprint,
    finalImageFingerprint: fingerprintUefiAArch64ImageBytes(input.peCoffArtifact.bytes),
  });
}

export function fingerprintUefiAArch64ImageBytes(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `uefi-aarch64-image-bytes:${stableHash(hex)}`;
}

function createUefiAArch64ImageArtifact(input: {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly binarySpine: UefiAArch64BinarySpineOutput;
  readonly smoke?: UefiAArch64SmokeRequest;
}): UefiAArch64ImageArtifact {
  const targetMetadata = createUefiAArch64TargetMetadata({
    target: input.target,
    entryThunkFingerprint: input.binarySpine.entryThunkFingerprint,
    peCoffArtifact: input.binarySpine.peCoffArtifact,
  });
  return Object.freeze({
    artifactName: input.binarySpine.peCoffArtifact.artifactName,
    peCoffArtifact: input.binarySpine.peCoffArtifact,
    targetMetadata,
    smoke: smokeReportForCompileRequest(input.smoke, targetMetadata.targetDriverFingerprint),
  });
}

function smokeReportForCompileRequest(
  request: UefiAArch64SmokeRequest | undefined,
  targetDriverFingerprint: string,
) {
  if (request === undefined || request.kind === "disabled") {
    return Object.freeze({
      status: "disabled" as const,
      stableDetail: "qemu-smoke:disabled",
      observedMarkers: Object.freeze([]),
      targetDriverFingerprint,
    });
  }
  return Object.freeze({
    status: "skipped" as const,
    stableDetail: "qemu-smoke:separate-runner-required",
    observedMarkers: Object.freeze([]),
    targetDriverFingerprint,
  });
}

function writeUefiAArch64ArtifactSink(
  sink: UefiAArch64ArtifactSink,
  artifact: UefiAArch64ImageArtifact,
) {
  try {
    const result = sink.writeArtifact(artifact);
    if (result.kind === "ok") return result;
    return {
      kind: "error" as const,
      diagnostics: artifactSinkDiagnostics(result.diagnostics),
    };
  } catch {
    return {
      kind: "error" as const,
      diagnostics: Object.freeze([
        uefiAArch64TargetDiagnostic({
          code: "UEFI_AARCH64_ARTIFACT_SINK_FAILED",
          ownerKey: "artifact-sink",
          stableDetail: "artifact-sink:exception",
        }),
      ]),
    };
  }
}

function artifactSinkDiagnostics(
  diagnostics: readonly UefiAArch64TargetDiagnostic[],
): readonly UefiAArch64TargetDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_ARTIFACT_SINK_FAILED",
        ownerKey: "artifact-sink",
        stableDetail: diagnostic.stableDetail,
      }),
    ),
  );
}

function compileError(
  diagnostics: readonly UefiAArch64TargetDiagnostic[],
  verification: UefiAArch64TargetVerificationSummary,
): CompileUefiAArch64ImageResult {
  return Object.freeze({
    kind: "error" as const,
    diagnostics: sortUefiAArch64TargetDiagnostics(diagnostics),
    verification,
  });
}

function createCompileVerificationRecorder() {
  const runs: UefiAArch64TargetVerifierRun[] = [];
  return {
    passed(runKey: string): void {
      runs.push(compileRun(runKey, "passed"));
    },
    failed(runKey: string): void {
      runs.push(compileRun(runKey, "failed"));
    },
    recordStages(stages: readonly UefiAArch64StageRecord<string>[]): void {
      for (const stage of stages) {
        runs.push(compileRun(stage.stageKey, stage.status));
      }
    },
    recordNestedFailure(
      verification: UefiAArch64TargetVerificationSummary,
      fallbackRunKey: string,
    ): void {
      if (verification.runs.length === 0) {
        runs.push(compileRun(fallbackRunKey, "failed"));
        return;
      }
      for (const run of verification.runs) {
        runs.push(compileRun(run.runKey, run.status));
      }
    },
    summary(): UefiAArch64TargetVerificationSummary {
      return Object.freeze({ runs: Object.freeze([...runs]) });
    },
  };
}

function compileRun(
  runKey: string,
  status: UefiAArch64TargetVerifierRun["status"],
): UefiAArch64TargetVerifierRun {
  return Object.freeze({
    verifierKey: "uefi-aarch64-compile",
    runKey,
    status,
  });
}

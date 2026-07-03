import {
  runUefiAArch64QemuSmoke,
  runUefiAArch64QemuSmokeImage,
  type UefiAArch64ImageArtifact,
  type UefiAArch64QemuHostEffects,
  type UefiAArch64QemuSmokeConfig,
  type UefiAArch64QemuSmokeRequest,
  type UefiAArch64SmokeReport,
} from "../../target/uefi-aarch64";

export type FullImageValidationQemuLaunchMode = "uefi-shell-startup" | "default-boot-path";

export type AArch64UefiFirmwarePathClassification =
  | { readonly kind: "accepted"; readonly stableDetail: string }
  | { readonly kind: "rejected"; readonly stableDetail: string }
  | { readonly kind: "unrecognized"; readonly stableDetail: string };

export interface RunFullImageValidationQemuSmokeImageInput {
  readonly artifactName: string;
  readonly artifactBytes: readonly number[];
  readonly targetDriverFingerprint?: string;
  readonly request: UefiAArch64QemuSmokeRequest;
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
  readonly runQemuSmokeImage?: typeof runUefiAArch64QemuSmokeImage;
}

export interface RunFullImageValidationQemuSmokeArtifactInput {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly request: UefiAArch64QemuSmokeRequest;
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
  readonly runQemuSmoke?: typeof runUefiAArch64QemuSmoke;
}

export type RunFullImageValidationQemuSmokeInput =
  | RunFullImageValidationQemuSmokeImageInput
  | RunFullImageValidationQemuSmokeArtifactInput;

const FULL_IMAGE_SHELL_SUCCESS_MARKER = "WRELA_FULL_IMAGE_SMOKE_OK";
const FULL_IMAGE_SHELL_FAILURE_MARKER = "WRELA_FULL_IMAGE_SMOKE_FAIL";

export function fullImageQemuSmokeRequestForCase(input: {
  readonly caseKey: string;
  readonly launchMode?: FullImageValidationQemuLaunchMode;
  readonly expectedConsoleMarkers: readonly string[];
}): UefiAArch64QemuSmokeRequest {
  const launchMode = input.launchMode ?? "uefi-shell-startup";
  return Object.freeze({
    kind: "qemu",
    allowSkip: true,
    expectedConsoleMarkers: Object.freeze([...input.expectedConsoleMarkers]),
    ...(launchMode === "uefi-shell-startup"
      ? {
          uefiShellSuccessMarker: Object.freeze({
            marker: FULL_IMAGE_SHELL_SUCCESS_MARKER,
            failureMarker: FULL_IMAGE_SHELL_FAILURE_MARKER,
          }),
        }
      : {}),
    termination: "kill-after-marker",
  });
}

export function classifyAArch64UefiFirmwarePath(
  firmwareCodePath: string,
): AArch64UefiFirmwarePathClassification {
  const basename = pathBasename(firmwareCodePath);
  const normalizedBasename = basename.toUpperCase();
  const hasAArch64Token = ["AAVMF", "QEMU_EFI", "AA64", "AARCH64"].some((token) =>
    normalizedBasename.includes(token),
  );
  const hasX86Token = ["OVMF", "X64", "IA32"].some((token) => normalizedBasename.includes(token));

  if (hasAArch64Token) {
    return Object.freeze({
      kind: "accepted",
      stableDetail: `qemu-smoke:firmware-arch-aarch64:${basename}`,
    });
  }
  if (hasX86Token) {
    return Object.freeze({
      kind: "rejected",
      stableDetail: `qemu-smoke:firmware-arch-likely-x86:${basename}`,
    });
  }
  return Object.freeze({
    kind: "unrecognized",
    stableDetail: `qemu-smoke:firmware-arch-unrecognized:${basename}`,
  });
}

export async function runFullImageValidationQemuSmoke(
  input: RunFullImageValidationQemuSmokeInput,
): Promise<UefiAArch64SmokeReport> {
  const requestDiagnostic = invalidRequestDiagnostic(input.request);
  if (requestDiagnostic !== undefined) {
    return smokeReport("failed", requestDiagnostic);
  }

  const configDiagnostic = missingConfigDiagnostic(input.config);
  if (configDiagnostic !== undefined) {
    return smokeReport(input.request.allowSkip === true ? "skipped" : "failed", configDiagnostic);
  }

  const firmwareClassification = classifyAArch64UefiFirmwarePath(input.config.firmwareCodePath);
  if (firmwareClassification.kind === "rejected") {
    return smokeReport("failed", firmwareClassification.stableDetail);
  }

  const attachFirmwareClassification = (report: UefiAArch64SmokeReport) =>
    attachUnrecognizedFirmwareDiagnostic(report, firmwareClassification);

  if ("artifact" in input) {
    return attachFirmwareClassification(
      await (input.runQemuSmoke ?? runUefiAArch64QemuSmoke)({
        artifact: input.artifact,
        request: input.request,
        config: input.config,
        hostEffects: input.hostEffects,
      }),
    );
  }

  return attachFirmwareClassification(
    await (input.runQemuSmokeImage ?? runUefiAArch64QemuSmokeImage)({
      artifactName: input.artifactName,
      artifactBytes: input.artifactBytes,
      targetDriverFingerprint: input.targetDriverFingerprint,
      request: input.request,
      config: input.config,
      hostEffects: input.hostEffects,
    }),
  );
}

function attachUnrecognizedFirmwareDiagnostic(
  report: UefiAArch64SmokeReport,
  classification: AArch64UefiFirmwarePathClassification,
): UefiAArch64SmokeReport {
  if (classification.kind !== "unrecognized") return report;
  return Object.freeze({
    ...report,
    stableDetail: `${classification.stableDetail}:smoke:${report.stableDetail}`,
    observedMarkers: Object.freeze([...report.observedMarkers]),
  });
}

function missingConfigDiagnostic(config: UefiAArch64QemuSmokeConfig): string | undefined {
  if (config.qemuSystemAarch64Path.length === 0) {
    return "qemu-smoke:missing-config:qemuSystemAarch64Path";
  }
  if (config.firmwareCodePath.length === 0) {
    return "qemu-smoke:missing-config:firmwareCodePath";
  }
  return undefined;
}

function invalidRequestDiagnostic(request: UefiAArch64QemuSmokeRequest): string | undefined {
  const shellSuccessMarker = request.uefiShellSuccessMarker;
  if (shellSuccessMarker === undefined) return undefined;
  if (!isSafeUefiShellEchoArgument(shellSuccessMarker.marker)) {
    return "qemu-smoke:invalid-shell-success-marker";
  }
  if (
    shellSuccessMarker.failureMarker !== undefined &&
    !isSafeUefiShellEchoArgument(shellSuccessMarker.failureMarker)
  ) {
    return "qemu-smoke:invalid-shell-failure-marker";
  }
  return undefined;
}

function isSafeUefiShellEchoArgument(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function smokeReport(
  status: UefiAArch64SmokeReport["status"],
  stableDetail: string,
): UefiAArch64SmokeReport {
  return Object.freeze({
    status,
    stableDetail,
    observedMarkers: Object.freeze([]),
  });
}

function pathBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

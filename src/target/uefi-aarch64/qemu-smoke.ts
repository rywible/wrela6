import type { UefiAArch64ImageArtifact, UefiAArch64SmokeReport } from "./artifact";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

const UEFI_AARCH64_DEFAULT_BOOT_IMAGE_PATH = Object.freeze(["EFI", "BOOT", "BOOTAA64.EFI"]);
const UEFI_AARCH64_SHELL_SMOKE_IMAGE_PATH = Object.freeze(["EFI", "WRELA", "SMOKEAA64.EFI"]);
const UEFI_AARCH64_SHELL_SMOKE_IMAGE_COMMAND = "\\EFI\\WRELA\\SMOKEAA64.EFI";

interface UefiAArch64QemuSmokeRequestOptions {
  readonly allowSkip?: boolean;
  readonly timeoutMs?: number;
  readonly expectedConsoleMarkers?: readonly string[];
  readonly uefiShellSuccessMarker?: UefiAArch64ShellSuccessMarker;
  readonly termination?: "kill-after-marker" | "wait-for-firmware-exit";
}

export type UefiAArch64DisabledSmokeRequest = UefiAArch64QemuSmokeRequestOptions & {
  readonly kind: "disabled";
};

export type UefiAArch64QemuSmokeRequest = UefiAArch64QemuSmokeRequestOptions & {
  readonly kind: "qemu";
};

export type UefiAArch64InlineSmokeRequest = UefiAArch64QemuSmokeRequestOptions & {
  readonly kind: "run";
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
};

export type UefiAArch64SmokeRequest = UefiAArch64DisabledSmokeRequest | UefiAArch64QemuSmokeRequest;

export interface UefiAArch64ShellSuccessMarker {
  readonly marker: string;
  readonly failureMarker?: string;
}

export interface UefiAArch64QemuSmokeConfig {
  readonly qemuSystemAarch64Path: string;
  readonly firmwareCodePath: string;
  readonly firmwareVarsTemplatePath?: string;
  readonly machine: "virt";
  readonly cpu: "cortex-a76" | "max";
  readonly memoryMiB: number;
  readonly accel: "tcg" | "hvf" | "kvm";
}

export interface PlanUefiAArch64QemuSmokeCommandInput {
  readonly artifactName: string;
  readonly artifactBytes: Uint8Array | readonly number[];
  readonly tempDirectory: string;
  readonly request: UefiAArch64QemuSmokeRequest;
  readonly config: UefiAArch64QemuSmokeConfig;
}

export interface UefiAArch64QemuSmokeCommandPlan {
  readonly artifactName: string;
  readonly espImagePath: string;
  readonly startupScriptPath?: string;
  readonly startupScriptBytes?: Uint8Array | readonly number[];
  readonly firmwareVarsPath?: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly expectedConsoleMarkers: readonly string[];
  readonly failureConsoleMarkers: readonly string[];
  readonly termination: "kill-after-marker" | "wait-for-firmware-exit";
}

export type UefiAArch64SmokeArtifactPathEnvironmentResult =
  | { readonly kind: "ok"; readonly artifactPath: string }
  | { readonly kind: "skipped"; readonly stableDetail: string };

export interface UefiAArch64QemuRunnerOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  readonly timedOut: boolean;
  readonly cleanupFailed: boolean;
  readonly missingTools: boolean;
  readonly terminatedByHarness: boolean;
}

export interface UefiAArch64QemuHostEffects {
  readonly createTempDirectory: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, bytes: Uint8Array | readonly number[]) => Promise<void>;
  readonly copyFile: (sourcePath: string, targetPath: string) => Promise<void>;
  readonly runProcess: (
    command: UefiAArch64QemuSmokeCommandPlan,
    timeoutMs: number,
  ) => Promise<UefiAArch64QemuRunnerOutput>;
  readonly removeDirectory: (path: string) => Promise<void>;
}

export function planUefiAArch64QemuSmokeCommand(
  input: PlanUefiAArch64QemuSmokeCommandInput,
): UefiAArch64TargetResult<UefiAArch64QemuSmokeCommandPlan> {
  const diagnostics = [
    ...smokeConfigDiagnostics(input.config),
    ...smokeRequestDiagnostics(input.request),
  ];
  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(
        "uefi-aarch64-qemu-smoke",
        "plan-command",
        "qemu-smoke:missing-config",
      ),
    });
  }

  const shellMarkerPlan = shellMarkerPlanForSmokeRequest(input.request, input.tempDirectory);
  const startupScript = startupScriptForShellSuccessMarker(input.request, shellMarkerPlan);
  const espImagePath = pathJoin(
    input.tempDirectory,
    ...(startupScript === undefined
      ? UEFI_AARCH64_DEFAULT_BOOT_IMAGE_PATH
      : UEFI_AARCH64_SHELL_SMOKE_IMAGE_PATH),
  );
  const varsPath =
    input.config.firmwareVarsTemplatePath === undefined ||
    input.config.firmwareVarsTemplatePath.length === 0
      ? undefined
      : pathJoin(input.tempDirectory, "AAVMF_VARS.fd");
  const pflashMachine =
    varsPath === undefined
      ? "virt,virtualization=off,pflash0=rom"
      : "virt,virtualization=off,pflash0=rom,pflash1=efivars";
  const varsBlockdev =
    varsPath === undefined
      ? []
      : ["-blockdev", `node-name=efivars,driver=file,filename=${varsPath}`];

  return uefiAArch64Ok({
    value: Object.freeze({
      artifactName: input.artifactName,
      espImagePath,
      ...(startupScript === undefined
        ? {}
        : {
            startupScriptPath: pathJoin(input.tempDirectory, "startup.nsh"),
            startupScriptBytes: startupScript,
          }),
      firmwareVarsPath: varsPath,
      executable: input.config.qemuSystemAarch64Path,
      expectedConsoleMarkers: expectedConsoleMarkersForSmokeRequest(input.request, shellMarkerPlan),
      failureConsoleMarkers: failureConsoleMarkersForSmokeRequest(input.request, shellMarkerPlan),
      termination: input.request.termination ?? "kill-after-marker",
      args: Object.freeze([
        "-machine",
        pflashMachine,
        "-cpu",
        input.config.cpu,
        "-accel",
        input.config.accel,
        "-m",
        String(input.config.memoryMiB),
        "-serial",
        "mon:stdio",
        "-display",
        "none",
        "-blockdev",
        `node-name=rom,driver=file,filename=${input.config.firmwareCodePath},read-only=true`,
        ...varsBlockdev,
        "-drive",
        `if=none,id=esp,format=raw,file=fat:rw:${input.tempDirectory}`,
        "-device",
        "virtio-blk-device,drive=esp",
      ]),
    }),
    verification: passedVerification("uefi-aarch64-qemu-smoke", "plan-command"),
  });
}

export function classifyUefiAArch64QemuSmokeRun(input: {
  readonly request: UefiAArch64SmokeRequest;
  readonly output: UefiAArch64QemuRunnerOutput;
  readonly expectedConsoleMarkers?: readonly string[];
  readonly failureConsoleMarkers?: readonly string[];
  readonly targetDriverFingerprint?: string;
}): UefiAArch64SmokeReport {
  const markers =
    input.expectedConsoleMarkers ?? expectedConsoleMarkersForSmokeRequest(input.request);
  const failureMarkers =
    input.failureConsoleMarkers ?? failureConsoleMarkersForSmokeRequest(input.request);
  const combinedOutput = `${input.output.stdout}\n${input.output.stderr}`;
  const observedMarkers = markers.filter((marker) => combinedOutput.includes(marker));
  const missingMarkers = markers.filter((marker) => !combinedOutput.includes(marker));
  const observedFailureMarkers = failureMarkers.filter((marker) => combinedOutput.includes(marker));

  if (input.request.kind === "disabled") {
    return smokeReport(
      "disabled",
      "qemu-smoke:disabled",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (input.output.missingTools) {
    return smokeReport(
      input.request.allowSkip === true ? "skipped" : "failed",
      "qemu-smoke:missing-tools",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (input.output.timedOut) {
    return smokeReport(
      "failed",
      "qemu-smoke:timeout",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (input.output.cleanupFailed) {
    return smokeReport(
      "failed",
      "qemu-smoke:cleanup-failed",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (observedFailureMarkers.length > 0) {
    return smokeReport(
      "failed",
      "qemu-smoke:shell-startimage-failed",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (missingMarkers.length > 0) {
    return smokeReport(
      "failed",
      `qemu-smoke:missing-markers:${missingMarkers.join(",")}`,
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  if (
    (input.request.termination ?? "kill-after-marker") !== "wait-for-firmware-exit" &&
    !input.output.terminatedByHarness
  ) {
    return smokeReport(
      "failed",
      "qemu-smoke:harness-termination-missing",
      observedMarkers,
      input.targetDriverFingerprint,
    );
  }
  return smokeReport(
    "passed",
    "qemu-smoke:markers-observed",
    observedMarkers,
    input.targetDriverFingerprint,
  );
}

export function qemuSmokeConfigFromEnvironment(
  environment: Record<string, string | undefined>,
):
  | { readonly kind: "ok"; readonly config: UefiAArch64QemuSmokeConfig }
  | { readonly kind: "skipped"; readonly stableDetail: string } {
  const qemuSystemAarch64Path = environment.WRELA_QEMU_AARCH64;
  const firmwareCodePath = environment.WRELA_QEMU_AARCH64_EFI_CODE;
  const firmwareVarsTemplatePath = environment.WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE;

  if (qemuSystemAarch64Path === undefined || qemuSystemAarch64Path.length === 0) {
    return { kind: "skipped", stableDetail: "qemu-smoke:missing-env:WRELA_QEMU_AARCH64" };
  }
  if (firmwareCodePath === undefined || firmwareCodePath.length === 0) {
    return { kind: "skipped", stableDetail: "qemu-smoke:missing-env:WRELA_QEMU_AARCH64_EFI_CODE" };
  }

  return {
    kind: "ok",
    config: Object.freeze({
      qemuSystemAarch64Path,
      firmwareCodePath,
      firmwareVarsTemplatePath:
        firmwareVarsTemplatePath === undefined || firmwareVarsTemplatePath.length === 0
          ? undefined
          : firmwareVarsTemplatePath,
      machine: "virt",
      cpu: "cortex-a76",
      memoryMiB: 512,
      accel: "tcg",
    }),
  };
}

export function qemuSmokeArtifactPathFromEnvironment(
  environment: Record<string, string | undefined>,
): UefiAArch64SmokeArtifactPathEnvironmentResult {
  const artifactPath = environment.WRELA_UEFI_AARCH64_SMOKE_EFI;
  if (artifactPath === undefined || artifactPath.length === 0) {
    return {
      kind: "skipped",
      stableDetail: "qemu-smoke:missing-env:WRELA_UEFI_AARCH64_SMOKE_EFI",
    };
  }
  return { kind: "ok", artifactPath };
}

export async function runUefiAArch64QemuSmoke(input: {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly request: UefiAArch64QemuSmokeRequest;
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
}): Promise<UefiAArch64SmokeReport> {
  return runUefiAArch64QemuSmokeImage({
    artifactName: input.artifact.artifactName,
    artifactBytes: input.artifact.peCoffArtifact.bytes,
    targetDriverFingerprint: input.artifact.targetMetadata.targetDriverFingerprint,
    request: input.request,
    config: input.config,
    hostEffects: input.hostEffects,
  });
}

export async function runUefiAArch64QemuSmokeImage(input: {
  readonly artifactName: string;
  readonly artifactBytes: Uint8Array | readonly number[];
  readonly targetDriverFingerprint?: string;
  readonly request: UefiAArch64QemuSmokeRequest;
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
}): Promise<UefiAArch64SmokeReport> {
  const tempDirectory = await input.hostEffects.createTempDirectory("wrela-uefi-aarch64-");
  let output: UefiAArch64QemuRunnerOutput | undefined;
  let report: UefiAArch64SmokeReport = smokeReport(
    "failed",
    "qemu-smoke:not-run",
    [],
    input.targetDriverFingerprint,
  );
  let plannedCommand: UefiAArch64QemuSmokeCommandPlan | undefined;

  try {
    const command = planUefiAArch64QemuSmokeCommand({
      artifactName: input.artifactName,
      artifactBytes: input.artifactBytes,
      tempDirectory,
      request: input.request,
      config: input.config,
    });
    if (command.kind === "error") {
      const stableDetail = command.diagnostics[0]?.stableDetail ?? "qemu-smoke:plan-failed";
      return smokeReport(
        input.request.allowSkip === true && command.diagnostics.every(isSkippablePlanDiagnostic)
          ? "skipped"
          : "failed",
        stableDetail,
        [],
        input.targetDriverFingerprint,
      );
    }
    plannedCommand = command.value;

    await input.hostEffects.writeFile(plannedCommand.espImagePath, input.artifactBytes);
    if (
      plannedCommand.startupScriptPath !== undefined &&
      plannedCommand.startupScriptBytes !== undefined
    ) {
      await input.hostEffects.writeFile(
        plannedCommand.startupScriptPath,
        plannedCommand.startupScriptBytes,
      );
    }
    if (
      input.config.firmwareVarsTemplatePath !== undefined &&
      plannedCommand.firmwareVarsPath !== undefined
    ) {
      await input.hostEffects.copyFile(
        input.config.firmwareVarsTemplatePath,
        plannedCommand.firmwareVarsPath,
      );
    }

    output = await input.hostEffects.runProcess(plannedCommand, input.request.timeoutMs ?? 15000);
    report = classifyUefiAArch64QemuSmokeRun({
      request: input.request,
      output,
      expectedConsoleMarkers: plannedCommand.expectedConsoleMarkers,
      failureConsoleMarkers: plannedCommand.failureConsoleMarkers,
      targetDriverFingerprint: input.targetDriverFingerprint,
    });
  } finally {
    try {
      await input.hostEffects.removeDirectory(tempDirectory);
    } catch {
      if (output !== undefined) {
        report = classifyUefiAArch64QemuSmokeRun({
          request: input.request,
          output: Object.freeze({ ...output, cleanupFailed: true }),
          expectedConsoleMarkers: plannedCommand?.expectedConsoleMarkers,
          failureConsoleMarkers: plannedCommand?.failureConsoleMarkers,
          targetDriverFingerprint: input.targetDriverFingerprint,
        });
      }
    }
  }

  return report;
}

function smokeConfigDiagnostics(config: UefiAArch64QemuSmokeConfig) {
  const diagnostics = [];
  if (config.qemuSystemAarch64Path.length === 0) {
    diagnostics.push(
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_SMOKE_FAILED",
        ownerKey: "uefi-aarch64-qemu-smoke",
        stableDetail: "qemu-smoke:missing-config:qemuSystemAarch64Path",
      }),
    );
  }
  if (config.firmwareCodePath.length === 0) {
    diagnostics.push(
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_SMOKE_FAILED",
        ownerKey: "uefi-aarch64-qemu-smoke",
        stableDetail: "qemu-smoke:missing-config:firmwareCodePath",
      }),
    );
  }
  return diagnostics;
}

function smokeRequestDiagnostics(
  request: UefiAArch64QemuSmokeRequest,
): UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const shellSuccessMarker = request.uefiShellSuccessMarker;
  if (shellSuccessMarker === undefined) return diagnostics;

  if (!isSafeUefiShellEchoArgument(shellSuccessMarker.marker)) {
    diagnostics.push(
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_SMOKE_FAILED",
        ownerKey: "uefi-aarch64-qemu-smoke",
        stableDetail: "qemu-smoke:invalid-shell-success-marker",
      }),
    );
  }
  if (
    shellSuccessMarker.failureMarker !== undefined &&
    !isSafeUefiShellEchoArgument(shellSuccessMarker.failureMarker)
  ) {
    diagnostics.push(
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_SMOKE_FAILED",
        ownerKey: "uefi-aarch64-qemu-smoke",
        stableDetail: "qemu-smoke:invalid-shell-failure-marker",
      }),
    );
  }
  return diagnostics;
}

function isSkippablePlanDiagnostic(diagnostic: UefiAArch64TargetDiagnostic): boolean {
  return diagnostic.stableDetail.startsWith("qemu-smoke:missing-config:");
}

interface UefiAArch64ShellMarkerPlan {
  readonly successMarker: string;
  readonly failureMarker: string;
}

function shellMarkerPlanForSmokeRequest(
  request: UefiAArch64QemuSmokeRequest,
  tempDirectory: string,
): UefiAArch64ShellMarkerPlan | undefined {
  const marker = request.uefiShellSuccessMarker;
  if (marker === undefined) return undefined;
  const nonce = shellMarkerNonce(tempDirectory);
  return Object.freeze({
    successMarker: `${marker.marker}.${nonce}`,
    failureMarker: `${marker.failureMarker ?? "WRELA_UEFI_SMOKE_FAIL"}.${nonce}`,
  });
}

function startupScriptForShellSuccessMarker(
  request: UefiAArch64QemuSmokeRequest,
  shellMarkerPlan: UefiAArch64ShellMarkerPlan | undefined,
): Uint8Array | undefined {
  if (request.uefiShellSuccessMarker === undefined || shellMarkerPlan === undefined) {
    return undefined;
  }
  return asciiBytes(
    [
      "FS0:",
      UEFI_AARCH64_SHELL_SMOKE_IMAGE_COMMAND,
      "if %lasterror% == 0 then",
      `  echo ${shellMarkerPlan.successMarker}`,
      "else",
      `  echo ${shellMarkerPlan.failureMarker} %lasterror%`,
      "endif",
      "",
    ].join("\r\n"),
  );
}

function shellMarkerNonce(tempDirectory: string): string {
  const tail =
    tempDirectory
      .split(/[\\/]/)
      .filter((segment) => segment.length > 0)
      .at(-1) ?? "run";
  const safeTail = tail.replaceAll(/[^A-Za-z0-9_.:-]+/g, "_");
  return safeTail.length === 0 ? "run" : safeTail;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from([...value], (character) => character.charCodeAt(0) & 0x7f);
}

function isSafeUefiShellEchoArgument(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function smokeReport(
  status: UefiAArch64SmokeReport["status"],
  stableDetail: string,
  observedMarkers: readonly string[],
  targetDriverFingerprint?: string,
): UefiAArch64SmokeReport {
  return Object.freeze({
    status,
    stableDetail,
    observedMarkers: Object.freeze([...observedMarkers]),
    ...(targetDriverFingerprint === undefined ? {} : { targetDriverFingerprint }),
  });
}

function expectedConsoleMarkersForSmokeRequest(
  request: UefiAArch64SmokeRequest,
  shellMarkerPlan?: UefiAArch64ShellMarkerPlan,
): readonly string[] {
  const markers = [...(request.expectedConsoleMarkers ?? [])];
  const shellMarker = shellMarkerPlan?.successMarker ?? request.uefiShellSuccessMarker?.marker;
  if (shellMarker !== undefined && !markers.includes(shellMarker)) {
    markers.push(shellMarker);
  }
  return Object.freeze(markers);
}

function failureConsoleMarkersForSmokeRequest(
  request: UefiAArch64SmokeRequest,
  shellMarkerPlan?: UefiAArch64ShellMarkerPlan,
): readonly string[] {
  if (request.uefiShellSuccessMarker === undefined) return Object.freeze([]);
  return Object.freeze([
    shellMarkerPlan?.failureMarker ??
      request.uefiShellSuccessMarker.failureMarker ??
      "WRELA_UEFI_SMOKE_FAIL",
  ]);
}

function pathJoin(first: string, ...segments: readonly string[]): string {
  return [first, ...segments].join("/");
}

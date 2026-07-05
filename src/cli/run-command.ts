import {
  compileUefiAArch64ImageWithTrace,
  type UefiAArch64QemuHostEffects,
} from "../target/uefi-aarch64";
import {
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmokeImage,
} from "../target/uefi-aarch64";
import { nodeUefiAArch64QemuHostEffects } from "../target/uefi-aarch64/qemu-smoke-host";
import { WRELA_EXIT_DIAGNOSTICS, WRELA_EXIT_OK } from "./exit-codes";
import { loadWrelaPackage } from "./package-loader";
import { cliDiagnostic, type WrelaCliCommandResult } from "./reporter";
import type { WrelaCliArguments } from "./arguments";

export interface RunQemuCommandDependencies {
  readonly loadPackage?: typeof loadWrelaPackage;
  readonly compileImage?: typeof compileUefiAArch64ImageWithTrace;
  readonly environment?: Record<string, string | undefined>;
  readonly qemuHostEffects?: UefiAArch64QemuHostEffects;
  readonly runSmokeImage?: typeof runUefiAArch64QemuSmokeImage;
}

export async function runQemuCommand(
  command: Extract<WrelaCliArguments, { readonly kind: "run" }>,
  dependencies: RunQemuCommandDependencies = {},
): Promise<WrelaCliCommandResult> {
  const loaded = (dependencies.loadPackage ?? loadWrelaPackage)({
    directory: command.directory,
    stdlibMode: command.stdlibMode,
  });
  if (loaded.kind === "error") return diagnosticsResult(loaded.stableDetail);

  const compiled = (dependencies.compileImage ?? compileUefiAArch64ImageWithTrace)({
    packageInput: loaded.value.packageInput,
  });
  if (compiled.kind === "error") {
    return {
      exitCode: WRELA_EXIT_DIAGNOSTICS,
      result: Object.freeze({ status: "failed", diagnostics: compiled.diagnostics }),
      error: true,
    };
  }

  const config = qemuSmokeConfigFromEnvironment(dependencies.environment ?? process.env);
  if (config.kind === "skipped") {
    return {
      exitCode: WRELA_EXIT_OK,
      result: Object.freeze({ status: "skipped", stableDetail: config.stableDetail }),
      error: false,
    };
  }

  const smoke = await (dependencies.runSmokeImage ?? runUefiAArch64QemuSmokeImage)({
    artifactName: compiled.artifact.artifactName,
    artifactBytes: compiled.artifact.peCoffArtifact.bytes,
    targetDriverFingerprint: compiled.artifact.targetMetadata.targetDriverFingerprint,
    request: {
      kind: "qemu",
      allowSkip: true,
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
      uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      termination: "kill-after-marker",
      timeoutMs: 30000,
    },
    config: config.config,
    hostEffects: dependencies.qemuHostEffects ?? nodeUefiAArch64QemuHostEffects(),
  });
  return {
    exitCode: smoke.status === "failed" ? WRELA_EXIT_DIAGNOSTICS : WRELA_EXIT_OK,
    result: Object.freeze({ ...smoke }),
    error: smoke.status === "failed",
  };
}

function diagnosticsResult(stableDetail: string): WrelaCliCommandResult {
  return {
    exitCode: WRELA_EXIT_DIAGNOSTICS,
    result: Object.freeze({
      status: "failed",
      diagnostics: Object.freeze([cliDiagnostic(stableDetail)]),
    }),
    error: true,
  };
}

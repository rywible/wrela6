import {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
  runUefiAArch64PackagePipelineToProofCheck,
} from "../target/uefi-aarch64";
import { WRELA_EXIT_DIAGNOSTICS, WRELA_EXIT_OK } from "./exit-codes";
import { loadWrelaPackage } from "./package-loader";
import { cliDiagnostic, type WrelaCliCommandResult } from "./reporter";
import type { WrelaCliArguments } from "./arguments";

export function runCheckCommand(
  command: Extract<WrelaCliArguments, { readonly kind: "check" }>,
): WrelaCliCommandResult {
  const loaded = loadWrelaPackage({
    directory: command.directory,
    stdlibMode: command.stdlibMode,
  });
  if (loaded.kind === "error") return diagnosticsResult(loaded.stableDetail);

  const target = authenticateUefiAArch64TargetDriverSurface(
    canonicalUefiAArch64TargetDriverSurfaceInput(),
  );
  if (target.kind === "error") {
    return {
      exitCode: WRELA_EXIT_DIAGNOSTICS,
      result: Object.freeze({ status: "failed", diagnostics: target.diagnostics }),
      error: true,
    };
  }

  const checked = runUefiAArch64PackagePipelineToProofCheck({
    packageInput: loaded.value.packageInput,
    target: target.value,
  });
  if (checked.kind === "error") {
    return {
      exitCode: WRELA_EXIT_DIAGNOSTICS,
      result: Object.freeze({ status: "failed", diagnostics: checked.diagnostics }),
      error: true,
    };
  }

  return {
    exitCode: WRELA_EXIT_OK,
    result: Object.freeze({
      status: "passed",
      diagnostics: Object.freeze([]),
      stageRuns: checked.verification.runs,
    }),
    error: false,
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

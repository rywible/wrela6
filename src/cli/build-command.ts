import { basename, join } from "node:path";
import { compileUefiAArch64ImageWithTrace } from "../target/uefi-aarch64";
import { WRELA_EXIT_DIAGNOSTICS, WRELA_EXIT_OK } from "./exit-codes";
import { emitCliArtifact } from "./emit-command";
import { loadWrelaPackage } from "./package-loader";
import { cliDiagnostic, type WrelaCliCommandResult } from "./reporter";
import type { WrelaCliArguments } from "./arguments";

export function runBuildCommand(
  command: Extract<WrelaCliArguments, { readonly kind: "build" }>,
): WrelaCliCommandResult {
  const loaded = loadWrelaPackage({
    directory: command.directory,
    stdlibMode: command.stdlibMode,
  });
  if (loaded.kind === "error") {
    return diagnosticsResult(loaded.stableDetail);
  }

  const outputPath = command.out ?? join(command.directory, defaultOutputName(command.emit));
  const compiled = compileUefiAArch64ImageWithTrace({
    packageInput: loaded.value.packageInput,
    ...(command.emit === "image" ? { artifactName: basename(outputPath) } : {}),
  });
  if (compiled.kind === "error") {
    return {
      exitCode: WRELA_EXIT_DIAGNOSTICS,
      result: Object.freeze({ status: "failed", diagnostics: compiled.diagnostics }),
      error: true,
    };
  }

  const emitted = emitCliArtifact({
    stage: command.emit,
    path: outputPath,
    trace: compiled.trace,
    artifact: compiled.artifact,
  });
  return {
    exitCode: WRELA_EXIT_OK,
    result: Object.freeze({
      status: "passed",
      artifact: emitted,
      emit: command.emit,
      stdlibMode: loaded.value.stdlibMode,
    }),
    error: false,
  };
}

function defaultOutputName(stage: Extract<WrelaCliArguments, { readonly kind: "build" }>["emit"]) {
  switch (stage) {
    case "image":
      return "image.efi";
    case "asm":
      return "image.asm.txt";
    default:
      return `${stage}.json`;
  }
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

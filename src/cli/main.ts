#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseWrelaCliArguments, type WrelaCliArguments } from "./arguments";
import { runBuildCommand } from "./build-command";
import { runCheckCommand } from "./check-command";
import { WRELA_EXIT_INTERNAL, WRELA_EXIT_OK, WRELA_EXIT_USAGE } from "./exit-codes";
import { scaffoldWrelaProject } from "./init";
import { cliFailure, type WrelaCliCommandResult } from "./reporter";
import { writeCliResult } from "./reporter-host";
import { runQemuCommand } from "./run-command";
import { runValidateCommand } from "./validate-command";

if (import.meta.main) {
  const cliResult = await runWrelaCliFromArgv(Bun.argv.slice(2));
  process.exit(cliResult.exitCode);
}

export async function runWrelaCliFromArgv(args: readonly string[]): Promise<WrelaCliCommandResult> {
  const command = parseWrelaCliArguments(args);
  const cliResult = await runWrelaCli(command);
  writeCliResult({ json: command.json, result: cliResult.result, error: cliResult.error });
  return cliResult;
}

export async function runWrelaCli(command: WrelaCliArguments): Promise<WrelaCliCommandResult> {
  try {
    switch (command.kind) {
      case "usage-error":
        return {
          exitCode: WRELA_EXIT_USAGE,
          result: cliFailure(command.stableDetail),
          error: true,
        };
      case "init":
        const initResult = scaffoldWrelaProject({
          directory: command.directory,
          host: {
            exists: (path) => existsSync(path),
            join,
            mkdir: (path) => mkdirSync(path, { recursive: true }),
            writeTextFile: (path, text) => writeFileSync(path, text, "utf8"),
          },
        });
        if (initResult.kind === "error") {
          return {
            exitCode: WRELA_EXIT_USAGE,
            result: cliFailure(initResult.stableDetail),
            error: true,
          };
        }
        return {
          exitCode: WRELA_EXIT_OK,
          result: Object.freeze({ status: "passed", message: "initialized" }),
          error: false,
        };
      case "validate":
        return await runValidateCommand();
      case "build":
        return runBuildCommand(command);
      case "check":
        return runCheckCommand(command);
      case "run":
        return await runQemuCommand(command);
      default: {
        const unreachable: never = command;
        return unreachable;
      }
    }
  } catch (error) {
    return {
      exitCode: WRELA_EXIT_INTERNAL,
      result: cliFailure(error instanceof Error ? error.message : "cli:internal-error"),
      error: true,
    };
  }
}

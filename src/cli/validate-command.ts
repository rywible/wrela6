import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { runFullImageValidation } from "../validation/full-image";
import type { FixtureProjectFilesystem } from "../target/uefi-aarch64";
import { WRELA_EXIT_DIAGNOSTICS, WRELA_EXIT_OK } from "./exit-codes";
import type { WrelaCliCommandResult } from "./reporter";

const nodeFixtureFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
  realPath: (path: string) => realpathSync(path),
});

export async function runValidateCommand(): Promise<WrelaCliCommandResult> {
  const report = await runFullImageValidation(
    { targetKey: "wrela-uefi-aarch64-rpi5-v1", qemuSmoke: { kind: "disabled" } },
    { filesystem: nodeFixtureFilesystem, environment: process.env },
  );
  return {
    exitCode: report.status === "passed" ? WRELA_EXIT_OK : WRELA_EXIT_DIAGNOSTICS,
    result: report,
    error: report.status !== "passed",
  };
}

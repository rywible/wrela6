import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultUefiAArch64SourceRoots,
  failedVerification,
  packageInputFromFixtureProject,
  uefiAArch64Error,
  uefiAArch64TargetDiagnostic,
  type CompilerSourceRoot,
  type CompilerPackageInput,
  type FixtureProjectFilesystem,
  type FixtureProjectPathOperations,
} from "../target/uefi-aarch64";
import { parseWrelaManifest, type WrelaManifest } from "./manifest";
import type { WrelaCliStdlibMode } from "./arguments";

export interface LoadedWrelaPackage {
  readonly packageInput: CompilerPackageInput;
  readonly manifest: WrelaManifest;
  readonly stdlibMode: WrelaCliStdlibMode;
}

export type LoadWrelaPackageResult =
  | { readonly kind: "ok"; readonly value: LoadedWrelaPackage }
  | { readonly kind: "error"; readonly stableDetail: string };

export interface WrelaPackageLoaderHost {
  readonly exists: (path: string) => boolean;
  readonly readTextFile: (path: string) => string;
  readonly filesystem: FixtureProjectFilesystem;
  readonly paths: FixtureProjectPathOperations;
  readonly toolchainStdlibRoot: string;
}

const bundledToolchainStdlibRoot = fileURLToPath(
  new URL("../../stdlib/wrela-std", import.meta.url),
);

export function nodeWrelaPackageLoaderHost(): WrelaPackageLoaderHost {
  return Object.freeze({
    exists: (path: string) => existsSync(path),
    readTextFile: (path: string) => readFileSync(path, "utf8"),
    filesystem: Object.freeze({
      readDirectory: (path: string) => readdirSync(path),
      isDirectory: (path: string) => statSync(path).isDirectory(),
      readTextFile: (path: string) => readFileSync(path, "utf8"),
      realPath: (path: string) => realpathSync(path),
    }),
    paths: Object.freeze({
      join,
      normalize,
      relative,
    }),
    toolchainStdlibRoot: bundledToolchainStdlibRoot,
  });
}

export function loadWrelaPackage(input: {
  readonly directory: string;
  readonly stdlibMode?: WrelaCliStdlibMode;
  readonly host?: WrelaPackageLoaderHost;
}): LoadWrelaPackageResult {
  const host = input.host ?? nodeWrelaPackageLoaderHost();
  const manifestPath = host.paths.join(input.directory, "wrela.toml");
  if (!host.exists(manifestPath)) {
    return { kind: "error", stableDetail: "cli:manifest:not-found" };
  }

  let manifest: WrelaManifest;
  try {
    manifest = parseWrelaManifest(host.readTextFile(manifestPath));
  } catch (error) {
    return {
      kind: "error",
      stableDetail: error instanceof Error ? error.message : "cli:manifest:invalid",
    };
  }

  const stdlibMode = input.stdlibMode ?? manifest.stdlibMode;
  const sourceRootPath = host.paths.join(input.directory, "src");
  if (!host.exists(sourceRootPath)) {
    return { kind: "error", stableDetail: "cli:source-root:not-found:src" };
  }

  const packageInput = loadFixtureProjectPackageInput(() =>
    packageInputFromFixtureProject(input.directory, {
      packageKey: manifest.packageName,
      projectSourceRoot: "src",
      sourceRoots: cliSourceRoots({
        stdlibMode: packageInputStdlibMode(stdlibMode),
        toolchainStdlibRoot: host.toolchainStdlibRoot,
      }),
      filesystem: host.filesystem,
      paths: host.paths,
    }),
  );
  if (packageInput.kind === "error") {
    return {
      kind: "error",
      stableDetail: packageInput.diagnostics[0]?.stableDetail ?? "cli:package-input:error",
    };
  }

  return {
    kind: "ok",
    value: Object.freeze({
      packageInput: packageInput.value,
      manifest,
      stdlibMode,
    }),
  };
}

function loadFixtureProjectPackageInput(
  load: () => ReturnType<typeof packageInputFromFixtureProject>,
): ReturnType<typeof packageInputFromFixtureProject> {
  try {
    return load();
  } catch {
    return uefiAArch64Error({
      diagnostics: [
        uefiAArch64TargetDiagnostic({
          code: "UEFI_AARCH64_PIPELINE_FAILED",
          ownerKey: "package-input",
          stableDetail: "cli:package-input:filesystem-error",
        }),
      ],
      verification: failedVerification("cli-package-loader", "package-input"),
    });
  }
}

function packageInputStdlibMode(
  mode: WrelaCliStdlibMode,
): "toolchain" | "project-ejected" | "none" {
  switch (mode) {
    case "toolchain":
      return "toolchain";
    case "ejected":
      return "project-ejected";
    case "direct-platform":
    case "none":
      return "none";
  }
}

function cliSourceRoots(input: {
  readonly stdlibMode: "toolchain" | "project-ejected" | "none";
  readonly toolchainStdlibRoot: string;
}): readonly CompilerSourceRoot[] {
  return defaultUefiAArch64SourceRoots({
    projectSourceRoot: "src",
    stdlibMode: input.stdlibMode,
  }).map((sourceRoot) =>
    sourceRoot.kind === "toolchain"
      ? Object.freeze({ ...sourceRoot, filesystemPath: input.toolchainStdlibRoot })
      : sourceRoot,
  );
}

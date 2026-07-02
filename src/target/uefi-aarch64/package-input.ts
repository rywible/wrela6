import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  type UefiAArch64TargetResult,
  uefiAArch64Error,
  uefiAArch64Ok,
} from "./result";

const PACKAGE_INPUT_VERIFIER_KEY = "uefi-aarch64-package-input";
const PACKAGE_INPUT_RUN_KEY = "construct";

export interface CompilerSourceRoot {
  readonly kind: "project" | "toolchain";
  readonly rootKey: string;
  readonly rootPath: string;
  readonly trustedForAuthority: false;
}

export interface CompilerSourceFileInput {
  readonly sourceKey: string;
  readonly moduleName: string;
  readonly text: string;
}

export interface CompilerPackageInput {
  readonly packageKey: string;
  readonly sourceRoots: readonly CompilerSourceRoot[];
  readonly sourceFiles: readonly CompilerSourceFileInput[];
  readonly entryModuleName: string;
}

export interface CompilerPackageInputOptions {
  readonly packageKey: string;
  readonly sourceRoots: readonly CompilerSourceRoot[];
  readonly sourceFiles: readonly CompilerSourceFileInput[];
  readonly entryModuleName?: string;
}

export interface FixtureProjectFilesystem {
  readonly readDirectory: (path: string) => readonly string[];
  readonly isDirectory: (path: string) => boolean;
  readonly readTextFile: (path: string) => string;
}

export interface FixtureProjectPathOperations {
  readonly join: (left: string, right: string) => string;
  readonly relative: (source: string, target: string) => string;
  readonly normalize: (path: string) => string;
}

export interface FixtureProjectPackageInputOptions {
  readonly packageKey?: string;
  readonly entryModuleName?: string;
  readonly sourceRoots?: readonly CompilerSourceRoot[];
  readonly stdlibMode?: "toolchain" | "project-ejected" | "none";
  readonly projectSourceRoot?: string;
  readonly filesystem: FixtureProjectFilesystem;
  readonly paths?: FixtureProjectPathOperations;
}

export function compilerPackageInput(
  input: CompilerPackageInputOptions,
): UefiAArch64TargetResult<CompilerPackageInput> {
  const sourceRoots = Object.freeze(
    [...input.sourceRoots].sort((left, right) =>
      compareCodeUnitStrings(sourceRootSortKey(left), sourceRootSortKey(right)),
    ),
  );
  const sourceFiles = Object.freeze(
    [...input.sourceFiles].sort((left, right) =>
      compareCodeUnitStrings(sourceFileSortKey(left), sourceFileSortKey(right)),
    ),
  );
  const diagnostics = [
    ...duplicateDiagnostics(sourceFiles, "sourceKey", "duplicate-source-key"),
    ...duplicateDiagnostics(sourceFiles, "moduleName", "duplicate-module-name"),
  ];

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(PACKAGE_INPUT_VERIFIER_KEY, PACKAGE_INPUT_RUN_KEY),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      packageKey: input.packageKey,
      sourceRoots,
      sourceFiles,
      entryModuleName: input.entryModuleName ?? "image",
    }),
    verification: passedVerification(PACKAGE_INPUT_VERIFIER_KEY, PACKAGE_INPUT_RUN_KEY),
  });
}

export function defaultUefiAArch64SourceRoots(input: {
  readonly projectSourceRoot: string;
  readonly stdlibMode?: "toolchain" | "project-ejected" | "none";
}): readonly CompilerSourceRoot[] {
  const project = Object.freeze({
    kind: "project" as const,
    rootKey: "project",
    rootPath: input.projectSourceRoot,
    trustedForAuthority: false as const,
  });

  if (input.stdlibMode === "none") return Object.freeze([project]);
  if (input.stdlibMode === "project-ejected") {
    return Object.freeze([
      project,
      Object.freeze({
        kind: "project" as const,
        rootKey: "project-wrela-std",
        rootPath: `${input.projectSourceRoot}/wrela-std`,
        trustedForAuthority: false as const,
      }),
    ]);
  }

  return Object.freeze([
    project,
    Object.freeze({
      kind: "toolchain" as const,
      rootKey: "toolchain-wrela-std",
      rootPath: "stdlib/wrela-std",
      trustedForAuthority: false as const,
    }),
  ]);
}

export function packageInputFromFixtureProject(
  fixtureProjectPath: string,
  options: FixtureProjectPackageInputOptions,
): UefiAArch64TargetResult<CompilerPackageInput> {
  const sourceRoots =
    options.sourceRoots ??
    defaultUefiAArch64SourceRoots({
      projectSourceRoot: options.projectSourceRoot ?? "src",
      stdlibMode: options.stdlibMode,
    });
  const paths = options.paths ?? fixtureProjectPosixPaths;
  const sourceFiles = sourceRoots.flatMap((sourceRoot) =>
    sourceFilesFromRoot(fixtureProjectPath, sourceRoot, sourceRoots, options.filesystem, paths),
  );

  return compilerPackageInput({
    packageKey: options.packageKey ?? packageKeyFromFixtureProjectPath(fixtureProjectPath),
    sourceRoots,
    sourceFiles,
    entryModuleName: options.entryModuleName,
  });
}

function sourceFilesFromRoot(
  fixtureProjectPath: string,
  sourceRoot: CompilerSourceRoot,
  sourceRoots: readonly CompilerSourceRoot[],
  filesystem: FixtureProjectFilesystem,
  paths: FixtureProjectPathOperations,
): readonly CompilerSourceFileInput[] {
  const rootDirectory =
    sourceRoot.kind === "project"
      ? paths.join(fixtureProjectPath, sourceRoot.rootPath)
      : sourceRoot.rootPath;
  const nestedSourceRootDirectories = sourceRoots
    .filter((candidate) => candidate.rootKey !== sourceRoot.rootKey)
    .map((candidate) =>
      candidate.kind === "project"
        ? paths.join(fixtureProjectPath, candidate.rootPath)
        : candidate.rootPath,
    )
    .filter((candidateDirectory) => candidateDirectory.startsWith(`${rootDirectory}/`));
  const files: CompilerSourceFileInput[] = [];
  visitSourceDirectory(
    rootDirectory,
    rootDirectory,
    sourceRoot,
    nestedSourceRootDirectories,
    filesystem,
    paths,
    files,
  );
  return files;
}

function visitSourceDirectory(
  rootDirectory: string,
  directory: string,
  sourceRoot: CompilerSourceRoot,
  nestedSourceRootDirectories: readonly string[],
  filesystem: FixtureProjectFilesystem,
  paths: FixtureProjectPathOperations,
  files: CompilerSourceFileInput[],
): void {
  const entries = [...filesystem.readDirectory(directory)].sort(compareCodeUnitStrings);
  for (const entry of entries) {
    const path = paths.join(directory, entry);
    if (filesystem.isDirectory(path)) {
      if (nestedSourceRootDirectories.includes(path)) continue;
      visitSourceDirectory(
        rootDirectory,
        path,
        sourceRoot,
        nestedSourceRootDirectories,
        filesystem,
        paths,
        files,
      );
      continue;
    }
    if (!entry.endsWith(".wr")) continue;

    const pathWithinRoot = paths.normalize(paths.relative(rootDirectory, path));
    const sourceKey = `${sourceRoot.rootPath}/${pathWithinRoot}`;
    files.push(
      Object.freeze({
        sourceKey,
        moduleName: moduleNameFromSourceRoot(sourceRoot, pathWithinRoot),
        text: filesystem.readTextFile(path),
      }),
    );
  }
}

function moduleNameFromSourceRoot(sourceRoot: CompilerSourceRoot, pathWithinRoot: string): string {
  const localModuleName = moduleNameFromSourceKey(pathWithinRoot);
  if (sourceRoot.rootKey === "toolchain-wrela-std" || sourceRoot.rootKey === "project-wrela-std") {
    return `wrela_std.${localModuleName}`;
  }
  return localModuleName;
}

function sourceRootSortKey(source: CompilerSourceRoot): string {
  return `${source.rootKey}\0${source.rootPath}\0${source.kind}`;
}

function sourceFileSortKey(source: CompilerSourceFileInput): string {
  return `${source.sourceKey}\0${source.moduleName}`;
}

function duplicateDiagnostics(
  sources: readonly CompilerSourceFileInput[],
  key: "sourceKey" | "moduleName",
  detailKey: "duplicate-source-key" | "duplicate-module-name",
) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const source of sources) {
    const value = source[key];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareCodeUnitStrings).map((duplicate) =>
    uefiAArch64TargetDiagnostic({
      code: "UEFI_AARCH64_PIPELINE_FAILED",
      ownerKey: "package-input",
      stableDetail: `package-input:${detailKey}:${duplicate}`,
    }),
  );
}

function moduleNameFromSourceKey(sourceKey: string): string {
  return sourceKey.slice(0, -".wr".length).replace(/\//g, ".");
}

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function packageKeyFromFixtureProjectPath(fixtureProjectPath: string): string {
  const parts = normalizeSourcePath(fixtureProjectPath)
    .split("/")
    .filter((part) => part.length > 0);
  return parts.at(-1) ?? "fixture-project";
}

const fixtureProjectPosixPaths: FixtureProjectPathOperations = Object.freeze({
  join: (left: string, right: string) => {
    if (left.length === 0) return normalizeSourcePath(right);
    if (right.length === 0) return normalizeSourcePath(left);
    return normalizeSourcePath(`${left.replace(/\/+$/g, "")}/${right.replace(/^\/+/g, "")}`);
  },
  relative: (source: string, target: string) => {
    const normalizedSource = normalizeSourcePath(source).replace(/\/+$/g, "");
    const normalizedTarget = normalizeSourcePath(target);
    const prefix = `${normalizedSource}/`;
    return normalizedTarget.startsWith(prefix)
      ? normalizedTarget.slice(prefix.length)
      : normalizedTarget;
  },
  normalize: normalizeSourcePath,
});

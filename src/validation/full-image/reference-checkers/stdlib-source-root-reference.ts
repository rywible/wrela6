import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import type { CompilerPackageInput, CompilerSourceRoot } from "../../../target/uefi-aarch64";
import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import type { FullImageValidationStdlibMode } from "../matrix";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "stdlib-source-root-reference";
const INPUT_AUTHORITY = Object.freeze(["source-package"] as const);

export function stdlibSourceRootReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runStdlibSourceRootReferenceChecker,
  });
}

function runStdlibSourceRootReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  const expectedShape = expectedSourceRootShape(input.stdlibMode);
  const actualShape = sourceRootShape(input.packageInput.sourceRoots);
  const evidenceRecords = [
    evidence("expected-source-root-shape", `${input.stdlibMode}:${expectedShape}`),
    evidence("actual-source-root-shape", actualShape),
  ];

  if (actualShape !== expectedShape) {
    return Object.freeze([
      report({
        status: "failed",
        stableDetail: shapeMismatchDetail(input.stdlibMode, input.packageInput),
        evidence: evidenceRecords,
      }),
    ]);
  }

  const wrelaStdModules = wrelaStdModuleNames(input.packageInput);
  if (input.stdlibMode === "direct-platform" && wrelaStdModules.length > 0) {
    return Object.freeze([
      report({
        status: "failed",
        stableDetail: `stdlib-source-root:direct-platform:unexpected-wrela-std-modules:${wrelaStdModules.length}`,
        evidence: [
          evidence("expected-source-root-shape", `direct-platform:${expectedShape}`),
          evidence("wrela-std-modules", joined(wrelaStdModules)),
        ],
      }),
    ]);
  }

  if (input.stdlibMode === "toolchain-stdlib" && !hasToolchainStdlibRoot(input.packageInput)) {
    return Object.freeze([
      report({
        status: "failed",
        stableDetail: "stdlib-source-root:toolchain-stdlib:missing-toolchain-stdlib-root",
        evidence: evidenceRecords,
      }),
    ]);
  }

  return Object.freeze([
    report({
      status: "passed",
      stableDetail: `stdlib-source-root:${input.stdlibMode}:${expectedShape}`,
      evidence: evidenceRecords,
    }),
  ]);
}

function expectedSourceRootShape(stdlibMode: FullImageValidationStdlibMode): string {
  if (stdlibMode === "direct-platform") return "project:src";
  if (stdlibMode === "ejected-stdlib") return "project:src,project:src/wrela-std";
  return "project:src,toolchain:stdlib/wrela-std";
}

function shapeMismatchDetail(
  stdlibMode: FullImageValidationStdlibMode,
  packageInput: CompilerPackageInput,
): string {
  if (stdlibMode === "ejected-stdlib") {
    const toolchainRoot = packageInput.sourceRoots.find(
      (sourceRoot) => sourceRoot.kind === "toolchain",
    );
    if (toolchainRoot !== undefined) {
      return `stdlib-source-root:ejected-stdlib:unexpected-toolchain-root:${toolchainRoot.rootKey}`;
    }
  }
  if (stdlibMode === "toolchain-stdlib" && !hasToolchainStdlibRoot(packageInput)) {
    return "stdlib-source-root:toolchain-stdlib:missing-toolchain-stdlib-root";
  }
  return `stdlib-source-root:${stdlibMode}:shape-mismatch:expected:${expectedSourceRootShape(
    stdlibMode,
  )}:actual:${sourceRootShape(packageInput.sourceRoots)}`;
}

function sourceRootShape(sourceRoots: readonly CompilerSourceRoot[]): string {
  return joined(
    sourceRoots
      .map((sourceRoot) => `${sourceRoot.kind}:${sourceRoot.rootPath}`)
      .sort(compareCodeUnitStrings),
  );
}

function hasToolchainStdlibRoot(packageInput: CompilerPackageInput): boolean {
  return packageInput.sourceRoots.some(
    (sourceRoot) => sourceRoot.kind === "toolchain" && sourceRoot.rootPath === "stdlib/wrela-std",
  );
}

function wrelaStdModuleNames(packageInput: CompilerPackageInput): readonly string[] {
  return Object.freeze(
    packageInput.sourceFiles
      .map((source) => source.moduleName)
      .filter((moduleName) => moduleName === "wrela_std" || moduleName.startsWith("wrela_std."))
      .sort(compareCodeUnitStrings),
  );
}

function joined(values: readonly string[]): string {
  return values.join(",");
}

function report(input: {
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: input.evidence,
  });
}

function evidence(evidenceKey: string, stableDetail: string): FullImageValidationEvidenceRecord {
  return referenceEvidence({
    evidenceKey,
    authority: "source-package" as const,
    stableDetail,
  });
}

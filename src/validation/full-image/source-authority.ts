import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  fingerprintUefiAArch64ImageBytes,
  type UefiAArch64ImageArtifact,
} from "../../target/uefi-aarch64";
import type { CompilerPackageInput } from "../../target/uefi-aarch64/package-input";
import type { FullImageValidationStdlibMode } from "./matrix";
import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "./report";

const TOOLCHAIN_STDLIB_ROOT_KEY = "toolchain-wrela-std";
const TOOLCHAIN_STDLIB_ROOT_PATH = "stdlib/wrela-std";
const PROJECT_STDLIB_ROOT_KEY = "project-wrela-std";
const PROJECT_STDLIB_ROOT_PATH = "src/wrela-std";
const PROJECT_ROOT_KEY = "project";

export interface FullImageSourceAuthorityCheckInput {
  readonly packageInput: CompilerPackageInput;
  readonly stdlibMode: FullImageValidationStdlibMode;
}

export interface FullImageArtifactMetadataCheckInput {
  readonly artifact: UefiAArch64ImageArtifact;
}

export function checkFullImageSourceAuthority(
  input: FullImageSourceAuthorityCheckInput,
): readonly FullImageValidationCheckReport[] {
  return Object.freeze([
    trustedRootsReport(input.packageInput),
    stdlibModeReport(input),
    sourceCountReport(input.packageInput),
  ]);
}

export function fullImageValidationSourceFileCount(packageInput: CompilerPackageInput): number {
  return packageInput.sourceFiles.length;
}

export function fullImageValidationModuleCount(packageInput: CompilerPackageInput): number {
  return new Set(packageInput.sourceFiles.map((source) => source.moduleName)).size;
}

export function checkFullImageArtifactMetadata(
  input: FullImageArtifactMetadataCheckInput,
): readonly FullImageValidationCheckReport[] {
  const actual = fingerprintUefiAArch64ImageBytes(input.artifact.peCoffArtifact.bytes);
  const expected = input.artifact.targetMetadata.finalImageFingerprint;
  return Object.freeze([
    report({
      checkerKey: "artifact.metadata.final-image-fingerprint",
      status: expected === actual ? "passed" : "failed",
      stableDetail:
        expected === actual
          ? "artifact-metadata:final-image-fingerprint:matched"
          : `artifact-metadata:final-image-fingerprint:mismatch:${expected}:${actual}`,
      authority: ["final-bytes", "compiler-trace"],
      evidence: [
        evidence("final-image-fingerprint", "final-bytes", actual),
        evidence("metadata-final-image-fingerprint", "compiler-trace", expected),
      ],
    }),
  ]);
}

function trustedRootsReport(packageInput: CompilerPackageInput): FullImageValidationCheckReport {
  const trustedRootKeys = packageInput.sourceRoots
    .filter((sourceRoot) => sourceRoot.trustedForAuthority !== false)
    .map((sourceRoot) => sourceRoot.rootKey)
    .sort(compareCodeUnitStrings);
  return report({
    checkerKey: "source-authority.trusted-roots",
    status: trustedRootKeys.length === 0 ? "passed" : "failed",
    stableDetail:
      trustedRootKeys.length === 0
        ? `source-authority:trusted-roots:untrusted:${packageInput.sourceRoots.length}`
        : `source-authority:trusted-roots:trusted:${trustedRootKeys.join(",")}`,
    authority: ["source-package"],
    evidence: rootsEvidence(packageInput),
  });
}

function stdlibModeReport(
  input: FullImageSourceAuthorityCheckInput,
): FullImageValidationCheckReport {
  const result = stdlibModeResult(input);
  return report({
    checkerKey: "source-authority.stdlib-mode",
    status: result.status,
    stableDetail: result.stableDetail,
    authority: ["source-package"],
    evidence: [rootsEvidence(input.packageInput), modulesEvidence(input.packageInput)],
  });
}

function stdlibModeResult(input: FullImageSourceAuthorityCheckInput): {
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
} {
  if (input.stdlibMode === "toolchain-stdlib") {
    const toolchainRoots = input.packageInput.sourceRoots.filter(
      (sourceRoot) => sourceRoot.kind === "toolchain",
    );
    const matchingRootCount = toolchainRoots.filter(
      (sourceRoot) =>
        sourceRoot.rootKey === TOOLCHAIN_STDLIB_ROOT_KEY &&
        sourceRoot.rootPath === TOOLCHAIN_STDLIB_ROOT_PATH,
    ).length;
    const passed = toolchainRoots.length === 1 && matchingRootCount === 1;
    return {
      status: passed ? "passed" : "failed",
      stableDetail: passed
        ? "source-authority:toolchain-stdlib"
        : `source-authority:toolchain-stdlib:mismatch:matching-toolchain-roots:${matchingRootCount}:toolchain-roots:${toolchainRoots.length}`,
    };
  }

  if (input.stdlibMode === "ejected-stdlib") {
    const toolchainRootCount = toolchainRootCountForPackage(input.packageInput);
    const hasProjectStdlibRoot = input.packageInput.sourceRoots.some(
      (sourceRoot) =>
        sourceRoot.kind === "project" &&
        sourceRoot.rootKey === PROJECT_STDLIB_ROOT_KEY &&
        sourceRoot.rootPath === PROJECT_STDLIB_ROOT_PATH,
    );
    const passed = hasProjectStdlibRoot && toolchainRootCount === 0;
    return {
      status: passed ? "passed" : "failed",
      stableDetail: passed
        ? "source-authority:ejected-stdlib"
        : `source-authority:ejected-stdlib:mismatch:project-wrela-std:${hasProjectStdlibRoot ? "present" : "missing"}:toolchain-roots:${toolchainRootCount}`,
    };
  }

  const projectRootCount = input.packageInput.sourceRoots.filter(
    (sourceRoot) => sourceRoot.kind === "project" && sourceRoot.rootKey === PROJECT_ROOT_KEY,
  ).length;
  const toolchainRootCount = toolchainRootCountForPackage(input.packageInput);
  const wrelaStdModuleCount = input.packageInput.sourceFiles.filter((source) =>
    source.moduleName.startsWith("wrela_std"),
  ).length;
  const passed =
    input.packageInput.sourceRoots.length === 1 &&
    projectRootCount === 1 &&
    toolchainRootCount === 0 &&
    wrelaStdModuleCount === 0;
  return {
    status: passed ? "passed" : "failed",
    stableDetail: passed
      ? "source-authority:direct-platform"
      : `source-authority:direct-platform:mismatch:project-roots:${projectRootCount}:toolchain-roots:${toolchainRootCount}:wrela-std-modules:${wrelaStdModuleCount}`,
  };
}

function sourceCountReport(packageInput: CompilerPackageInput): FullImageValidationCheckReport {
  const sourceFileCount = fullImageValidationSourceFileCount(packageInput);
  const moduleCount = fullImageValidationModuleCount(packageInput);
  return report({
    checkerKey: "source-authority.counts",
    status: "passed",
    stableDetail: `source-authority:counts:sources:${sourceFileCount}:modules:${moduleCount}`,
    authority: ["source-package"],
    evidence: evidence(
      "source-counts",
      "source-package",
      `source-files:${sourceFileCount}:modules:${moduleCount}`,
    ),
  });
}

function toolchainRootCountForPackage(packageInput: CompilerPackageInput): number {
  return packageInput.sourceRoots.filter((sourceRoot) => sourceRoot.kind === "toolchain").length;
}

function rootsEvidence(packageInput: CompilerPackageInput): FullImageValidationEvidenceRecord {
  return evidence("source-roots", "source-package", rootEvidenceDetail(packageInput));
}

function modulesEvidence(packageInput: CompilerPackageInput): FullImageValidationEvidenceRecord {
  const modules = [...new Set(packageInput.sourceFiles.map((source) => source.moduleName))].sort(
    compareCodeUnitStrings,
  );
  return evidence("modules", "source-package", modules.join("|"));
}

function rootEvidenceDetail(packageInput: CompilerPackageInput): string {
  return packageInput.sourceRoots
    .map(
      (sourceRoot) =>
        `${sourceRoot.kind}:${sourceRoot.rootKey}:${sourceRoot.rootPath}:${String(
          sourceRoot.trustedForAuthority,
        )}`,
    )
    .sort(compareCodeUnitStrings)
    .join("|");
}

function report(input: {
  readonly checkerKey: string;
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly authority: readonly FullImageValidationEvidenceAuthority[];
  readonly evidence:
    | FullImageValidationEvidenceRecord
    | readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return Object.freeze({
    checkerKey: input.checkerKey,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: Object.freeze([...input.authority]),
    evidence: Object.freeze(Array.isArray(input.evidence) ? [...input.evidence] : [input.evidence]),
  });
}

function evidence(
  evidenceKey: string,
  authority: FullImageValidationEvidenceAuthority,
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return Object.freeze({
    evidenceKey,
    authority,
    stableDetail,
  });
}

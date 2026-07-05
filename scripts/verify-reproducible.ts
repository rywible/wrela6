import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildReproducibilityManifest,
  lockfileSha256,
  sha256Bytes,
  stableJson,
  type ReproducibilityCommandEvidence,
  type ReproducibilityOutputDigest,
  type ReproducibilitySourceInputDigest,
  type ReproducibilityValidationReportDigest,
} from "./reproducibility-manifest";
import {
  compileUefiAArch64ImageWithTrace,
  type CompilerPackageInput,
  type FixtureProjectFilesystem,
} from "../src/target/uefi-aarch64";
import {
  fixtureSpecForFullImageCase,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
  packageInputForFullImageFixture,
} from "../src/validation/full-image";

export const REPRODUCIBILITY_MANIFEST_PATH = "dist/release/reproducibility-manifest.json";

export type ReproducibilityBuildPass = {
  readonly label: string;
  readonly outputDirectory: string;
  readonly sourceInputs: readonly ReproducibilitySourceInputDigest[];
  readonly outputs: readonly ReproducibilityOutputDigest[];
  readonly validationReports: readonly ReproducibilityValidationReportDigest[];
  readonly diagnostics: readonly string[];
};

export type ReproducibilityComparison =
  | { readonly kind: "ok" }
  | { readonly kind: "mismatch"; readonly diagnostics: readonly string[] };

const nodeFixtureProjectFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
  realPath: (path: string) => realpathSync(path),
});

if (import.meta.main) {
  const allowDirty = Bun.argv.includes("--allow-dirty");
  const manifestPath = optionValue(Bun.argv, "--manifest-path") ?? REPRODUCIBILITY_MANIFEST_PATH;
  const gitCommit = runText(["git", "rev-parse", "HEAD"]).stdout.trim();
  const dirtyStatus = runText(["git", "status", "--porcelain"]).stdout;
  const dirty = dirtyStatus.trim().length > 0;

  if (dirty && !allowDirty) {
    console.error("reproducible:dirty-worktree");
    process.exit(1);
  }

  const buildRoot = mkdtempSync(join(tmpdir(), "wrela-reproducible-"));
  const firstBuild = runReproducibilityBuildPass("first", join(buildRoot, "first"));
  const secondBuild = runReproducibilityBuildPass("second", join(buildRoot, "second"));
  const comparison = compareReproducibleBuildPasses(firstBuild, secondBuild);
  const typecheck = runCommand(["bun", "run", "typecheck"]);

  const manifest = buildReproducibilityManifest({
    gitCommit,
    dirty,
    lockSha256: lockfileSha256(),
    platform: {
      architecture: process.arch,
      operatingSystem: process.platform,
    },
    tools: {
      bun: runText(["bun", "--version"]).stdout.trim(),
      git: runText(["git", "--version"]).stdout.trim(),
      typescript: runText(["bun", "x", "tsc", "--version"]).stdout.trim(),
    },
    commands: [typecheck],
    sourceInputs: firstBuild.sourceInputs,
    outputs: firstBuild.outputs,
    validationReports: [...firstBuild.validationReports, ...secondBuild.validationReports],
    validationEvidence: {
      buildPasses: [buildPassEvidence(firstBuild), buildPassEvidence(secondBuild)],
      comparison: comparison.kind,
      typecheckExitCode: typecheck.exitCode,
    },
  });

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifest, "utf8");

  if (comparison.kind === "mismatch") {
    for (const diagnostic of comparison.diagnostics) console.error(diagnostic);
  }
  for (const diagnostic of [...firstBuild.diagnostics, ...secondBuild.diagnostics]) {
    console.error(diagnostic);
  }
  console.log(`reproducible:manifest:${manifestPath}`);
  process.exit(
    comparison.kind === "ok" &&
      firstBuild.diagnostics.length === 0 &&
      secondBuild.diagnostics.length === 0 &&
      typecheck.exitCode === 0
      ? 0
      : 1,
  );
}

export function compareReproducibleBuildPasses(
  left: ReproducibilityBuildPass,
  right: ReproducibilityBuildPass,
): ReproducibilityComparison {
  const diagnostics: string[] = [];
  const leftByKey = outputDigestMap(left.outputs);
  const rightByKey = outputDigestMap(right.outputs);
  const keys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();

  for (const key of keys) {
    const leftOutput = leftByKey.get(key);
    const rightOutput = rightByKey.get(key);
    if (leftOutput === undefined || rightOutput === undefined) {
      diagnostics.push(`reproducible:output-set-mismatch:${key}`);
      continue;
    }
    if (leftOutput.sha256 !== rightOutput.sha256) {
      diagnostics.push(
        `reproducible:byte-mismatch:${key}:left=${leftOutput.sha256}:right=${rightOutput.sha256}`,
      );
    }
    if (leftOutput.byteLength !== rightOutput.byteLength) {
      diagnostics.push(
        `reproducible:length-mismatch:${key}:left=${leftOutput.byteLength}:right=${rightOutput.byteLength}`,
      );
    }
    if (leftOutput.targetMetadataSha256 !== rightOutput.targetMetadataSha256) {
      diagnostics.push(
        `reproducible:metadata-mismatch:${key}:left=${leftOutput.targetMetadataSha256}:right=${rightOutput.targetMetadataSha256}`,
      );
    }
  }

  diagnostics.push(
    ...compareShaDigestCollections({
      kind: "source-input",
      left: left.sourceInputs,
      right: right.sourceInputs,
      keyOf: sourceInputDigestKey,
    }),
  );
  diagnostics.push(
    ...compareShaDigestCollections({
      kind: "validation-report",
      left: left.validationReports,
      right: right.validationReports,
      keyOf: validationReportComparisonKey,
    }),
  );

  return diagnostics.length === 0
    ? { kind: "ok" }
    : { kind: "mismatch", diagnostics: Object.freeze(diagnostics) };
}

export function runReproducibilityBuildPass(
  label: string,
  outputDirectory: string,
): ReproducibilityBuildPass {
  mkdirSync(outputDirectory, { recursive: true });
  const outputs: ReproducibilityOutputDigest[] = [];
  const sourceInputs = new Map<string, ReproducibilitySourceInputDigest>();
  const validationReports: ReproducibilityValidationReportDigest[] = [];
  const diagnostics: string[] = [];

  for (const caseKey of fullImageValidationV1Cases()) {
    const spec = fixtureSpecForFullImageCase(caseKey);
    const packageInput = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
    const stableCaseKey = fullImageValidationCaseKey(caseKey);
    if (packageInput.kind === "error") {
      diagnostics.push(`reproducible:package-input-failed:${stableCaseKey}`);
      validationReports.push(
        validationReportDigest({
          caseKey: stableCaseKey,
          passLabel: label,
          report: {
            schema: "wrela.reproducibility-validation-report",
            schemaVersion: 1,
            caseKey: stableCaseKey,
            status: "failed",
            reason: "package-input-failed",
            diagnostics: packageInput.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              stableDetail: diagnostic.stableDetail,
            })),
          },
        }),
      );
      continue;
    }
    for (const digest of sourceInputDigests(stableCaseKey, packageInput.value)) {
      sourceInputs.set(sourceInputDigestKey(digest), digest);
    }

    const compiled = compileUefiAArch64ImageWithTrace({
      packageInput: packageInput.value,
      artifactName: spec.artifactName,
      smoke: { kind: "disabled" },
    });
    if (compiled.kind === "error") {
      diagnostics.push(`reproducible:compile-failed:${stableCaseKey}`);
      validationReports.push(
        validationReportDigest({
          caseKey: stableCaseKey,
          passLabel: label,
          report: {
            schema: "wrela.reproducibility-validation-report",
            schemaVersion: 1,
            caseKey: stableCaseKey,
            packageKey: packageInput.value.packageKey,
            artifactName: spec.artifactName,
            status: "failed",
            reason: "compile-failed",
            diagnostics: compiled.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              stableDetail: diagnostic.stableDetail,
            })),
          },
        }),
      );
      continue;
    }

    const bytes = compiled.artifact.peCoffArtifact.bytes;
    const outputPath = join(outputDirectory, compiled.artifact.artifactName);
    writeFileSync(outputPath, bytes);
    outputs.push(
      Object.freeze({
        caseKey: stableCaseKey,
        artifactName: compiled.artifact.artifactName,
        byteLength: bytes.length,
        sha256: sha256Bytes(bytes),
        targetMetadataSha256: sha256Bytes(
          JSON.stringify(
            compiled.artifact.targetMetadata,
            Object.keys(compiled.artifact.targetMetadata).sort(),
          ),
        ),
      }),
    );
    validationReports.push(
      validationReportDigest({
        caseKey: stableCaseKey,
        passLabel: label,
        report: {
          schema: "wrela.reproducibility-validation-report",
          schemaVersion: 1,
          caseKey: stableCaseKey,
          packageKey: packageInput.value.packageKey,
          artifactName: compiled.artifact.artifactName,
          status: "passed",
          sourceFileCount: packageInput.value.sourceFiles.length,
          moduleCount: new Set(packageInput.value.sourceFiles.map((source) => source.moduleName))
            .size,
          artifactByteLength: bytes.length,
          artifactSha256: sha256Bytes(bytes),
          targetMetadataSha256: sha256Bytes(
            JSON.stringify(
              compiled.artifact.targetMetadata,
              Object.keys(compiled.artifact.targetMetadata).sort(),
            ),
          ),
          verificationRuns: compiled.verification.runs,
          diagnostics: compiled.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            stableDetail: diagnostic.stableDetail,
          })),
        },
      }),
    );
  }

  return Object.freeze({
    label,
    outputDirectory,
    sourceInputs: Object.freeze([...sourceInputs.values()].sort(compareSourceInputDigest)),
    outputs: Object.freeze(outputs.sort(compareOutputDigest)),
    validationReports: Object.freeze(validationReports.sort(compareValidationReportDigest)),
    diagnostics: Object.freeze(diagnostics),
  });
}

function outputDigestMap(
  outputs: readonly ReproducibilityOutputDigest[],
): ReadonlyMap<string, ReproducibilityOutputDigest> {
  return new Map(outputs.map((output) => [outputDigestKey(output), output]));
}

function outputDigestKey(output: ReproducibilityOutputDigest): string {
  return `${output.caseKey}:${output.artifactName}`;
}

function sourceInputDigestKey(sourceInput: ReproducibilitySourceInputDigest): string {
  return `${sourceInput.caseKey}:${sourceInput.sourceRootKey}:${sourceInput.sourceKey}:${sourceInput.moduleName}`;
}

function validationReportComparisonKey(report: ReproducibilityValidationReportDigest): string {
  return `${report.caseKey}:${report.reportName}`;
}

function compareOutputDigest(
  left: ReproducibilityOutputDigest,
  right: ReproducibilityOutputDigest,
): number {
  return (
    left.caseKey.localeCompare(right.caseKey) || left.artifactName.localeCompare(right.artifactName)
  );
}

function compareSourceInputDigest(
  left: ReproducibilitySourceInputDigest,
  right: ReproducibilitySourceInputDigest,
): number {
  return sourceInputDigestKey(left).localeCompare(sourceInputDigestKey(right));
}

function compareValidationReportDigest(
  left: ReproducibilityValidationReportDigest,
  right: ReproducibilityValidationReportDigest,
): number {
  return (
    validationReportComparisonKey(left).localeCompare(validationReportComparisonKey(right)) ||
    left.passLabel.localeCompare(right.passLabel)
  );
}

function compareShaDigestCollections<Entry extends { readonly sha256: string }>(input: {
  readonly kind: string;
  readonly left: readonly Entry[];
  readonly right: readonly Entry[];
  readonly keyOf: (entry: Entry) => string;
}): readonly string[] {
  const diagnostics: string[] = [];
  const leftByKey = new Map(input.left.map((entry) => [input.keyOf(entry), entry]));
  const rightByKey = new Map(input.right.map((entry) => [input.keyOf(entry), entry]));
  const keys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();

  for (const key of keys) {
    const leftEntry = leftByKey.get(key);
    const rightEntry = rightByKey.get(key);
    if (leftEntry === undefined || rightEntry === undefined) {
      diagnostics.push(`reproducible:${input.kind}-set-mismatch:${key}`);
      continue;
    }
    if (leftEntry.sha256 !== rightEntry.sha256) {
      diagnostics.push(
        `reproducible:${input.kind}-mismatch:${key}:left=${leftEntry.sha256}:right=${rightEntry.sha256}`,
      );
    }
  }

  return Object.freeze(diagnostics);
}

function sourceInputDigests(
  caseKey: string,
  packageInput: CompilerPackageInput,
): readonly ReproducibilitySourceInputDigest[] {
  return Object.freeze(
    packageInput.sourceFiles
      .map((sourceFile) => {
        const sourceRoot = sourceRootForSource(packageInput, sourceFile.sourceKey);
        return Object.freeze({
          caseKey,
          sourceKey: sourceFile.sourceKey,
          moduleName: sourceFile.moduleName,
          sourceRootKey: sourceRoot?.rootKey ?? "unknown",
          sourceRootKind: sourceRoot?.kind ?? "unknown",
          byteLength: Buffer.byteLength(sourceFile.text, "utf8"),
          sha256: sha256Bytes(sourceFile.text),
        });
      })
      .sort(compareSourceInputDigest),
  );
}

function sourceRootForSource(
  packageInput: CompilerPackageInput,
  sourceKey: string,
): CompilerPackageInput["sourceRoots"][number] | undefined {
  return [...packageInput.sourceRoots]
    .filter((root) => sourceKey === root.rootPath || sourceKey.startsWith(`${root.rootPath}/`))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
}

function validationReportDigest(input: {
  readonly caseKey: string;
  readonly passLabel: string;
  readonly report: Record<string, unknown>;
}): ReproducibilityValidationReportDigest {
  const reportJson = `${stableJson(input.report)}\n`;
  const status = input.report.status === "passed" ? "passed" : "failed";
  return Object.freeze({
    caseKey: input.caseKey,
    reportName: "compile-validation",
    passLabel: input.passLabel,
    status,
    byteLength: Buffer.byteLength(reportJson, "utf8"),
    sha256: sha256Bytes(reportJson),
  });
}

function buildPassEvidence(pass: ReproducibilityBuildPass) {
  return Object.freeze({
    label: pass.label,
    sourceInputCount: pass.sourceInputs.length,
    outputCount: pass.outputs.length,
    validationReportCount: pass.validationReports.length,
    diagnostics: pass.diagnostics,
  });
}

function runCommand(command: readonly string[]): ReproducibilityCommandEvidence {
  const result = Bun.spawnSync([...command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, FORCE_COLOR: "0" },
  });
  return Object.freeze({
    command,
    exitCode: result.exitCode,
    stdoutSha256: sha256Bytes(result.stdout),
    stderrSha256: sha256Bytes(result.stderr),
  });
}

function runText(command: readonly string[]): { readonly stdout: string; readonly stderr: string } {
  const result = Bun.spawnSync([...command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, FORCE_COLOR: "0" },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

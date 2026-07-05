import { stableHash } from "../../shared/stable-json";
import type {
  CompileUefiAArch64ImageInput,
  CompileUefiAArch64ImageWithTraceResult,
} from "../../target/uefi-aarch64/compile-uefi-aarch64-image";
import {
  qemuSmokeConfigFromEnvironment,
  type UefiAArch64QemuSmokeRequest,
  type UefiAArch64SmokeReport,
} from "../../target/uefi-aarch64";
import type { FixtureProjectFilesystem } from "../../target/uefi-aarch64/package-input";
import type { UefiAArch64QemuHostEffects } from "../../target/uefi-aarch64/qemu-smoke";
import { fullImageQemuSmokeRequestForCase, runFullImageValidationQemuSmoke } from "./qemu";
import { runFullImageReferenceCheckers } from "./reference-checkers";
import {
  fixtureSpecForFullImageCase,
  packageInputForFullImageFixture,
  type FullImageValidationFixtureSpec,
} from "./fixture-catalog";
import {
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
  type FullImageValidationCaseKey,
} from "./matrix";
import {
  fullImageValidationDiagnostic,
  sortFullImageValidationDiagnostics,
  type FullImageValidationDiagnostic,
} from "./diagnostics";
import type {
  FullImageValidationCaseReport,
  FullImageValidationCheckReport,
  FullImageValidationEquivalenceEvidence,
  FullImageValidationReport,
  FullImageValidationSourceRootReport,
} from "./report";
import { verifyFullImageValidationStageTrail } from "./stage-trail";
import { checkFullImageBinaryStructure } from "./binary-structure-checker";
import { checkFullImageSelfContained } from "./self-contained-checker";
import {
  compareFullImageValidationReportsForDeterminism,
  compareFullImageValidationStdlibModeEquivalence,
} from "./determinism";
import { checkFullImageSourceAuthority } from "./source-authority";

export type FullImageValidationQemuSmokePolicy =
  | { readonly kind: "disabled" }
  | { readonly kind: "configured-only" }
  | { readonly kind: "required" };

export type FullImageValidationQemuLaunchMode = "default-boot-path" | "uefi-shell-startup";

export interface FullImageValidationRequest {
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly cases?: readonly FullImageValidationCaseKey[];
  readonly qemuSmoke?: FullImageValidationQemuSmokePolicy;
  readonly qemuLaunchMode?: FullImageValidationQemuLaunchMode;
  readonly allowedExtraStageRunKeys?: readonly string[];
  readonly artifactNamePrefix?: string;
}

export interface FullImageValidationDependencies {
  readonly filesystem: FixtureProjectFilesystem;
  readonly compileImage?: (
    input: CompileUefiAArch64ImageInput,
  ) => CompileUefiAArch64ImageWithTraceResult | Promise<CompileUefiAArch64ImageWithTraceResult>;
  readonly qemuHostEffects?: UefiAArch64QemuHostEffects;
  readonly environment?: Record<string, string | undefined>;
  readonly sourceRootChecks?: readonly FullImageValidationCaseChecker[];
  readonly binaryChecks?: readonly FullImageValidationCaseChecker[];
  readonly selfContainedChecks?: readonly FullImageValidationCaseChecker[];
  readonly referenceChecks?: readonly FullImageValidationCaseChecker[];
  readonly equivalenceChecks?: readonly FullImageValidationEquivalenceChecker[];
  readonly qemuChecks?: readonly FullImageValidationQemuChecker[];
}

export interface FullImageValidationCaseCheckerInput {
  readonly caseKey: string;
  readonly spec: FullImageValidationFixtureSpec;
  readonly caseReport: FullImageValidationCaseReport;
  readonly packageInput: CompileUefiAArch64ImageInput["packageInput"];
  readonly compileStatus: FullImageValidationCaseReport["compileStatus"];
  readonly artifact?: Extract<
    CompileUefiAArch64ImageWithTraceResult,
    { readonly kind: "ok" }
  >["artifact"];
  readonly trace?: Extract<
    CompileUefiAArch64ImageWithTraceResult,
    { readonly kind: "ok" }
  >["trace"];
}

export type FullImageValidationCaseChecker = (
  input: FullImageValidationCaseCheckerInput,
) => readonly FullImageValidationCheckReport[];

export interface FullImageValidationEquivalenceCheckerInput {
  readonly cases: readonly FullImageValidationCaseReport[];
}

export type FullImageValidationEquivalenceChecker = (
  input: FullImageValidationEquivalenceCheckerInput,
) => readonly FullImageValidationEquivalenceEvidence[];

export interface FullImageValidationQemuCheckerInput {
  readonly caseKey: string;
  readonly spec: FullImageValidationFixtureSpec;
  readonly caseReport: FullImageValidationCaseReport;
  readonly qemuSmoke: FullImageValidationQemuSmokePolicy;
  readonly qemuLaunchMode?: FullImageValidationQemuLaunchMode;
  readonly qemuHostEffects?: UefiAArch64QemuHostEffects;
  readonly environment?: Record<string, string | undefined>;
  readonly artifact?: Extract<
    CompileUefiAArch64ImageWithTraceResult,
    { readonly kind: "ok" }
  >["artifact"];
}

export type FullImageValidationQemuChecker = (
  input: FullImageValidationQemuCheckerInput,
) => UefiAArch64SmokeReport | undefined | Promise<UefiAArch64SmokeReport | undefined>;

interface FullImageValidationCaseRun {
  readonly report: FullImageValidationCaseReport;
  readonly artifactBytes?: Uint8Array;
}

export async function runFullImageValidation(
  request: FullImageValidationRequest,
  dependencies: FullImageValidationDependencies,
): Promise<FullImageValidationReport> {
  const compileImage = dependencies.compileImage ?? compileUefiAArch64ImageWithTraceDefault;
  const caseRuns: FullImageValidationCaseRun[] = [];
  const caseReports: FullImageValidationCaseReport[] = [];
  const reportDiagnostics: FullImageValidationDiagnostic[] = [];

  for (const caseKey of request.cases ?? fullImageValidationV1Cases()) {
    const spec = fixtureSpecForFullImageCase(caseKey);
    const caseRun = await runFullImageValidationCase({
      request,
      dependencies,
      compileImage,
      spec,
    });
    const caseReport = caseRun.report;
    caseRuns.push(caseRun);
    caseReports.push(caseReport);
    reportDiagnostics.push(...caseReport.diagnostics);
  }

  const equivalenceChecks =
    dependencies.equivalenceChecks ?? defaultEquivalenceChecksForRequest(request);
  const equivalenceEvidence = [
    ...equivalenceChecks.flatMap((check) => check({ cases: Object.freeze([...caseReports]) })),
    ...(dependencies.equivalenceChecks === undefined
      ? await defaultRepeatedRunDeterminismEvidence({
          request,
          dependencies,
          compileImage,
          initialRuns: caseRuns,
        })
      : []),
  ];
  if (equivalenceEvidence.length > 0) {
    const casesWithEquivalenceEvidence = caseReports.map((caseReport) =>
      Object.freeze({
        ...caseReport,
        equivalenceEvidence: Object.freeze([...equivalenceEvidence]),
      }),
    );
    caseReports.splice(0, caseReports.length, ...casesWithEquivalenceEvidence);
  }

  const diagnostics = sortFullImageValidationDiagnostics(reportDiagnostics);
  return Object.freeze({
    schema: "wrela.full-image-validation" as const,
    schemaVersion: 1 as const,
    targetKey: request.targetKey,
    status: reportStatus(caseReports, diagnostics),
    cases: Object.freeze(caseReports),
    diagnostics,
  });
}

async function runFullImageValidationCase(input: {
  readonly request: FullImageValidationRequest;
  readonly dependencies: FullImageValidationDependencies;
  readonly compileImage: NonNullable<FullImageValidationDependencies["compileImage"]>;
  readonly spec: FullImageValidationFixtureSpec;
}): Promise<FullImageValidationCaseRun> {
  const caseKey = fullImageValidationCaseKey(input.spec);
  const packageInput = packageInputForFullImageFixture(input.spec, input.dependencies.filesystem);
  const diagnostics: FullImageValidationDiagnostic[] = [];

  if (packageInput.kind === "error") {
    diagnostics.push(
      caseDiagnostic(caseKey, "FULL_IMAGE_PACKAGE_INPUT_FAILED", "package-input:failed"),
    );
    return Object.freeze({
      report: Object.freeze({
        caseKey,
        scenario: input.spec.scenario,
        stdlibMode: input.spec.stdlibMode,
        packageKey: input.spec.packageKey,
        artifactName: artifactNameForSpec(input.spec, input.request.artifactNamePrefix),
        compileStatus: "failed" as const,
        sourceRoots: Object.freeze([]),
        sourceFileCount: 0,
        moduleCount: 0,
        stageRuns: Object.freeze([]),
        binaryChecks: Object.freeze([]),
        referenceChecks: Object.freeze([]),
        equivalenceEvidence: Object.freeze([]),
        compilerDiagnostics: packageInput.diagnostics,
        diagnostics: sortFullImageValidationDiagnostics(diagnostics),
      }),
    });
  }

  const sourceRoots = sourceRootReports(packageInput.value);
  const compileResult = await input.compileImage({
    packageInput: packageInput.value,
    artifactName: artifactNameForSpec(input.spec, input.request.artifactNamePrefix),
    smoke: { kind: "disabled" },
  });
  const compileStatus = compileResult.kind === "ok" ? "passed" : "failed";
  const stageTrail = verifyFullImageValidationStageTrail({
    runs: compileResult.verification.runs,
    compileStatus,
    artifactCreated: compileResult.kind === "ok",
    allowedExtraStageRunKeys: input.request.allowedExtraStageRunKeys,
  });
  if (stageTrail.kind === "error") {
    diagnostics.push(...stageTrail.diagnostics);
  }
  if (compileResult.kind === "error") {
    diagnostics.push(caseDiagnostic(caseKey, "FULL_IMAGE_COMPILE_FAILED", "compile:failed"));
  }

  const baseReport = Object.freeze({
    caseKey,
    scenario: input.spec.scenario,
    stdlibMode: input.spec.stdlibMode,
    packageKey: packageInput.value.packageKey,
    artifactName: artifactNameForSpec(input.spec, input.request.artifactNamePrefix),
    compileStatus,
    sourceRoots,
    sourceFileCount: packageInput.value.sourceFiles.length,
    moduleCount: new Set(packageInput.value.sourceFiles.map((source) => source.moduleName)).size,
    ...(compileResult.kind === "ok"
      ? { targetMetadata: compileResult.artifact.targetMetadata }
      : {}),
    stageRuns: stageTrail.stageRuns,
    binaryChecks: Object.freeze([]),
    referenceChecks: Object.freeze([]),
    equivalenceEvidence: Object.freeze([]),
    ...(compileResult.kind === "ok" ? { smoke: compileResult.artifact.smoke } : {}),
    ...(compileResult.kind === "ok"
      ? {
          artifactFingerprint: fingerprintUefiAArch64ImageBytes(
            compileResult.artifact.peCoffArtifact.bytes,
          ),
          artifactByteLength: compileResult.artifact.peCoffArtifact.bytes.length,
        }
      : {}),
    compilerDiagnostics: compileResult.diagnostics,
    diagnostics: Object.freeze([]),
  } satisfies FullImageValidationCaseReport);

  const sourceRootChecks = runCaseChecks(
    input.dependencies.sourceRootChecks ?? defaultSourceRootChecks(),
    caseKey,
    input.spec,
    baseReport,
    packageInput.value,
    compileResult,
  );
  const binaryStructureChecks = runCaseChecks(
    input.dependencies.binaryChecks ?? defaultBinaryChecks(),
    caseKey,
    input.spec,
    baseReport,
    packageInput.value,
    compileResult,
  );
  const selfContainedChecks = runCaseChecks(
    input.dependencies.selfContainedChecks ?? defaultSelfContainedChecks(),
    caseKey,
    input.spec,
    baseReport,
    packageInput.value,
    compileResult,
  );
  const referenceOnlyChecks = runCaseChecks(
    input.dependencies.referenceChecks ?? defaultReferenceChecks(),
    caseKey,
    input.spec,
    baseReport,
    packageInput.value,
    compileResult,
  );
  const referenceChecks = Object.freeze([...sourceRootChecks, ...referenceOnlyChecks]);
  const binaryChecks = Object.freeze([...binaryStructureChecks, ...selfContainedChecks]);
  const smoke = await runQemuChecks(input, baseReport, caseKey, compileResult);

  const report = Object.freeze({
    ...baseReport,
    binaryChecks,
    referenceChecks,
    ...(smoke !== undefined ? { smoke } : {}),
    diagnostics: sortFullImageValidationDiagnostics(diagnostics),
  });
  return Object.freeze({
    report,
    ...(compileResult.kind === "ok"
      ? { artifactBytes: Uint8Array.from(compileResult.artifact.peCoffArtifact.bytes) }
      : {}),
  });
}

function runCaseChecks(
  checks: readonly FullImageValidationCaseChecker[],
  caseKey: string,
  spec: FullImageValidationFixtureSpec,
  caseReport: FullImageValidationCaseReport,
  packageInput: CompileUefiAArch64ImageInput["packageInput"],
  compileResult: CompileUefiAArch64ImageWithTraceResult,
): readonly FullImageValidationCheckReport[] {
  return checks.flatMap((check) =>
    check({
      caseKey,
      spec,
      caseReport,
      packageInput,
      compileStatus: caseReport.compileStatus,
      ...(compileResult.kind === "ok"
        ? {
            artifact: compileResult.artifact,
            trace: compileResult.trace,
          }
        : {}),
    }),
  );
}

function defaultSourceRootChecks(): readonly FullImageValidationCaseChecker[] {
  return Object.freeze([
    ({ packageInput, spec }) =>
      checkFullImageSourceAuthority({
        packageInput,
        stdlibMode: spec.stdlibMode,
      }),
  ]);
}

function defaultBinaryChecks(): readonly FullImageValidationCaseChecker[] {
  return Object.freeze([
    ({ artifact, trace }) =>
      artifact === undefined || trace === undefined
        ? [skippedCheck("binary.pe.parse", "binary:inputs-missing")]
        : checkFullImageBinaryStructure({ artifact, trace }),
  ]);
}

function defaultSelfContainedChecks(): readonly FullImageValidationCaseChecker[] {
  return Object.freeze([
    ({ artifact, trace }) =>
      artifact === undefined || trace === undefined
        ? [skippedCheck("self-contained.pe-parse", "self-contained:inputs-missing")]
        : checkFullImageSelfContained({ artifact, trace }),
  ]);
}

function defaultEquivalenceChecksForRequest(
  request: FullImageValidationRequest,
): readonly FullImageValidationEquivalenceChecker[] {
  if (!isFullV1CaseSelection(request.cases)) return Object.freeze([]);
  return Object.freeze([
    ({ cases }) =>
      compareFullImageValidationStdlibModeEquivalence({
        schema: "wrela.full-image-validation",
        schemaVersion: 1,
        targetKey: request.targetKey,
        status: reportStatus(cases, Object.freeze([])),
        cases,
        diagnostics: Object.freeze([]),
      }),
  ]);
}

async function defaultRepeatedRunDeterminismEvidence(input: {
  readonly request: FullImageValidationRequest;
  readonly dependencies: FullImageValidationDependencies;
  readonly compileImage: NonNullable<FullImageValidationDependencies["compileImage"]>;
  readonly initialRuns: readonly FullImageValidationCaseRun[];
}): Promise<readonly FullImageValidationEquivalenceEvidence[]> {
  const repeatedRuns: FullImageValidationCaseRun[] = [];
  const repeatedRequest = Object.freeze({
    ...input.request,
    qemuSmoke: { kind: "disabled" as const },
  });

  for (const caseKey of input.request.cases ?? fullImageValidationV1Cases()) {
    repeatedRuns.push(
      await runFullImageValidationCase({
        request: repeatedRequest,
        dependencies: input.dependencies,
        compileImage: input.compileImage,
        spec: fixtureSpecForFullImageCase(caseKey),
      }),
    );
  }

  return compareFullImageValidationReportsForDeterminism({
    left: comparisonReport(
      input.request,
      input.initialRuns.map((run) => run.report),
    ),
    right: comparisonReport(
      repeatedRequest,
      repeatedRuns.map((run) => run.report),
    ),
    leftArtifacts: artifactBytesByCase(input.initialRuns),
    rightArtifacts: artifactBytesByCase(repeatedRuns),
  });
}

function comparisonReport(
  request: FullImageValidationRequest,
  cases: readonly FullImageValidationCaseReport[],
): FullImageValidationReport {
  return Object.freeze({
    schema: "wrela.full-image-validation" as const,
    schemaVersion: 1 as const,
    targetKey: request.targetKey,
    status: reportStatus(cases, Object.freeze([])),
    cases: Object.freeze([...cases]),
    diagnostics: Object.freeze([]),
  });
}

function artifactBytesByCase(
  runs: readonly FullImageValidationCaseRun[],
): Readonly<Record<string, Uint8Array>> {
  const artifacts: Record<string, Uint8Array> = {};
  for (const run of runs) {
    if (run.artifactBytes !== undefined) {
      artifacts[run.report.caseKey] = Uint8Array.from(run.artifactBytes);
    }
  }
  return Object.freeze(artifacts);
}

function isFullV1CaseSelection(cases: readonly FullImageValidationCaseKey[] | undefined): boolean {
  if (cases === undefined) return true;
  const expected = fullImageValidationV1Cases().map(fullImageValidationCaseKey).sort();
  const actual = cases.map(fullImageValidationCaseKey).sort();
  return (
    actual.length === expected.length &&
    actual.every((caseKey, index) => caseKey === expected[index])
  );
}

function defaultReferenceChecks(): readonly FullImageValidationCaseChecker[] {
  return Object.freeze([
    ({ caseKey, spec, packageInput, compileStatus, artifact, trace }) =>
      runFullImageReferenceCheckers({
        input: {
          caseKey,
          scenario: spec.scenario,
          stdlibMode: spec.stdlibMode,
          fixtureSpec: spec,
          packageInput,
          compileStatus,
          ...(artifact === undefined ? {} : { artifact, targetMetadata: artifact.targetMetadata }),
          ...(trace === undefined ? {} : { trace }),
        },
      }),
  ]);
}

function skippedCheck(checkerKey: string, stableDetail: string): FullImageValidationCheckReport {
  return Object.freeze({
    checkerKey,
    status: "skipped" as const,
    stableDetail,
    inputAuthority: Object.freeze(["compiler-trace" as const]),
    evidence: Object.freeze([]),
  });
}

async function runQemuChecks(
  input: {
    readonly request: FullImageValidationRequest;
    readonly dependencies: FullImageValidationDependencies;
    readonly spec: FullImageValidationFixtureSpec;
  },
  caseReport: FullImageValidationCaseReport,
  caseKey: string,
  compileResult: CompileUefiAArch64ImageWithTraceResult,
): Promise<UefiAArch64SmokeReport | undefined> {
  let smoke = caseReport.smoke;
  for (const check of input.dependencies.qemuChecks ?? defaultQemuChecks()) {
    smoke = await check({
      caseKey,
      spec: input.spec,
      caseReport,
      qemuSmoke: input.request.qemuSmoke ?? { kind: "disabled" },
      qemuLaunchMode: input.request.qemuLaunchMode,
      qemuHostEffects: input.dependencies.qemuHostEffects,
      environment: input.dependencies.environment,
      ...(compileResult.kind === "ok" ? { artifact: compileResult.artifact } : {}),
    });
  }
  return smoke;
}

function defaultQemuChecks(): readonly FullImageValidationQemuChecker[] {
  return Object.freeze([runDefaultQemuCheck]);
}

async function runDefaultQemuCheck(
  input: FullImageValidationQemuCheckerInput,
): Promise<UefiAArch64SmokeReport | undefined> {
  if (input.qemuSmoke.kind === "disabled") return input.caseReport.smoke;
  if (input.artifact === undefined) {
    return qemuSmokeReport("failed", "qemu-smoke:artifact-missing");
  }

  const config = qemuSmokeConfigFromEnvironment(input.environment ?? {});
  if (config.kind === "skipped") {
    return qemuSmokeReport(
      input.qemuSmoke.kind === "required" ? "failed" : "skipped",
      config.stableDetail,
      input.artifact.targetMetadata.targetDriverFingerprint,
    );
  }

  if (input.qemuHostEffects === undefined) {
    return qemuSmokeReport(
      input.qemuSmoke.kind === "required" ? "failed" : "skipped",
      "qemu-smoke:missing-host-effects",
      input.artifact.targetMetadata.targetDriverFingerprint,
    );
  }

  return runFullImageValidationQemuSmoke({
    artifact: input.artifact,
    request: qemuRequestForValidationCase(input),
    config: config.config,
    hostEffects: input.qemuHostEffects,
  });
}

function qemuRequestForValidationCase(
  input: FullImageValidationQemuCheckerInput,
): UefiAArch64QemuSmokeRequest {
  const request = fullImageQemuSmokeRequestForCase({
    caseKey: input.caseKey,
    launchMode: input.qemuLaunchMode ?? "uefi-shell-startup",
    expectedConsoleMarkers: input.spec.expectedConsoleMarkers,
  });
  return Object.freeze({
    ...request,
    allowSkip: input.qemuSmoke.kind !== "required",
  });
}

function qemuSmokeReport(
  status: UefiAArch64SmokeReport["status"],
  stableDetail: string,
  targetDriverFingerprint?: string,
): UefiAArch64SmokeReport {
  return Object.freeze({
    status,
    stableDetail,
    observedMarkers: Object.freeze([]),
    ...(targetDriverFingerprint === undefined ? {} : { targetDriverFingerprint }),
  });
}

function sourceRootReports(packageInput: {
  readonly sourceRoots: readonly {
    readonly kind: "project" | "toolchain";
    readonly rootKey: string;
    readonly rootPath: string;
    readonly trustedForAuthority: false;
  }[];
  readonly sourceFiles: readonly { readonly sourceKey: string }[];
}): readonly FullImageValidationSourceRootReport[] {
  return Object.freeze(
    packageInput.sourceRoots.map((sourceRoot) =>
      Object.freeze({
        ...sourceRoot,
        moduleCount: packageInput.sourceFiles.filter(
          (source) =>
            mostSpecificSourceRootForSource(packageInput.sourceRoots, source.sourceKey) ===
            sourceRoot,
        ).length,
      }),
    ),
  );
}

function mostSpecificSourceRootForSource(
  sourceRoots: readonly { readonly rootPath: string }[],
  sourceKey: string,
): { readonly rootPath: string } | undefined {
  return sourceRoots
    .filter((sourceRoot) => sourceBelongsToRoot(sourceKey, sourceRoot.rootPath))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
}

function sourceBelongsToRoot(sourceKey: string, rootPath: string): boolean {
  return sourceKey === rootPath || sourceKey.startsWith(`${rootPath}/`);
}

function artifactNameForSpec(
  spec: FullImageValidationFixtureSpec,
  prefix: string | undefined,
): string {
  return `${prefix ?? ""}${spec.artifactName}`;
}

async function compileUefiAArch64ImageWithTraceDefault(
  input: CompileUefiAArch64ImageInput,
): Promise<CompileUefiAArch64ImageWithTraceResult> {
  const compiler = await import("../../target/uefi-aarch64/compile-uefi-aarch64-image");
  return compiler.compileUefiAArch64ImageWithTrace(input);
}

function fingerprintUefiAArch64ImageBytes(bytes: ArrayLike<number>): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `uefi-aarch64-image-bytes:${stableHash(hex)}`;
}

function caseDiagnostic(
  ownerKey: string,
  code: FullImageValidationDiagnostic["code"],
  stableDetail: string,
): FullImageValidationDiagnostic {
  return fullImageValidationDiagnostic({ ownerKey, code, stableDetail });
}

function reportStatus(
  cases: readonly FullImageValidationCaseReport[],
  diagnostics: readonly FullImageValidationDiagnostic[],
): FullImageValidationReport["status"] {
  if (cases.length === 0) return "skipped";
  if (diagnostics.length > 0) return "failed";
  if (cases.some((caseReport) => caseReport.compileStatus === "failed")) return "failed";
  if (
    cases.some((caseReport) =>
      [...caseReport.binaryChecks, ...caseReport.referenceChecks].some(
        (check) => check.status === "failed",
      ),
    )
  ) {
    return "failed";
  }
  if (cases.some((caseReport) => caseReport.smoke?.status === "failed")) return "failed";
  if (
    cases.some((caseReport) =>
      caseReport.equivalenceEvidence.some((evidence) => evidence.status === "failed"),
    )
  ) {
    return "failed";
  }
  return "passed";
}

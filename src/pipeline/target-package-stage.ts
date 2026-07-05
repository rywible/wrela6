import {
  lowerOptIrToAArch64,
  type LowerOptIrToAArch64Input,
  type LowerOptIrToAArch64Result,
} from "../target";
import {
  runUefiAArch64PackagePipelineToOptIr,
  type RunUefiAArch64PackagePipelineToOptIrInput,
  type UefiAArch64PackageOptIrPipelineOutput,
} from "../target/uefi-aarch64/package-pipeline";
import type { UefiAArch64TargetDiagnostic } from "../target/uefi-aarch64/diagnostics";
import type {
  UefiAArch64TargetResult,
  UefiAArch64TargetVerificationSummary,
} from "../target/uefi-aarch64/result";
import {
  runFullImageValidation,
  type FullImageValidationDependencies,
  type FullImageValidationRequest,
} from "../validation/full-image/runner";
import type { FullImageValidationDiagnostic } from "../validation/full-image/diagnostics";
import type { FullImageValidationReport } from "../validation/full-image/report";
import {
  createCompilerStageMetadata,
  createCompilerStageResult,
  releaseEvidenceMetadata,
  type CompilerStageResult,
} from "./index";

export interface RunTargetStageInput {
  readonly input: LowerOptIrToAArch64Input;
  readonly lowerTarget?: (input: LowerOptIrToAArch64Input) => LowerOptIrToAArch64Result;
}

export interface RunPackageStageInput {
  readonly target: CompilerStageResult<
    "target",
    LowerOptIrToAArch64Result & { readonly kind: "ok" },
    unknown
  >;
  readonly input: RunUefiAArch64PackagePipelineToOptIrInput;
  readonly packageTarget?: (
    input: RunUefiAArch64PackagePipelineToOptIrInput,
  ) => UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput>;
}

export interface RunValidationStageInput {
  readonly packageResult: CompilerStageResult<
    "package",
    UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput> & { readonly kind: "ok" },
    unknown
  >;
  readonly request: FullImageValidationRequest;
  readonly dependencies: FullImageValidationDependencies;
  readonly validate?: (
    request: FullImageValidationRequest,
    dependencies: FullImageValidationDependencies,
  ) => Promise<FullImageValidationReport>;
}

export function runTargetStage(
  input: RunTargetStageInput,
): CompilerStageResult<
  "target",
  LowerOptIrToAArch64Result & { readonly kind: "ok" },
  LowerOptIrToAArch64Result extends { readonly diagnostics: readonly (infer Diagnostic)[] }
    ? Diagnostic
    : unknown
> {
  const lowerTarget = input.lowerTarget ?? lowerOptIrToAArch64;
  const result = lowerTarget(input.input);
  if (result.kind === "error") {
    return createCompilerStageResult({
      stage: "target",
      diagnostics: result.diagnostics,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "target",
    value: result,
    diagnostics: result.diagnostics,
  });
}

export function runPackageStage(
  input: RunPackageStageInput,
): CompilerStageResult<
  "package",
  UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput> & { readonly kind: "ok" },
  UefiAArch64TargetDiagnostic | unknown
> {
  if (input.target.kind === "error") {
    return createCompilerStageResult({
      stage: "package",
      diagnostics: input.target.diagnostics,
      metadata: input.target.metadata,
      error: true,
    });
  }

  const packageTarget = input.packageTarget ?? runUefiAArch64PackagePipelineToOptIr;
  const result = packageTarget(input.input);
  const metadata = createCompilerStageMetadata([
    releaseEvidenceMetadata({ evidenceIds: evidenceIdsFromVerification(result.verification) }),
  ]);
  if (result.kind === "error") {
    return createCompilerStageResult({
      stage: "package",
      diagnostics: result.diagnostics,
      metadata,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "package",
    value: result,
    diagnostics: result.diagnostics,
    metadata,
  });
}

export async function runValidationStage(
  input: RunValidationStageInput,
): Promise<
  CompilerStageResult<
    "validation",
    FullImageValidationReport,
    FullImageValidationDiagnostic | unknown
  >
> {
  if (input.packageResult.kind === "error") {
    return createCompilerStageResult({
      stage: "validation",
      diagnostics: input.packageResult.diagnostics,
      metadata: input.packageResult.metadata,
      error: true,
    });
  }

  const validate = input.validate ?? runFullImageValidation;
  const report = await validate(input.request, input.dependencies);
  const metadata = createCompilerStageMetadata([
    releaseEvidenceMetadata({ evidenceIds: evidenceIdsFromValidationReport(report) }),
  ]);
  if (report.status === "failed") {
    return createCompilerStageResult({
      stage: "validation",
      diagnostics: report.diagnostics,
      metadata,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "validation",
    value: report,
    diagnostics: report.diagnostics,
    metadata,
  });
}

function evidenceIdsFromVerification(
  verification: UefiAArch64TargetVerificationSummary,
): readonly string[] {
  return verification.runs.map((run) =>
    run.stableDetail === undefined
      ? `${run.verifierKey}:${run.runKey}:${run.status}`
      : `${run.verifierKey}:${run.runKey}:${run.status}:${run.stableDetail}`,
  );
}

function evidenceIdsFromValidationReport(report: FullImageValidationReport): readonly string[] {
  return report.cases.flatMap((caseReport) => [
    `case:${caseReport.caseKey}:${caseReport.compileStatus}`,
    ...caseReport.binaryChecks.map(
      (check) => `binary:${caseReport.caseKey}:${check.checkerKey}:${check.status}`,
    ),
    ...caseReport.referenceChecks.map(
      (check) => `reference:${caseReport.caseKey}:${check.checkerKey}:${check.status}`,
    ),
    ...caseReport.equivalenceEvidence.map(
      (evidence) => `equivalence:${caseReport.caseKey}:${evidence.groupKey}:${evidence.status}`,
    ),
    ...(caseReport.smoke === undefined
      ? []
      : [`smoke:${caseReport.caseKey}:${caseReport.smoke.status}`]),
  ]);
}

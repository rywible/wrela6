import type { Diagnostic } from "../../shared/diagnostics";
import {
  uefiAArch64TargetDiagnostic,
  type UefiAArch64TargetDiagnostic,
  type UefiAArch64TargetDiagnosticSource,
} from "./diagnostics";
import type {
  UefiAArch64PackagePipelineStageKey,
  UefiAArch64StageRecord,
} from "./package-pipeline-adapters";
import {
  uefiAArch64Error,
  verificationSummaryFromRuns,
  type UefiAArch64TargetResult,
} from "./result";

export const PACKAGE_PIPELINE_VERIFIER_KEY = "uefi-aarch64-package-pipeline";

export function createUefiAArch64StageRecorder<StageKey extends string>() {
  const records: UefiAArch64StageRecord<StageKey>[] = [];
  return {
    passed(stageKey: StageKey): readonly UefiAArch64StageRecord<StageKey>[] {
      records.push(Object.freeze({ stageKey, status: "passed" as const }));
      return this.records();
    },
    failed(stageKey: StageKey): readonly UefiAArch64StageRecord<StageKey>[] {
      records.push(Object.freeze({ stageKey, status: "failed" as const }));
      return this.records();
    },
    records(): readonly UefiAArch64StageRecord<StageKey>[] {
      return Object.freeze([...records]);
    },
  };
}

export function passedOptIrStages(
  stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[],
): readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[] {
  return Object.freeze([
    ...stages,
    Object.freeze({ stageKey: "opt-ir" as const, status: "passed" as const }),
  ]);
}

export function failedOptIrStages(
  stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[],
): readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[] {
  return Object.freeze([
    ...stages,
    Object.freeze({ stageKey: "opt-ir" as const, status: "failed" as const }),
  ]);
}

export function packagePipelineError<Value>(
  stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[],
  diagnostics: readonly UefiAArch64TargetDiagnostic[],
): UefiAArch64TargetResult<Value> {
  return uefiAArch64Error({
    diagnostics,
    verification: verificationSummaryFromRuns(
      stages.map((stage) => ({
        verifierKey: PACKAGE_PIPELINE_VERIFIER_KEY,
        runKey: stage.stageKey,
        status: stage.status,
      })),
    ),
  });
}

export function packagePipelineDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
  source?: UefiAArch64TargetDiagnosticSource,
): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: `uefi-aarch64-package-pipeline:${stageKey}`,
    stableDetail,
    ...(source === undefined ? {} : { source }),
  });
}

export function mapPackageStageDiagnostics(
  stageKey: UefiAArch64PackagePipelineStageKey,
  diagnostics: readonly {
    readonly code?: string;
    readonly stableDetail?: string;
    readonly message?: string;
    readonly source?: {
      readonly name: string;
      readonly positionAt?: (offset: number) => {
        readonly line: number;
        readonly column: number;
      };
    };
    readonly span?: {
      readonly start: number;
      readonly end: number;
    };
  }[],
): readonly UefiAArch64TargetDiagnostic[] {
  return diagnostics.map((diagnostic, index) => {
    const originalDetail =
      diagnostic.stableDetail ?? diagnostic.message ?? diagnostic.code ?? `diagnostic:${index}`;
    const originalCode = diagnostic.code ?? "unknown";
    return packagePipelineDiagnostic(
      stageKey,
      `${originalCode}:${originalDetail}`,
      sourcePayloadFromDiagnosticLike(diagnostic, originalCode, originalDetail),
    );
  });
}

export function sourcePayloadFromDiagnostic(
  diagnostic: Diagnostic,
): UefiAArch64TargetDiagnosticSource {
  const start = diagnostic.source.positionAt(diagnostic.span.start);
  const end = diagnostic.source.positionAt(diagnostic.span.end);
  return Object.freeze({
    originalCode: diagnostic.code,
    message: diagnostic.message,
    sourceName: diagnostic.source.name,
    startOffset: diagnostic.span.start,
    endOffset: diagnostic.span.end,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  });
}

function sourcePayloadFromDiagnosticLike(
  diagnostic: {
    readonly source?: {
      readonly name: string;
      readonly positionAt?: (offset: number) => {
        readonly line: number;
        readonly column: number;
      };
    };
    readonly span?: {
      readonly start: number;
      readonly end: number;
    };
    readonly message?: string;
  },
  originalCode: string,
  fallbackMessage: string,
): UefiAArch64TargetDiagnosticSource | undefined {
  if (diagnostic.source === undefined || diagnostic.span === undefined) return undefined;
  const start = diagnostic.source.positionAt?.(diagnostic.span.start);
  const end = diagnostic.source.positionAt?.(diagnostic.span.end);
  return Object.freeze({
    originalCode,
    message: diagnostic.message ?? fallbackMessage,
    sourceName: diagnostic.source.name,
    startOffset: diagnostic.span.start,
    endOffset: diagnostic.span.end,
    ...(start === undefined ? {} : { startLine: start.line, startColumn: start.column }),
    ...(end === undefined ? {} : { endLine: end.line, endColumn: end.column }),
  });
}

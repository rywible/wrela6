import type { UefiAArch64TargetVerifierRun } from "../../target/uefi-aarch64";
import {
  fullImageValidationDiagnostic,
  sortFullImageValidationDiagnostics,
  type FullImageValidationDiagnostic,
} from "./diagnostics";
import {
  FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS,
  FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS,
} from "./matrix";
import type { FullImageValidationCompileStatus, FullImageValidationStageRunReport } from "./report";

export interface VerifyFullImageValidationStageTrailInput {
  readonly runs: readonly UefiAArch64TargetVerifierRun[];
  readonly compileStatus: FullImageValidationCompileStatus;
  readonly artifactCreated: boolean;
  readonly allowedExtraStageRunKeys?: readonly string[];
}

export type VerifyFullImageValidationStageTrailResult =
  | { readonly kind: "ok"; readonly stageRuns: readonly FullImageValidationStageRunReport[] }
  | {
      readonly kind: "error";
      readonly stageRuns: readonly FullImageValidationStageRunReport[];
      readonly diagnostics: readonly FullImageValidationDiagnostic[];
    };

const STAGE_TRAIL_OWNER_KEY = "stage-trail";
const STAGE_TRAIL_DIAGNOSTIC_CODE = "FULL_IMAGE_VALIDATION_STAGE_TRAIL";

export function verifyFullImageValidationStageTrail(
  input: VerifyFullImageValidationStageTrailInput,
): VerifyFullImageValidationStageTrailResult {
  const diagnostics: FullImageValidationDiagnostic[] = [];
  const stageRuns = freezeStageRuns(input.runs);
  const requiredStageKeys = new Set<string>(FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS);
  const allowedExtraKeys = new Set<string>([
    ...FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS,
    ...(input.allowedExtraStageRunKeys ?? []),
  ]);
  const observedRequiredCounts = new Map<string, number>();
  let nextRequiredIndex = 0;
  let peCoffWriterObserved = false;
  let artifactAvailable = false;

  for (const run of input.runs) {
    if (requiredStageKeys.has(run.runKey)) {
      const observedCount = observedRequiredCounts.get(run.runKey) ?? 0;
      observedRequiredCounts.set(run.runKey, observedCount + 1);
      if (observedCount > 0) {
        diagnostics.push(
          stageTrailDiagnostic(`stage-trail:duplicate-required-stage:${run.runKey}`),
        );
        continue;
      }

      const expectedRunKey = FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS[nextRequiredIndex];
      if (run.runKey !== expectedRunKey) {
        diagnostics.push(
          stageTrailDiagnostic(`stage-trail:required-stage-out-of-order:${run.runKey}`),
        );
        const actualIndex = FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS.indexOf(run.runKey as never);
        nextRequiredIndex = actualIndex >= 0 ? actualIndex + 1 : nextRequiredIndex;
      } else {
        nextRequiredIndex += 1;
      }

      if (run.runKey === "pe-coff-writer") {
        peCoffWriterObserved = true;
        artifactAvailable = input.artifactCreated;
      }
      if (input.compileStatus === "passed" && run.status !== "passed") {
        diagnostics.push(
          stageTrailDiagnostic(`stage-trail:required-stage-not-passed:${run.runKey}`),
        );
      }
      continue;
    }

    if (!allowedExtraKeys.has(run.runKey)) {
      diagnostics.push(stageTrailDiagnostic(`stage-trail:unknown-extra-stage:${run.runKey}`));
      continue;
    }

    if (run.runKey === "artifact-sink" && !peCoffWriterObserved) {
      diagnostics.push(stageTrailDiagnostic("stage-trail:artifact-sink-before-pe-coff-writer"));
    }
    if (run.runKey === "qemu-smoke" && !artifactAvailable) {
      diagnostics.push(stageTrailDiagnostic("stage-trail:qemu-smoke-without-artifact"));
    }
  }

  if (input.compileStatus === "passed") {
    for (const requiredStageKey of FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS) {
      if ((observedRequiredCounts.get(requiredStageKey) ?? 0) === 0) {
        diagnostics.push(
          stageTrailDiagnostic(`stage-trail:missing-required-stage:${requiredStageKey}`),
        );
      }
    }
  }

  const sortedDiagnostics = sortFullImageValidationDiagnostics(diagnostics);
  if (sortedDiagnostics.length > 0) {
    return Object.freeze({ kind: "error" as const, stageRuns, diagnostics: sortedDiagnostics });
  }

  return Object.freeze({ kind: "ok" as const, stageRuns });
}

function freezeStageRuns(
  runs: readonly UefiAArch64TargetVerifierRun[],
): readonly FullImageValidationStageRunReport[] {
  return Object.freeze(
    runs.map((run) =>
      Object.freeze({
        verifierKey: run.verifierKey,
        runKey: run.runKey,
        status: run.status,
        ...(run.stableDetail !== undefined ? { stableDetail: run.stableDetail } : {}),
      }),
    ),
  );
}

function stageTrailDiagnostic(stableDetail: string): FullImageValidationDiagnostic {
  return fullImageValidationDiagnostic({
    ownerKey: STAGE_TRAIL_OWNER_KEY,
    code: STAGE_TRAIL_DIAGNOSTIC_CODE,
    stableDetail,
  });
}

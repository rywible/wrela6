import { aarch64Diagnostic } from "../machine-ir/diagnostics";
import type { AArch64LoweringStageKey } from "./pipeline-stages";
import {
  appendAArch64PlanningRecord,
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
  type AArch64LoweringState,
} from "./pipeline-stages";

export function aarch64ProductionStage(input: {
  readonly stageKey: AArch64LoweringStageKey;
  readonly run?: (state: AArch64LoweringState) => AArch64LoweringState;
}): AArch64LoweringPipelineStage {
  return Object.freeze({
    stageKey: input.stageKey,
    run(pipelineInput: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
      const tracedState = appendAArch64StageTrace(pipelineInput.state, input.stageKey);
      try {
        const nextState = input.run === undefined ? tracedState : input.run(tracedState);
        return okAArch64LoweringStage(nextState);
      } catch (error) {
        return {
          kind: "error",
          diagnostics: [
            aarch64StageDiagnostic({
              stageKey: input.stageKey,
              stableDetail: `stage-exception:${input.stageKey}:${stageExceptionDetail(error)}`,
            }),
          ],
        };
      }
    },
  });
}

function stageExceptionDetail(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "unknown";
}

export function aarch64StageDiagnostic(input: {
  readonly stageKey: AArch64LoweringStageKey;
  readonly stableDetail: string;
}) {
  return aarch64Diagnostic({
    code: "AARCH64_INPUT_CONTRACT_INVALID",
    ownerKey: input.stageKey,
    rootCauseKey: input.stageKey,
    stableDetail: input.stableDetail,
  });
}

export function recordAArch64StagePlanning(
  state: AArch64LoweringState,
  stageKey: AArch64LoweringStageKey,
  action: string,
): AArch64LoweringState {
  return appendAArch64PlanningRecord(state, {
    stageKey,
    subjectKey: "program",
    action,
    explanation: [`${stageKey}:${action}`],
  });
}

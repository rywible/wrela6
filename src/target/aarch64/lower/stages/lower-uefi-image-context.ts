import { lowerAArch64UefiImageStage } from "../uefi-image-lowering";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";
import { aarch64StageDiagnostic } from "../stage-helpers";

export const lowerUefiImageContextStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "lower-uefi-image-context",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const tracedState = appendAArch64StageTrace(input.state, "lower-uefi-image-context");
    const result = lowerAArch64UefiImageStage(tracedState);
    if (result.kind === "error") {
      return {
        kind: "error",
        diagnostics: [
          aarch64StageDiagnostic({
            stageKey: "lower-uefi-image-context",
            stableDetail: result.reason,
          }),
        ],
      };
    }
    return okAArch64LoweringStage(result.state);
  },
});

import { applyAArch64OutOfProfileAndErrata } from "../../select/selection-policy";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";

export const applyOutOfProfileAndErrataStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "apply-out-of-profile-and-errata",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const state = appendAArch64StageTrace(input.state, "apply-out-of-profile-and-errata");
    const result = applyAArch64OutOfProfileAndErrata(state);
    return result.kind === "ok"
      ? okAArch64LoweringStage(result.state)
      : { kind: "error", diagnostics: result.diagnostics };
  },
});

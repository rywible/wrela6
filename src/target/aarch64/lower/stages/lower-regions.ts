import {
  lowerAArch64RegionsStageState,
  validateAArch64RegionLoweringState,
} from "../region-lowering";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";

export const lowerRegionsStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "lower-regions",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const tracedState = appendAArch64StageTrace(input.state, "lower-regions");
    const diagnostics = validateAArch64RegionLoweringState(tracedState);
    if (diagnostics.length > 0) {
      return { kind: "error", diagnostics };
    }
    return okAArch64LoweringStage(lowerAArch64RegionsStageState(tracedState));
  },
});

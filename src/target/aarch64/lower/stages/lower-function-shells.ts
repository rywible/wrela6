import { lowerAArch64FunctionShells } from "../lower-function";
import { validateAArch64RegionLoweringState } from "../region-lowering";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
} from "../pipeline-stages";

export const lowerFunctionShellsStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "lower-function-shells",
  run(input: AArch64LoweringPipelineInput) {
    const tracedState = appendAArch64StageTrace(input.state, "lower-function-shells");
    const regionDiagnostics = validateAArch64RegionLoweringState(tracedState);
    if (regionDiagnostics.length > 0) {
      return { kind: "error" as const, diagnostics: regionDiagnostics };
    }
    const lowered = lowerAArch64FunctionShells(tracedState);
    if (lowered.kind === "error") {
      return { kind: "error" as const, diagnostics: lowered.diagnostics };
    }
    return okAArch64LoweringStage(lowered.state);
  },
});

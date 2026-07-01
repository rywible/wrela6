import { lowerAArch64CallsStageState } from "../call-lowering";
import { aarch64ProductionStage } from "../stage-helpers";

export const lowerCallsStage = aarch64ProductionStage({
  stageKey: "lower-calls",
  run: lowerAArch64CallsStageState,
});

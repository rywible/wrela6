import { lowerAArch64TerminatorsStageState } from "../terminator-lowering";
import { aarch64ProductionStage } from "../stage-helpers";

export const lowerTerminatorsStage = aarch64ProductionStage({
  stageKey: "lower-terminators",
  run: lowerAArch64TerminatorsStageState,
});

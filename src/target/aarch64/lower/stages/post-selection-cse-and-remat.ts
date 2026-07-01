import { runAArch64PostSelectionCseStageState } from "../../plan/post-selection-cse";
import { aarch64ProductionStage } from "../stage-helpers";

export const postSelectionCseAndRematStage = aarch64ProductionStage({
  stageKey: "post-selection-cse-and-remat",
  run: runAArch64PostSelectionCseStageState,
});

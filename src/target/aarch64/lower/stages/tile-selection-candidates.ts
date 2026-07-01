import { tileAArch64SelectionCandidatesStageState } from "../../select/pattern-tiler";
import { aarch64ProductionStage } from "../stage-helpers";

export const tileSelectionCandidatesStage = aarch64ProductionStage({
  stageKey: "tile-selection-candidates",
  run: tileAArch64SelectionCandidatesStageState,
});

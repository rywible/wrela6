import { selectAArch64VectorsStageState } from "../../select/vector-selection";
import { aarch64ProductionStage } from "../stage-helpers";

export const selectVectorsStage = aarch64ProductionStage({
  stageKey: "select-vectors",
  run: selectAArch64VectorsStageState,
});

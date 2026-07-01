import { selectAArch64LocalScalarsStageState } from "../../select/local-selector";
import { aarch64ProductionStage } from "../stage-helpers";

export const selectLocalScalarStage = aarch64ProductionStage({
  stageKey: "select-local-scalar",
  run: selectAArch64LocalScalarsStageState,
});

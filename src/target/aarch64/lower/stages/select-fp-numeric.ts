import { selectAArch64FpNumericStageState } from "../../select/fp-selection";
import { aarch64ProductionStage } from "../stage-helpers";

export const selectFpNumericStage = aarch64ProductionStage({
  stageKey: "select-fp-numeric",
  run: selectAArch64FpNumericStageState,
});

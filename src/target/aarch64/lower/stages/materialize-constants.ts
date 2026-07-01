import { materializeAArch64ConstantsStageState } from "../constant-materialization";
import { aarch64ProductionStage } from "../stage-helpers";

export const materializeConstantsStage = aarch64ProductionStage({
  stageKey: "materialize-constants",
  run: materializeAArch64ConstantsStageState,
});

import { propagateAArch64SecurityLabelsStageState } from "../security-label-lowering";
import { aarch64ProductionStage } from "../stage-helpers";

export const propagateSecurityLabelsStage = aarch64ProductionStage({
  stageKey: "propagate-security-labels",
  run: propagateAArch64SecurityLabelsStageState,
});

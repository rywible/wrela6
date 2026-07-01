import { planAArch64PairsPrefetchBarriersScheduleStageState } from "../../plan/pre-ra-scheduler";
import { aarch64ProductionStage } from "../stage-helpers";

export const planPairsPrefetchBarriersScheduleStage = aarch64ProductionStage({
  stageKey: "plan-pairs-prefetch-barriers-schedule",
  run: planAArch64PairsPrefetchBarriersScheduleStageState,
});

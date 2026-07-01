import { lowerAArch64MemoryOrderStageState } from "../memory-order-lowering";
import { aarch64ProductionStage } from "../stage-helpers";

export const lowerMemoryOrderStage = aarch64ProductionStage({
  stageKey: "lower-memory-order",
  run: lowerAArch64MemoryOrderStageState,
});

import { selectAArch64MemoryAndEndianStageState } from "../../select/memory-selection";
import { aarch64ProductionStage } from "../stage-helpers";

export const selectSmartMemoryAndEndianStage = aarch64ProductionStage({
  stageKey: "select-smart-memory-and-endian",
  run: selectAArch64MemoryAndEndianStageState,
});

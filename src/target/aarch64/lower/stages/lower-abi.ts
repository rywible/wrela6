import { lowerAArch64AbiStageState } from "../abi-lowering";
import { aarch64ProductionStage } from "../stage-helpers";

export const lowerAbiStage = aarch64ProductionStage({
  stageKey: "lower-abi",
  run: lowerAArch64AbiStageState,
});

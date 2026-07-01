import { preserveAArch64MachineFactsStageState } from "../fact-preservation";
import { aarch64ProductionStage } from "../stage-helpers";

export const preserveMachineFactsStage = aarch64ProductionStage({
  stageKey: "preserve-machine-facts",
  run: preserveAArch64MachineFactsStageState,
});

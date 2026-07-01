import { runAArch64SemanticSuperselectionStageState } from "../../select/semantic-superselector";
import { aarch64ProductionStage } from "../stage-helpers";

export const semanticSuperselectionStage = aarch64ProductionStage({
  stageKey: "semantic-superselection",
  run: runAArch64SemanticSuperselectionStageState,
});

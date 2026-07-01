import { buildAArch64DependencyGraphStageState } from "../../plan/machine-dependency-graph";
import { aarch64ProductionStage } from "../stage-helpers";

export const buildDependencyGraphStage = aarch64ProductionStage({
  stageKey: "build-dependency-graph",
  run: buildAArch64DependencyGraphStageState,
});

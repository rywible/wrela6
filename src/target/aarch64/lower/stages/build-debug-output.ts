import { buildAArch64DebugOutputStageState } from "../provenance-builder";
import { aarch64ProductionStage } from "../stage-helpers";

export const buildDebugOutputStage = aarch64ProductionStage({
  stageKey: "build-debug-output",
  run: buildAArch64DebugOutputStageState,
});

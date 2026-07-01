import { dumpAArch64MachineProgramDeterministically } from "../debug/deterministic-dump";
import type { AArch64LoweringState } from "./pipeline-stages";

export function buildAArch64DebugOutputStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (!state.options.debugTrace && !state.options.deterministicDump) {
    return state;
  }
  const deterministicDump =
    state.options.deterministicDump && state.machineProgram !== undefined
      ? dumpAArch64MachineProgramDeterministically({
          program: state.machineProgram,
          preservedFacts: state.preservedFacts,
          includeDebugExplanations: state.options.debugTrace ?? false,
        })
      : undefined;
  return Object.freeze({
    ...state,
    debugOutput: Object.freeze({
      ...state.debugOutput,
      deterministicDump,
      explanations: Object.freeze([
        ...state.debugOutput.explanations,
        ...state.selectionRecords.flatMap((record) => record.explanation),
        ...state.planningRecords.flatMap((record) => record.explanation),
      ]),
    }),
  });
}

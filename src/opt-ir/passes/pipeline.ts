import { OPT_IR_PRODUCTION_PASS_SCHEDULE } from "../policy/pass-order-policy";
import { runPipelineEntry } from "./pipeline-dispatch";
import {
  emptyDecisionLog,
  rejectExternalProvenance,
  sortedOperations,
  stateChanged,
  verifyPipelineState,
  withOptimizedProvenance,
} from "./pipeline-state";
import {
  isPipelineError,
  type OptimizeOptIrInput,
  type OptimizeOptIrResult,
  type PipelineState,
} from "./pipeline-types";

export { stableOptimizedOptIrResultKey } from "./pipeline-support";
export type {
  OptimizedOptIrProgram,
  OptimizedOptIrProvenanceSnapshot,
  OptIrVerifierCheckpoint,
  OptIrVerifierCheckpointKind,
  OptimizeOptIrInput,
  OptimizeOptIrResult,
} from "./pipeline-types";

export function optimizeOptIr(input: OptimizeOptIrInput): OptimizeOptIrResult {
  const staleProvenance = rejectExternalProvenance(input);
  if (staleProvenance !== undefined) {
    return { kind: "error", diagnostics: [staleProvenance] };
  }

  let state: PipelineState = {
    program: input.program,
    operations: sortedOperations(input.program.operations ?? []),
    optimizationRegions: Object.freeze([...(input.program.optimizationRegions ?? [])]),
    facts: input.facts,
    diagnostics: [],
    decisionLog: undefined,
    verificationCheckpoints: [],
  };

  const afterConstruction = verifyPipelineState(state, { kind: "after-construction" });
  if (isPipelineError(afterConstruction)) return afterConstruction;
  state = afterConstruction;

  for (let entryIndex = 0; entryIndex < OPT_IR_PRODUCTION_PASS_SCHEDULE.length; ) {
    const entry = OPT_IR_PRODUCTION_PASS_SCHEDULE[entryIndex];
    if (entry === undefined) {
      break;
    }
    if (entry.fixpoint === undefined) {
      const step = runPipelineEntry(state, input, entry);
      if (isPipelineError(step)) {
        return step;
      }
      state = step;
      entryIndex += 1;
      continue;
    }

    const fixpointId = entry.fixpoint.fixpointId;
    const groupStart = entryIndex;
    let groupEnd = groupStart + 1;
    while (
      groupEnd < OPT_IR_PRODUCTION_PASS_SCHEDULE.length &&
      OPT_IR_PRODUCTION_PASS_SCHEDULE[groupEnd]?.fixpoint?.fixpointId === fixpointId
    ) {
      groupEnd += 1;
    }

    const group = OPT_IR_PRODUCTION_PASS_SCHEDULE.slice(groupStart, groupEnd);
    const fuel = fixpointFuelLimit(entry.fixpoint.fuel);
    for (let round = 0; round < fuel; round += 1) {
      const beforeRound = state;
      for (const groupEntry of group) {
        const step = runPipelineEntry(state, input, groupEntry);
        if (isPipelineError(step)) {
          return step;
        }
        state = step;
      }
      if (!stateChanged(beforeRound, state)) {
        break;
      }
    }
    entryIndex = groupEnd;
  }

  const beforeLowering = verifyPipelineState(state, { kind: "before-target-lowering" });
  if (isPipelineError(beforeLowering)) return beforeLowering;
  state = beforeLowering;

  const decisionLog = state.decisionLog ?? emptyDecisionLog();
  const optimizedProgram = withOptimizedProvenance(
    state.program,
    decisionLog,
    state.operations,
    state.optimizationRegions,
  );
  return {
    kind: "ok",
    program: optimizedProgram,
    operations: state.operations,
    facts: state.facts,
    provenance: optimizedProgram.provenance,
    decisionLog,
    diagnostics: state.diagnostics,
    verificationCheckpoints: state.verificationCheckpoints,
  };
}

function fixpointFuelLimit(
  fuel: NonNullable<(typeof OPT_IR_PRODUCTION_PASS_SCHEDULE)[number]["fixpoint"]>["fuel"],
): number {
  switch (fuel.kind) {
    case "fixedRounds":
      return fuel.rounds;
    case "worklist":
      return fuel.maxItems;
  }
}

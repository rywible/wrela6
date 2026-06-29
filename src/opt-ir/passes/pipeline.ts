import { OPT_IR_PRODUCTION_PASS_SCHEDULE } from "../policy/pass-order-policy";
import { runPipelineEntry } from "./pipeline-dispatch";
import {
  emptyDecisionLog,
  optimizationRegionsForProgram,
  rejectExternalProvenance,
  sortedOperations,
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
    facts: input.facts,
    diagnostics: [],
    decisionLog: undefined,
    verificationCheckpoints: [],
  };

  const afterConstruction = verifyPipelineState(state, { kind: "after-construction" });
  if (isPipelineError(afterConstruction)) return afterConstruction;
  state = afterConstruction;

  for (const entry of OPT_IR_PRODUCTION_PASS_SCHEDULE) {
    const step = runPipelineEntry(state, input, entry);
    if (isPipelineError(step)) {
      return step;
    }
    state = step;
  }

  const beforeLowering = verifyPipelineState(state, { kind: "before-target-lowering" });
  if (isPipelineError(beforeLowering)) return beforeLowering;
  state = beforeLowering;

  const decisionLog = state.decisionLog ?? emptyDecisionLog();
  const optimizedProgram = withOptimizedProvenance(
    state.program,
    decisionLog,
    state.operations,
    optimizationRegionsForProgram(state.program),
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

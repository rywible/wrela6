import { OPT_IR_PRODUCTION_PASS_SCHEDULE } from "../policy/pass-order-policy";
import { sortOptIrDiagnostics } from "../diagnostics";
import { createCompilerStageMetadata, optIrPassesMetadata } from "../../pipeline";
import { runPipelineEntry } from "./pipeline-dispatch";
import { runOptIrPassPipeline, type OptIrPipelinePassDefinition } from "./pass-manager";
import {
  emptyDecisionLog,
  rejectExternalProvenance,
  sortedOperations,
  stateChanged,
  verifyPipelineState,
  withOptimizedProvenance,
} from "./pipeline-state";
import type { OptIrPassName } from "./pass-execution";
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
    operations: sortedOperations(input.operations),
    optimizationRegions: Object.freeze([...input.optimizationRegions]),
    facts: input.facts,
    diagnostics: [],
    decisionLog: undefined,
    verificationCheckpoints: [],
    metadata: createCompilerStageMetadata([
      optIrPassesMetadata({
        passIds: OPT_IR_PRODUCTION_PASS_SCHEDULE.map((entry) => entry.passId),
      }),
    ]),
  };

  const afterConstruction = verifyPipelineState(state, { kind: "after-construction" });
  if (isPipelineError(afterConstruction)) return afterConstruction;
  state = afterConstruction;

  const optimized = runOptIrPassPipeline({
    state,
    input,
    schedule: OPT_IR_PRODUCTION_PASS_SCHEDULE,
    definitions: productionPassDefinitions(input),
  });
  if (isPipelineError(optimized)) {
    return optimized;
  }
  state = optimized;

  const beforeLowering = verifyPipelineState(state, { kind: "before-target-lowering" });
  if (isPipelineError(beforeLowering)) return beforeLowering;
  state = beforeLowering;

  const decisionLog = state.decisionLog ?? emptyDecisionLog();
  const optimizedProgram = withOptimizedProvenance(state.program, decisionLog);
  return {
    kind: "ok",
    program: optimizedProgram,
    operations: state.operations,
    optimizationRegions: state.optimizationRegions,
    facts: state.facts,
    provenance: optimizedProgram.provenance,
    decisionLog,
    diagnostics: sortOptIrDiagnostics(state.diagnostics),
    verificationCheckpoints: state.verificationCheckpoints,
    metadata: state.metadata ?? createCompilerStageMetadata(),
  };
}

function productionPassDefinitions(
  input: OptimizeOptIrInput,
): ReadonlyMap<string, OptIrPipelinePassDefinition> {
  return new Map(
    OPT_IR_PRODUCTION_PASS_SCHEDULE.map((entry) => [
      String(entry.passId),
      {
        name: String(entry.passId) as OptIrPassName,
        passId: entry.passId,
        contract: entry.contract,
        run({ state, context }) {
          const result = runPipelineEntry(state, input, entry, {
            decisionAlreadyAppended: true,
            context,
          });
          if (isPipelineError(result)) {
            return result;
          }
          return {
            kind: "ok",
            state: result,
            changed: stateChanged(state, result),
            diagnostics: [],
          };
        },
      },
    ]),
  );
}

import { type OptIrProductionPassScheduleEntry } from "../policy/pass-order-policy";
import { appendPipelineDecision, stateChanged, verifyPipelineState } from "./pipeline-state";
import type { OptIrPassContext } from "./pass-execution";
import {
  runCleanupCluster,
  runCfgSimplificationStep,
  runCopyPropagationStep,
  runDeadCodeEliminationStep,
  runFactGatedEGraphStep,
  runGvnStep,
  runLoopVectorizationStep,
  runMandatoryInliningCluster,
  runScalarReplacementStep,
  runScalarSimplificationStep,
  runSccpStep,
  runSlpVectorizationStep,
  runStackPromotionStep,
  runLicmStep,
  runVectorIdiomPrepStep,
  runVectorizationCleanupStep,
  runWholeProgramInliningStep,
  runWholeProgramSpecializationStep,
  runWrelaCluster,
} from "./pipeline-steps";
import {
  runDeadStoreEliminationStep,
  runLoadStoreForwardingStep,
  runMemorySsaAnalysisStep,
} from "./pipeline-memory-steps";
import {
  isPipelineError,
  type OptimizeOptIrInput,
  type PipelineState,
  type PipelineStepResult,
} from "./pipeline-types";
import { pipelineErrorDiagnostic } from "./pipeline-diagnostics";

export function runPipelineEntry(
  state: PipelineState,
  input: OptimizeOptIrInput,
  entry: OptIrProductionPassScheduleEntry,
  options: {
    readonly decisionAlreadyAppended?: boolean;
    readonly context?: OptIrPassContext;
  } = {},
): PipelineStepResult {
  const passId = String(entry.passId);
  let next =
    options.decisionAlreadyAppended === true
      ? state
      : appendPipelineDecision(state, entry, "accepted", "pipeline:ran", "none");

  switch (passId) {
    case "construction-cleanup":
    case "post-mandatory-cleanup":
    case "final-cleanup":
      next = runCleanupCluster(next);
      break;
    case "mandatory-semantic-inlining":
      if (input.policy.enableMandatoryInlining) {
        const mandatoryInlining = runMandatoryInliningCluster(next);
        if (isPipelineError(mandatoryInlining)) {
          return mandatoryInlining;
        }
        next = mandatoryInlining;
      } else {
        next = appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      }
      break;
    case "whole-program-inlining":
      if (options.context === undefined) {
        return {
          kind: "error",
          diagnostics: [
            pipelineErrorDiagnostic(
              "opt-ir-optimization",
              "whole-program-inlining",
              "pass-context-missing:whole-program-inlining",
            ),
          ],
        };
      }
      next = runWholeProgramInliningStep(next, options.context);
      break;
    case "whole-program-specialization":
      next = input.policy.enableWholeProgramSpecialization
        ? runWholeProgramSpecializationStep(next)
        : appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      break;
    case "sccp-cleanup":
    case "sccp":
      next = runSccpStep(next);
      break;
    case "constant-folding":
      next = runScalarSimplificationStep(next);
      break;
    case "dce":
      next = runDeadCodeEliminationStep(next);
      break;
    case "gvn":
      next = runGvnStep(next);
      break;
    case "copy-propagation":
      next = runCopyPropagationStep(next);
      break;
    case "cfg-simplification":
      next = runCfgSimplificationStep(next);
      break;
    case "memory-ssa": {
      const memorySsa = runMemorySsaAnalysisStep(next);
      if (isPipelineError(memorySsa)) {
        return memorySsa;
      }
      next = memorySsa;
      break;
    }
    case "load-store-forwarding":
      next = runLoadStoreForwardingStep(next);
      break;
    case "dead-store-elimination":
      next = runDeadStoreEliminationStep(next);
      break;
    case "scalar-replacement":
      next = runScalarReplacementStep(next);
      break;
    case "stack-promotion":
      next = runStackPromotionStep(next);
      break;
    case "licm":
      if (options.context === undefined) {
        return {
          kind: "error",
          diagnostics: [
            pipelineErrorDiagnostic("opt-ir-optimization", "licm", "pass-context-missing:licm"),
          ],
        };
      }
      next = runLicmStep(next, options.context);
      break;
    case "wrela-fact-rounds":
      next = runWrelaCluster(next, input.target);
      break;
    case "fact-gated-egraph":
      next = input.policy.enableFactGatedRewrites
        ? runFactGatedEGraphStep(next)
        : appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      break;
    case "vector-idiom-prep":
      next = runVectorIdiomPrepStep(next);
      break;
    case "slp-vectorization":
      next = input.policy.enableVectorization
        ? runSlpVectorizationStep(next, input.target)
        : appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      break;
    case "certified-loop-vectorization":
      next = input.policy.enableVectorization
        ? runLoopVectorizationStep(next, input.target)
        : appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      break;
    case "vector-cleanup":
      next = input.policy.enableVectorization
        ? runVectorizationCleanupStep(next)
        : appendPipelineDecision(next, entry, "denied", "policy:disabled", "conservative");
      break;
    case "final-verification":
      return verifyPipelineState(next, { kind: "before-target-lowering", passId });
  }

  if (passId === "mandatory-semantic-inlining") {
    return verifyPipelineState(next, { kind: "after-mandatory-inlining", passId });
  }
  if (entry.stageId === "scope-expansion-fixpoint") {
    const verifiedMutation = stateChanged(state, next)
      ? verifyPipelineState(next, { kind: "after-scope-expansion-mutation", passId })
      : next;
    if (isPipelineError(verifiedMutation)) return verifiedMutation;
    return verifyPipelineState(verifiedMutation, { kind: "after-scope-expansion-cluster", passId });
  }
  if (entry.stageId === "scalar-simplification-fixpoint") {
    return verifyPipelineState(next, { kind: "after-scalar-simplification-cluster", passId });
  }
  if (entry.stageId === "memory-region-optimization") {
    return verifyPipelineState(next, { kind: "after-memory-region-cluster", passId });
  }
  if (entry.stageId === "wrela-fact-rounds-fixpoint") {
    return verifyPipelineState(next, { kind: "after-wrela-cluster", passId });
  }
  if (entry.stageId === "fact-gated-egraph") {
    return verifyPipelineState(next, { kind: "after-fact-gated-egraph", passId });
  }
  if (entry.stageId === "vectorization") {
    return verifyPipelineState(next, { kind: "after-vectorization-cluster", passId });
  }
  if (entry.stageId === "final-cleanup-fixpoint") {
    return verifyPipelineState(next, { kind: "after-final-cleanup", passId });
  }
  return next;
}

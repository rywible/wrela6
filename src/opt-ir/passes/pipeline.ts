import { targetId } from "../../semantic/ids";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import { optIrFactId, type OptIrFactId, type OptIrOperationId, type OptIrValueId } from "../ids";
import type { OptIrFactSet } from "../facts/fact-index";
import type { OptIrOperation } from "../operations";
import {
  optIrFunctionTable,
  optIrProgram,
  type OptIrFunction,
  type OptIrProgram,
} from "../program";
import type { OptIrRegion } from "../regions";
import type { OptIrTargetSurface } from "../target-surface";
import { verifyOptIrProgram } from "../verify/structural-verifier";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
  type OptIrDecisionLog,
} from "../policy/decision-log";
import type { OptIrOptimizationPolicy } from "../policy/optimization-profile";
import {
  OPT_IR_PRODUCTION_PASS_SCHEDULE,
  type OptIrProductionPassScheduleEntry,
} from "../policy/pass-order-policy";
import {
  optIrCodeSizeBudget,
  optIrExpansionFuel,
  type OptIrExpansionBudgetInput,
} from "../policy/expansion-budget";
import { optIrDefaultVectorPolicy } from "../policy/vector-policy";
import { runMandatoryInlining } from "./mandatory-inlining";
import { runWholeProgramInlining } from "./whole-program-inlining";
import { runWholeProgramSpecialization } from "./whole-program-specialization";
import { runSccp } from "./sccp";
import { runGvn } from "./gvn";
import { runCopyPropagation } from "./copy-propagation";
import { runCfgSimplification } from "./cfg-simplification";
import { runScalarSimplification } from "./scalar-simplification";
import { runDeadCodeElimination } from "./dce";
import { runMemoryOptimization } from "./memory-optimization";
import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import { computeOptIrEscapeAnalysis } from "../analyses/escape-analysis";
import { runScalarReplacement } from "./scalar-replacement";
import { runStackPromotion } from "./stack-promotion";
import { runLicm } from "./licm";
import { runWrelaBoundsZeroCopy } from "./wrela-optimizations/bounds-zero-copy";
import { runWrelaEndianParserCollapse } from "./wrela-optimizations/endian-parser-collapse";
import { runWrelaMoveCopyWrapperElision } from "./wrela-optimizations/move-copy-wrapper-elision";
import { runWrelaTerminalPlatformSpecialization } from "./wrela-optimizations/terminal-platform-specialization";
import { extractOptIrEGraph } from "../egraph/extraction";
import { selectEGraphRegions } from "../egraph/region-selection";
import { defaultOptIrEGraphExtractionPolicy } from "../policy/egraph-extraction-policy";
import { runFactGatedEGraphPass } from "./fact-gated-egraph";
import { runSlpVectorization } from "./slp-vectorization";
import { runLoopVectorization } from "./loop-vectorization";
import { runVectorizationCleanup } from "./vectorization-cleanup";
import {
  discoverBoundsCandidates,
  discoverEGraphRegionCandidates,
  discoverEndianFoldCandidates,
  discoverLoopVectorizationCandidates,
  discoverMoveCopyWrapperCandidates,
  discoverParserCollapseCandidates,
  discoverPlatformSpecializationCandidates,
  discoverScalarReplacementCandidates,
  discoverSlpCandidates,
  discoverSlpScalarOperationIds,
  discoverTerminalCleanupCandidates,
  discoverZeroCopyAccesses,
  firstBlockId,
  hasMemoryAccess,
  nextOperationOrdinal,
  nextValueOrdinal,
  optIrEGraphExtractionPolicyRank,
} from "./pipeline-candidates";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";

export interface OptimizedOptIrProvenanceSnapshot {
  readonly originIds: readonly OptIrProgram["provenance"]["originIds"][number][];
  readonly fingerprint: ProofAuthorityFingerprint;
}

export type OptimizedOptIrProgram = Omit<OptIrProgram, "provenance"> & {
  readonly provenance: OptimizedOptIrProvenanceSnapshot;
  readonly operations?: readonly OptIrOperation[];
  readonly optimizationRegions?: readonly OptIrRegion[];
};

export type OptIrVerifierCheckpointKind =
  | "after-construction"
  | "after-mandatory-inlining"
  | "after-scope-expansion-mutation"
  | "after-scope-expansion-cluster"
  | "after-scalar-simplification-cluster"
  | "after-memory-region-cluster"
  | "after-wrela-cluster"
  | "after-fact-gated-egraph"
  | "after-vectorization-cluster"
  | "after-final-cleanup"
  | "before-target-lowering";

export interface OptIrVerifierCheckpoint {
  readonly kind: OptIrVerifierCheckpointKind;
  readonly passId?: string;
}

export interface OptimizeOptIrInput {
  readonly program: OptIrProgram & {
    readonly operations?: readonly OptIrOperation[];
    readonly optimizationRegions?: readonly OptIrRegion[];
  };
  readonly facts: OptIrFactSet;
  readonly target: OptIrTargetSurface;
  readonly policy: OptIrOptimizationPolicy;
}

export type OptimizeOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: OptimizedOptIrProgram;
      readonly operations: readonly OptIrOperation[];
      readonly facts: OptIrFactSet;
      readonly provenance: OptimizedOptIrProvenanceSnapshot;
      readonly decisionLog: OptIrDecisionLog;
      readonly diagnostics: readonly OptIrDiagnostic[];
      readonly verificationCheckpoints: readonly OptIrVerifierCheckpoint[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

interface PipelineState {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly diagnostics: readonly OptIrDiagnostic[];
  readonly decisionLog: OptIrDecisionLog | undefined;
  readonly verificationCheckpoints: readonly OptIrVerifierCheckpoint[];
}

type PipelineStepResult =
  | PipelineState
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

function isPipelineError(
  result: PipelineStepResult,
): result is { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  return "kind" in result && result.kind === "error";
}

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

export function stableOptimizedOptIrResultKey(result: OptimizeOptIrResult): string {
  if (result.kind === "error") {
    return stableJson({ kind: result.kind, diagnostics: result.diagnostics });
  }
  return stableJson({
    kind: result.kind,
    program: stableProgram(result.program),
    operations: result.operations,
    facts: result.facts,
    provenance: result.provenance,
    decisionLog: result.decisionLog.entries(),
    diagnostics: result.diagnostics,
  });
}

function runPipelineEntry(
  state: PipelineState,
  input: OptimizeOptIrInput,
  entry: OptIrProductionPassScheduleEntry,
): PipelineStepResult {
  const passId = String(entry.passId);
  let next = appendPipelineDecision(state, entry, "accepted", "pipeline:ran", "none");

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
      next = runWholeProgramInliningStep(next);
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
    case "memory-ssa":
      const memorySsa = runMemorySsaAnalysisStep(next);
      if (isPipelineError(memorySsa)) {
        return memorySsa;
      }
      next = memorySsa;
      break;
    case "load-store-forwarding":
      next = runMemoryOptimizationStep(next, "load-store-forwarding");
      break;
    case "dead-store-elimination":
      next = runMemoryOptimizationStep(next, "dead-store-elimination");
      break;
    case "scalar-replacement":
      next = runScalarReplacementStep(next);
      break;
    case "stack-promotion":
      next = runStackPromotionStep(next);
      break;
    case "licm":
      next = runLicmStep(next);
      break;
    case "wrela-fact-rounds":
      next = runWrelaCluster(next);
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

function runMandatoryInliningCluster(state: PipelineState): PipelineStepResult {
  let program = state.program;
  let operations = state.operations;
  let nextFactId = nextFactIdCounter(state.facts);

  for (const operation of operations) {
    if (!isSourceCall(operation)) continue;
    const caller = functionContainingOperation(program, operation.operationId);
    const callee = program.functions
      .entries()
      .find((func) => func.monoInstanceId === operation.target.functionInstanceId);
    if (caller === undefined || callee === undefined) continue;
    const result = runMandatoryInlining({
      caller,
      callee,
      operations,
      facts: [],
      nextFactId,
    });
    if (result.kind === "error") {
      return { kind: "error", diagnostics: result.diagnostics };
    }
    if (result.inlinedCallOperationIds.length === 0) continue;
    program = replaceFunction(program, result.function);
    operations = sortedOperations(result.operations);
    nextFactId = nextFactIdCounter(state.facts);
  }

  return { ...state, program, operations };
}

function runWholeProgramInliningStep(state: PipelineState): PipelineState {
  const result = runWholeProgramInlining({
    program: state.program,
    operations: state.operations,
    budget: defaultScopeExpansionBudget(),
  });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations(result.operations),
    decisionLog: mergeDecisionLogs(state.decisionLog, result.decisionLog),
  };
}

function runWholeProgramSpecializationStep(state: PipelineState): PipelineState {
  const result = runWholeProgramSpecialization({
    program: state.program,
    operations: state.operations,
    budget: defaultScopeExpansionBudget(),
  });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations(result.operations),
    decisionLog: mergeDecisionLogs(state.decisionLog, result.decisionLog),
  };
}

function runSccpStep(state: PipelineState): PipelineState {
  const result = runSccp({ program: state.program, operations: operationMap(state.operations) });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations([...result.operations.values()]),
  };
}

function runCleanupCluster(state: PipelineState): PipelineState {
  return runScalarCleanupCluster(runSccpStep(state));
}

function runScalarCleanupCluster(state: PipelineState): PipelineState {
  let next = runGvnStep(state);
  next = runCopyPropagationStep(next);
  next = runCfgSimplificationStep(next);
  next = runScalarSimplificationStep(next);
  return runDeadCodeEliminationStep(next);
}

function runGvnStep(state: PipelineState): PipelineState {
  const result = runGvn({ program: state.program, operations: operationMap(state.operations) });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations([...result.operations.values()]),
  };
}

function runCopyPropagationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runCopyPropagation({ function: func, operations }),
  );
}

function runCfgSimplificationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runCfgSimplification({ function: func, operations }),
  );
}

function runScalarSimplificationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runScalarSimplification({ function: func, operations }),
  );
}

function runDeadCodeEliminationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runDeadCodeElimination({ function: func, operations }),
  );
}

function runMemorySsaAnalysisStep(state: PipelineState): PipelineStepResult {
  const result = buildOptIrMemorySsa({
    program: state.program,
    regions: optimizationRegionsForProgram(state.program),
    operationForId(operationId) {
      return operationMap(state.operations).get(operationId);
    },
  });
  if (result.kind === "error") {
    return {
      ...state,
      diagnostics: [
        ...state.diagnostics,
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "memory-ssa",
          "memory-ssa:conservative-incomplete-call-headers",
        ),
      ],
    };
  }
  return state;
}

function runMemoryOptimizationStep(state: PipelineState, passId: string): PipelineState {
  const result = runMemoryOptimization({
    program: state.program,
    regions: optimizationRegionsForProgram(state.program),
    operations: state.operations,
    operationForId(operationId) {
      return operationMap(state.operations).get(operationId);
    },
  });
  const removed = new Set(result.removedOperationIds);
  const diagnostics = [
    ...state.diagnostics,
    ...result.valueForwards.map((valueForward) =>
      pipelineInfoDiagnostic(
        "opt-ir-optimization",
        passId,
        `memory:value-forward:${Number(valueForward.sourceValue)}:${Number(
          valueForward.replacementValue,
        )}`,
      ),
    ),
    ...result.rewriteRecords.map((record) =>
      pipelineInfoDiagnostic(
        "opt-ir-optimization",
        passId,
        `memory:${record.subject.kind}:${Number(
          record.subject.kind === "operation"
            ? record.subject.operationId
            : record.subject.regionId,
        )}:${record.invariant.kind}`,
      ),
    ),
  ];
  const next = {
    ...state,
    program: removeOperationsFromProgram(result.program, removed),
    operations: sortedOperations(
      state.operations.filter((operation) => !removed.has(operation.operationId)),
    ),
    diagnostics,
  };
  if (result.valueForwards.length === 0) {
    return next;
  }
  return runPerFunctionPass(next, (func, operations) =>
    runCopyPropagation({
      function: func,
      operations,
      valueCopies: result.valueForwards.map(
        (valueForward) => [valueForward.sourceValue, valueForward.replacementValue] as const,
      ),
    }),
  );
}

function runScalarReplacementStep(state: PipelineState): PipelineState {
  const regions = optimizationRegionsForProgram(state.program);
  const result = runScalarReplacement({
    program: state.program,
    regions,
    candidates: discoverScalarReplacementCandidates(state.operations, regions),
  });
  return {
    ...state,
    program: result.program,
    diagnostics: [
      ...state.diagnostics,
      ...result.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "scalar-replacement",
          `scalar-replacement:${record.subject.kind}:${Number(
            record.subject.kind === "operation"
              ? record.subject.operationId
              : record.subject.regionId,
          )}:${record.invariant.kind}`,
        ),
      ),
    ],
  };
}

function runStackPromotionStep(state: PipelineState): PipelineState {
  const regions = optimizationRegionsForProgram(state.program);
  const escape = computeOptIrEscapeAnalysis({ regions });
  const result = runStackPromotion({
    program: state.program,
    regions,
    lifetimeFacts: regions.map((region) => ({
      regionId: region.regionId,
      valid: region.kind === "stackLocal" && region.lifetime === "activation",
    })),
    escapedRegionIds: escape.escapedRegions(),
  });
  return {
    ...state,
    program: result.program,
    diagnostics: [
      ...state.diagnostics,
      ...result.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "stack-promotion",
          `stack-promotion:${record.subject.kind}:${Number(
            record.subject.kind === "operation"
              ? record.subject.operationId
              : record.subject.regionId,
          )}:${record.invariant.kind}`,
        ),
      ),
    ],
  };
}

function runLicmStep(state: PipelineState): PipelineState {
  const memoryOperationIds = new Set(
    state.operations
      .filter(hasMemoryAccess)
      .filter((operation) => operation.kind === "memoryLoad")
      .map((operation) => operation.operationId),
  );
  const result = runLicm({
    program: state.program,
    operations: state.operations,
    loopOperationIds: operationsInProgramOrder(state.program, state.operations).map(
      (operation) => operation.operationId,
    ),
    effectBoundaryOperationIds: state.operations
      .filter((operation) => !operation.effects.isRuntimePure)
      .map((operation) => operation.operationId),
    regionSafeOperationIds: [...memoryOperationIds],
  });
  return {
    ...state,
    program: result.program,
    diagnostics: [
      ...state.diagnostics,
      ...result.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "licm",
          `licm:${record.subject.kind}:${Number(
            record.subject.kind === "operation"
              ? record.subject.operationId
              : record.subject.regionId,
          )}:${record.invariant.kind}`,
        ),
      ),
    ],
  };
}

function runWrelaCluster(state: PipelineState): PipelineState {
  const bounds = runWrelaBoundsZeroCopy({
    operations: state.operations,
    candidates: discoverBoundsCandidates(state.operations),
    zeroCopyAccessOperationIds: discoverZeroCopyAccesses(state.operations),
  });
  const endian = runWrelaEndianParserCollapse({
    operations: bounds.operations,
    endianFoldCandidates: discoverEndianFoldCandidates(bounds.operations),
    parserCollapseCandidates: discoverParserCollapseCandidates(bounds.operations),
    targetContract: {
      permitsFirmwareEndianFold: false,
      permitsVolatileEndianFold: false,
    },
  });
  const moveCopy = runWrelaMoveCopyWrapperElision({
    operations: endian.operations,
    candidates: discoverMoveCopyWrapperCandidates(endian.operations),
  });
  const terminal = runWrelaTerminalPlatformSpecialization({
    operations: moveCopy.operations,
    terminalCleanupCandidates: discoverTerminalCleanupCandidates(moveCopy.operations),
    platformSpecializationCandidates: discoverPlatformSpecializationCandidates(moveCopy.operations),
  });
  const operations = sortedOperations(terminal.operations);
  const program = removeOperationsFromProgram(
    state.program,
    removedOperationIdsBetween(state.operations, operations),
  );
  return {
    ...state,
    program,
    operations,
    diagnostics: [
      ...state.diagnostics,
      ...bounds.explanations.map(wrelaBoundsDiagnostic),
      ...endian.explanations.map(wrelaEndianDiagnostic),
      ...moveCopy.explanations.map(wrelaMoveCopyDiagnostic),
      ...terminal.explanations.map(wrelaTerminalDiagnostic),
    ],
  };
}

function runFactGatedEGraphStep(state: PipelineState): PipelineState {
  const regions = selectEGraphRegions({
    candidates: discoverEGraphRegionCandidates(state.program, state.operations),
  });
  const validateProgram = (program: OptIrProgram) =>
    verifyOptIrProgram({
      program,
      operations: operationMap(state.operations),
      options: { checkDominance: true, recomputeOperationMetadata: true },
    });
  const result = runFactGatedEGraphPass<OptIrProgram, OptIrProgram>({
    original: state.program,
    extraction: extractOptIrEGraph<OptIrProgram, OptIrProgram>({
      original: state.program,
      candidates: regions.map((region) => ({
        extracted: state.program,
        regionId: region.regionId,
        stableRootOperationId: region.rootOperationId,
        policyRank: optIrEGraphExtractionPolicyRank(0),
        uncertaintyPenalty: 0,
        appliedRuleIds: [`identity-region:${region.kind}`],
      })),
      policy: defaultOptIrEGraphExtractionPolicy(),
      tracingEnabled: false,
    }),
    validateTranslation: () => ({ kind: "passed", inputSet: [] }),
    validators: {
      structural: validateProgram,
      effect: validateProgram,
      dominance: validateProgram,
      fact: validateProgram,
      rewriteLegality: validateProgram,
    },
    tracingEnabled: false,
  });
  return result.kind === "changed" ? { ...state, program: result.optIr } : state;
}

function runSlpVectorizationStep(state: PipelineState, target: OptIrTargetSurface): PipelineState {
  const policy = optIrDefaultVectorPolicy(target);
  const slp = runSlpVectorization({
    blockId: firstBlockId(state.program),
    scalarOperationIds: discoverSlpScalarOperationIds(state.operations),
    nextOperationId: nextOperationOrdinal(state.operations),
    nextValueId: nextValueOrdinal(state.operations),
    candidates: discoverSlpCandidates(state.operations),
    policy,
  });
  return {
    ...state,
    diagnostics: [
      ...state.diagnostics,
      ...slp.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "slp-vectorization",
          `slp-vectorization:materialization-deferred:${Number(record.vectorOperationId)}:${record.scalarOperationIds.map(Number).join(",")}`,
        ),
      ),
      ...slp.rejections.map((rejection) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "slp-vectorization",
          `slp-vectorization:rejected:${rejection.reason}:${rejection.candidate.idiom}`,
        ),
      ),
    ],
  };
}

function runLoopVectorizationStep(state: PipelineState, target: OptIrTargetSurface): PipelineState {
  const policy = optIrDefaultVectorPolicy(target);
  const loop = runLoopVectorization({
    candidates: discoverLoopVectorizationCandidates(state.program, state.operations, target),
    policy,
  });
  return {
    ...state,
    diagnostics: [
      ...state.diagnostics,
      ...loop.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "certified-loop-vectorization",
          `loop-vectorization:materialization-deferred:${record.loopId}:${record.vectorOperationIds.map(Number).join(",")}`,
        ),
      ),
      ...loop.rejections.map((rejection) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "certified-loop-vectorization",
          `loop-vectorization:rejected:${rejection.reason}:${rejection.candidate.loopId}`,
        ),
      ),
    ],
  };
}

function runVectorIdiomPrepStep(state: PipelineState): PipelineState {
  return {
    ...state,
    diagnostics:
      discoverSlpCandidates(state.operations).length === 0
        ? state.diagnostics
        : [
            ...state.diagnostics,
            pipelineInfoDiagnostic(
              "opt-ir-optimization",
              "vector-idiom-prep",
              `vector-idiom-prep:candidates:${discoverSlpCandidates(state.operations).length}`,
            ),
          ],
  };
}

function runVectorizationCleanupStep(state: PipelineState): PipelineState {
  const cleanup = runVectorizationCleanup({
    operations: state.operations,
    liveValueIds: liveValueIds(state.program),
  });
  return { ...state, operations: sortedOperations(cleanup.operations) };
}

function operationsInProgramOrder(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  const byId = operationMap(operations);
  return program.functions
    .entries()
    .flatMap((function_) =>
      function_.blocks.flatMap((block) =>
        block.operations
          .map((operationId) => byId.get(operationId))
          .filter((operation): operation is OptIrOperation => operation !== undefined),
      ),
    );
}

function removeOperationsFromProgram(
  program: OptIrProgram,
  removed: ReadonlySet<OptIrOperationId>,
): OptIrProgram {
  if (removed.size === 0) {
    return program;
  }
  return optIrProgram({
    ...program,
    functions: optIrFunctionTable(
      program.functions.entries().map((function_) => ({
        ...function_,
        blocks: function_.blocks.map((block) => ({
          ...block,
          operations: block.operations.filter((operationId) => !removed.has(operationId)),
        })),
      })),
    ),
  });
}

function removedOperationIdsBetween(
  before: readonly OptIrOperation[],
  after: readonly OptIrOperation[],
): ReadonlySet<OptIrOperationId> {
  const afterIds = new Set(after.map((operation) => operation.operationId));
  return new Set(
    before
      .map((operation) => operation.operationId)
      .filter((operationId) => !afterIds.has(operationId)),
  );
}

function runPerFunctionPass<
  Result extends {
    readonly function: OptIrFunction;
    readonly operations: readonly OptIrOperation[];
  },
>(
  state: PipelineState,
  pass: (func: OptIrFunction, operations: ReadonlyMap<OptIrOperationId, OptIrOperation>) => Result,
): PipelineState {
  const currentOperations = operationMap(state.operations);
  const functions: OptIrFunction[] = [];
  const operations: OptIrOperation[] = [];
  for (const func of state.program.functions.entries()) {
    const result = pass(func, currentOperations);
    functions.push(result.function);
    operations.push(...result.operations);
  }
  return {
    ...state,
    program: optIrProgram({ ...state.program, functions: optIrFunctionTable(functions) }),
    operations: sortedOperations(operations),
  };
}

function verifyPipelineState(
  state: PipelineState,
  checkpoint: OptIrVerifierCheckpoint,
): PipelineStepResult {
  const result = verifyOptIrProgram({
    program: state.program,
    operations: operationMap(state.operations),
    options: { checkDominance: true, recomputeOperationMetadata: true },
  });
  if (result.kind === "error") {
    return { kind: "error", diagnostics: result.diagnostics };
  }
  return {
    ...state,
    verificationCheckpoints: [...state.verificationCheckpoints, Object.freeze(checkpoint)],
  };
}

function appendPipelineDecision(
  state: PipelineState,
  entry: OptIrProductionPassScheduleEntry,
  policyResult: Parameters<typeof optIrDecisionLogEntry>[0]["policyResult"],
  stableReason: string,
  uncertainty: Parameters<typeof optIrDecisionLogEntry>[0]["uncertainty"],
): PipelineState {
  return {
    ...state,
    decisionLog: appendOptIrDecisionLogEntry(
      state.decisionLog,
      optIrDecisionLogEntry({
        candidateKey: `pipeline:${String(entry.order).padStart(2, "0")}:${String(entry.passId)}`,
        policyResult,
        factsUsed: [],
        uncertainty,
        stableReason,
      }),
    ),
  };
}

function mergeDecisionLogs(
  left: OptIrDecisionLog | undefined,
  right: OptIrDecisionLog,
): OptIrDecisionLog | undefined {
  let output = left;
  for (const entry of right.entries()) {
    output = appendOptIrDecisionLogEntry(output, entry);
  }
  return output;
}

function withOptimizedProvenance(
  program: OptIrProgram,
  decisionLog: OptIrDecisionLog,
  operations: readonly OptIrOperation[],
  regions: readonly OptIrRegion[],
): OptimizedOptIrProgram {
  const snapshot = snapshotProvenance(program.provenance.originIds, decisionLog);
  return {
    ...program,
    provenance: snapshot,
    operations: sortedOperations(operations),
    optimizationRegions: Object.freeze(
      [...regions].sort((left, right) => left.regionId - right.regionId),
    ),
  };
}

function snapshotProvenance(
  originIds: readonly OptIrProgram["provenance"]["originIds"][number][],
  decisionLog: OptIrDecisionLog,
): OptimizedOptIrProvenanceSnapshot {
  const sortedOriginIds = Object.freeze([...originIds].sort((left, right) => left - right));
  return Object.freeze({
    originIds: sortedOriginIds,
    fingerprint: {
      authorityKind: "semantics" as const,
      targetId: targetId("opt-ir-provenance"),
      version: "opt-ir-optimization-v1",
      digestAlgorithm: "sha256" as const,
      digestHex: stableDigestHex({
        originIds: sortedOriginIds,
        decisionLog: decisionLog.entries(),
      }),
    },
  });
}

function rejectExternalProvenance(input: OptimizeOptIrInput): OptIrDiagnostic | undefined {
  const keys = new Set(Object.keys(input as unknown as Record<string, unknown>));
  for (const key of ["provenance", "provenanceMap", "externalProvenance", "previousProvenance"]) {
    if (keys.has(key)) {
      return pipelineErrorDiagnostic(
        "opt-ir-optimization",
        "external-provenance",
        `stale-external-provenance:${key}`,
      );
    }
  }
  return undefined;
}

function replaceFunction(program: OptIrProgram, functionOutput: OptIrFunction): OptIrProgram {
  return optIrProgram({
    ...program,
    functions: optIrFunctionTable(
      program.functions
        .entries()
        .map((func) => (func.functionId === functionOutput.functionId ? functionOutput : func)),
    ),
  });
}

function functionContainingOperation(
  program: OptIrProgram,
  operationId: OptIrOperationId,
): OptIrFunction | undefined {
  return program.functions
    .entries()
    .find((func) => func.blocks.some((block) => block.operations.includes(operationId)));
}

function isSourceCall(operation: OptIrOperation): operation is OptIrOperation & {
  readonly target: {
    readonly kind: "source";
    readonly functionInstanceId: OptIrFunction["monoInstanceId"];
  };
} {
  return (
    operation.kind === "sourceCall" && "target" in operation && operation.target.kind === "source"
  );
}

function operationMap(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function sortedOperations(operations: readonly OptIrOperation[]): readonly OptIrOperation[] {
  return Object.freeze([...operations].sort((left, right) => left.operationId - right.operationId));
}

function stateChanged(left: PipelineState, right: PipelineState): boolean {
  return (
    stableJson(stableProgram(left.program)) !== stableJson(stableProgram(right.program)) ||
    stableJson(left.operations) !== stableJson(right.operations)
  );
}

function liveValueIds(program: OptIrProgram) {
  const valueIds: OptIrValueId[] = [];
  for (const func of program.functions.entries()) {
    for (const block of func.blocks) {
      if (block.terminator?.kind === "return") {
        valueIds.push(...block.terminator.values);
      }
    }
  }
  return Object.freeze(valueIds);
}

function optimizationRegionsForProgram(
  program: OptIrProgram & { readonly optimizationRegions?: readonly OptIrRegion[] },
): readonly OptIrRegion[] {
  return program.optimizationRegions ?? [];
}

function nextFactIdCounter(facts: OptIrFactSet): () => OptIrFactId {
  let next = facts.records.reduce((maximum, fact) => Math.max(maximum, Number(fact.factId)), 0) + 1;
  return () => {
    const factId = optIrFactId(next);
    next += 1;
    return factId;
  };
}

function defaultScopeExpansionBudget(): OptIrExpansionBudgetInput {
  return {
    perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 256),
    perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 512),
    perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 2048),
    fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 256),
  };
}

function emptyDecisionLog(): OptIrDecisionLog {
  return Object.freeze({ entries: () => [] });
}

function pipelineErrorDiagnostic(
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  return pipelineDiagnostic("error", ownerKey, rootCauseKey, stableDetail);
}

function pipelineInfoDiagnostic(
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  return pipelineDiagnostic("info", ownerKey, rootCauseKey, stableDetail);
}

function wrelaBoundsDiagnostic(
  explanation: ReturnType<typeof runWrelaBoundsZeroCopy>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "boundsCheckEliminated" ? "removed bounds check" : "zero copy access",
    factChain: explanation.factChain,
  });
}

function wrelaEndianDiagnostic(
  explanation: ReturnType<typeof runWrelaEndianParserCollapse>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${explanation.operationId ?? "parser-state"}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "endianFolded" ? "folded endian decode" : "removed parser state",
    factChain: explanation.factChain,
  });
}

function wrelaMoveCopyDiagnostic(
  explanation: ReturnType<typeof runWrelaMoveCopyWrapperElision>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "copyEliminated" ? "removed copy helper" : "removed wrapper",
    factChain: explanation.factChain,
  });
}

function wrelaTerminalDiagnostic(
  explanation: ReturnType<typeof runWrelaTerminalPlatformSpecialization>["explanations"][number],
): OptIrDiagnostic {
  return wrelaDiagnostic({
    ownerKey: `operation:${Number(explanation.operationId)}`,
    rootCauseKey: explanation.kind,
    messageTemplate:
      explanation.kind === "terminalCleanupPruned"
        ? "removed terminal cleanup"
        : "specialized platform call",
    factChain: explanation.factChain,
  });
}

function wrelaDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly messageTemplate: string;
  readonly factChain: readonly string[];
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const stableDetail = `provenance:wrela;facts:${input.factChain.join(">")}`;
  return {
    severity: "info",
    code,
    messageTemplate: input.messageTemplate,
    arguments: {},
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail,
    }),
  };
}

function pipelineDiagnostic(
  severity: OptIrDiagnostic["severity"],
  ownerKey: string,
  rootCauseKey: string,
  stableDetail: string,
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  return {
    severity,
    code,
    messageTemplate: stableDetail,
    arguments: {},
    ownerKey,
    rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}

function stableProgram(program: OptIrProgram) {
  return {
    programId: program.programId,
    targetId: program.targetId,
    functions: program.functions.entries().map((func) => ({
      ...func,
      edges: func.edges.entries(),
    })),
    regions: program.regions.entries(),
    constants: program.constants.entries(),
    callGraph: program.callGraph,
    provenance: program.provenance,
  };
}

function stableDigestHex(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableJson(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(8);
}

function stableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => stableJson(left[0]).localeCompare(stableJson(right[0])));
  }
  if (Array.isArray(value)) return value.map(toStableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }
  return value;
}

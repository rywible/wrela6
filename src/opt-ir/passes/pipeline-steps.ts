import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import { computeOptIrEscapeAnalysis } from "../analyses/escape-analysis";
import { extractOptIrEGraph } from "../egraph/extraction";
import { selectEGraphRegions } from "../egraph/region-selection";
import { defaultOptIrEGraphExtractionPolicy } from "../policy/egraph-extraction-policy";
import { optIrDefaultVectorPolicy } from "../policy/vector-policy";
import type { OptIrProgram } from "../program";
import type { OptIrTargetSurface } from "../target-surface";
import { verifyOptIrProgram } from "../verify/structural-verifier";
import { runCfgSimplification } from "./cfg-simplification";
import { runCopyPropagation } from "./copy-propagation";
import { runDeadCodeElimination } from "./dce";
import { runFactGatedEGraphPass } from "./fact-gated-egraph";
import { runGvn } from "./gvn";
import { runLicm } from "./licm";
import { runLoopVectorization } from "./loop-vectorization";
import { runMandatoryInlining } from "./mandatory-inlining";
import { runMemoryOptimization } from "./memory-optimization";
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
import {
  pipelineInfoDiagnostic,
  wrelaBoundsDiagnostic,
  wrelaEndianDiagnostic,
  wrelaMoveCopyDiagnostic,
  wrelaTerminalDiagnostic,
} from "./pipeline-diagnostics";
import {
  defaultScopeExpansionBudget,
  functionContainingOperation,
  isSourceCall,
  liveValueIds,
  mergeDecisionLogs,
  nextFactIdCounter,
  operationMap,
  operationsInProgramOrder,
  optimizationRegionsForProgram,
  removeOperationsFromProgram,
  removedOperationIdsBetween,
  replaceFunction,
  runPerFunctionPass,
  sortedOperations,
} from "./pipeline-state";
import type { PipelineState, PipelineStepResult } from "./pipeline-types";
import { runScalarReplacement } from "./scalar-replacement";
import { runScalarSimplification } from "./scalar-simplification";
import { runSccp } from "./sccp";
import { runSlpVectorization } from "./slp-vectorization";
import { runStackPromotion } from "./stack-promotion";
import { runVectorizationCleanup } from "./vectorization-cleanup";
import { runWholeProgramInlining } from "./whole-program-inlining";
import { runWholeProgramSpecialization } from "./whole-program-specialization";
import { runWrelaBoundsZeroCopy } from "./wrela-optimizations/bounds-zero-copy";
import { runWrelaEndianParserCollapse } from "./wrela-optimizations/endian-parser-collapse";
import { runWrelaMoveCopyWrapperElision } from "./wrela-optimizations/move-copy-wrapper-elision";
import { runWrelaTerminalPlatformSpecialization } from "./wrela-optimizations/terminal-platform-specialization";

export function runMandatoryInliningCluster(state: PipelineState): PipelineStepResult {
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

export function runWholeProgramInliningStep(state: PipelineState): PipelineState {
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

export function runWholeProgramSpecializationStep(state: PipelineState): PipelineState {
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

export function runSccpStep(state: PipelineState): PipelineState {
  const result = runSccp({ program: state.program, operations: operationMap(state.operations) });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations([...result.operations.values()]),
  };
}

export function runCleanupCluster(state: PipelineState): PipelineState {
  return runScalarCleanupCluster(runSccpStep(state));
}

export function runScalarCleanupCluster(state: PipelineState): PipelineState {
  let next = runGvnStep(state);
  next = runCopyPropagationStep(next);
  next = runCfgSimplificationStep(next);
  next = runScalarSimplificationStep(next);
  return runDeadCodeEliminationStep(next);
}

export function runGvnStep(state: PipelineState): PipelineState {
  const result = runGvn({ program: state.program, operations: operationMap(state.operations) });
  return {
    ...state,
    program: result.program,
    operations: sortedOperations([...result.operations.values()]),
  };
}

export function runCopyPropagationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runCopyPropagation({ function: func, operations }),
  );
}

export function runCfgSimplificationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runCfgSimplification({ function: func, operations }),
  );
}

export function runScalarSimplificationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runScalarSimplification({ function: func, operations }),
  );
}

export function runDeadCodeEliminationStep(state: PipelineState): PipelineState {
  return runPerFunctionPass(state, (func, operations) =>
    runDeadCodeElimination({ function: func, operations }),
  );
}

export function runMemorySsaAnalysisStep(state: PipelineState): PipelineStepResult {
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

export function runMemoryOptimizationStep(state: PipelineState, passId: string): PipelineState {
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

export function runScalarReplacementStep(state: PipelineState): PipelineState {
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

export function runStackPromotionStep(state: PipelineState): PipelineState {
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

export function runLicmStep(state: PipelineState): PipelineState {
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

export function runWrelaCluster(state: PipelineState): PipelineState {
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

export function runFactGatedEGraphStep(state: PipelineState): PipelineState {
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

export function runSlpVectorizationStep(
  state: PipelineState,
  target: OptIrTargetSurface,
): PipelineState {
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

export function runLoopVectorizationStep(
  state: PipelineState,
  target: OptIrTargetSurface,
): PipelineState {
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

export function runVectorIdiomPrepStep(state: PipelineState): PipelineState {
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

export function runVectorizationCleanupStep(state: PipelineState): PipelineState {
  const cleanup = runVectorizationCleanup({
    operations: state.operations,
    liveValueIds: liveValueIds(state.program),
  });
  return { ...state, operations: sortedOperations(cleanup.operations) };
}

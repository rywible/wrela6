import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import { computeOptIrEscapeAnalysis } from "../analyses/escape-analysis";
import { hasMemoryAccess } from "../operation-access";
import { optIrFunctionTable, optIrProgram } from "../program";
import { optIrDefaultVectorPolicy } from "../policy/vector-policy";
import type { OptIrTargetSurface } from "../target-surface";
import { runCfgSimplification } from "./cfg-simplification";
import { runCopyPropagation } from "./copy-propagation";
import { runDeadCodeElimination } from "./dce";
import {
  runOptIrFactGatedEGraphMaterialization,
  OPT_IR_FACT_GATED_EGRAPH_WORKLIST_LIMIT,
} from "./egraph-materialization";
import { runGvn } from "./gvn";
import { runLicm } from "./licm";
import { runLoopVectorization } from "./loop-vectorization";
import { runMandatoryInlining } from "./mandatory-inlining";
import { runMemoryOptimization } from "./memory-optimization";
import {
  discoverBoundsCandidates,
  discoverEndianFoldCandidates,
  discoverLoopVectorizationCandidates,
  discoverMoveCopyWrapperCandidates,
  discoverParserCollapseCandidates,
  discoverPlatformSpecializationCandidates,
  discoverScalarReplacementCandidates,
  discoverSlpCandidates,
  discoverTerminalCleanupCandidates,
  discoverZeroCopyAccesses,
  nextOperationOrdinal,
  nextValueOrdinal,
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
  runPipelineStepToFixpoint,
  sortedOperations,
} from "./pipeline-state";
import type { PipelineState, PipelineStepResult } from "./pipeline-types";
import { runScalarReplacement } from "./scalar-replacement";
import { runScalarSimplification } from "./scalar-simplification";
import { runSccp } from "./sccp";
import { runSlpVectorization } from "./slp-vectorization";
import { runStackPromotion } from "./stack-promotion";
import { runVectorizationCleanup } from "./vectorization-cleanup";
import {
  materializeLoopVectorization,
  materializeSlpVectorization,
} from "./vector-materialization";
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
  const inlinedCalleeKeys = new Set<string>();

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
    inlinedCalleeKeys.add(String(callee.monoInstanceId));
    program = replaceFunction(program, result.function);
    operations = sortedOperations(result.operations);
    nextFactId = nextFactIdCounter(state.facts);
  }

  const pruned = removeUnreferencedInlinedCallees({ program, operations, inlinedCalleeKeys });
  return { ...state, program: pruned.program, operations: pruned.operations };
}

function removeUnreferencedInlinedCallees(input: {
  readonly program: PipelineState["program"];
  readonly operations: PipelineState["operations"];
  readonly inlinedCalleeKeys: ReadonlySet<string>;
}): Pick<PipelineState, "program" | "operations"> {
  if (input.inlinedCalleeKeys.size === 0) {
    return { program: input.program, operations: input.operations };
  }
  const referencedCalleeKeys = new Set(
    input.operations
      .filter(isSourceCall)
      .map((operation) => String(operation.target.functionInstanceId)),
  );
  const removedOperationIds = new Set(
    input.program.functions
      .entries()
      .filter(
        (function_) =>
          input.inlinedCalleeKeys.has(String(function_.monoInstanceId)) &&
          !referencedCalleeKeys.has(String(function_.monoInstanceId)),
      )
      .flatMap((function_) => function_.blocks.flatMap((block) => block.operations)),
  );
  if (removedOperationIds.size === 0) {
    return { program: input.program, operations: input.operations };
  }
  const functions = input.program.functions
    .entries()
    .filter((function_) =>
      function_.blocks.every((block) =>
        block.operations.every((operationId) => !removedOperationIds.has(operationId)),
      ),
    );
  return {
    program: optIrProgram({ ...input.program, functions: optIrFunctionTable(functions) }),
    operations: sortedOperations(
      input.operations.filter((operation) => !removedOperationIds.has(operation.operationId)),
    ),
  };
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
  return runPipelineStepToFixpoint(
    state,
    (current) => {
      const result = runOptIrFactGatedEGraphMaterialization({
        program: current.program,
        operations: current.operations,
        facts: current.facts,
        tracingEnabled: false,
      });
      if (result.kind !== "changed") {
        return "unchanged";
      }
      return {
        ...current,
        program: result.optIr.program,
        operations: sortedOperations(result.optIr.operations),
      };
    },
    OPT_IR_FACT_GATED_EGRAPH_WORKLIST_LIMIT,
  );
}

export function runSlpVectorizationStep(
  state: PipelineState,
  target: OptIrTargetSurface,
): PipelineState {
  const policy = optIrDefaultVectorPolicy(target);
  const candidates = discoverSlpCandidates({
    program: state.program,
    operations: state.operations,
    facts: state.facts,
  });
  const slp = runSlpVectorization({
    nextOperationId: nextOperationOrdinal(state.operations),
    nextValueId: nextValueOrdinal(state.operations),
    candidates,
    policy,
  });
  const materialized = materializeSlpVectorization({
    program: state.program,
    operations: state.operations,
    slpResult: slp,
  });
  return {
    ...state,
    program: materialized.program,
    operations: sortedOperations(materialized.operations),
    diagnostics: [
      ...state.diagnostics,
      ...materialized.diagnostics,
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
    candidates: discoverLoopVectorizationCandidates({
      program: state.program,
      operations: state.operations,
      facts: state.facts,
      target,
    }),
    policy,
  });
  const materialized = materializeLoopVectorization({
    program: state.program,
    operations: state.operations,
    loopResult: loop,
  });
  return {
    ...state,
    program: materialized.program,
    operations: sortedOperations(materialized.operations),
    diagnostics: [
      ...state.diagnostics,
      ...materialized.diagnostics,
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
  const candidateCount = discoverSlpCandidates({
    program: state.program,
    operations: state.operations,
    facts: state.facts,
  }).length;
  return {
    ...state,
    diagnostics:
      candidateCount === 0
        ? state.diagnostics
        : [
            ...state.diagnostics,
            pipelineInfoDiagnostic(
              "opt-ir-optimization",
              "vector-idiom-prep",
              `vector-idiom-prep:candidates:${candidateCount}`,
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

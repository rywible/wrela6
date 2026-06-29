import { targetId } from "../../semantic/ids";
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
import { verifyOptIrProgram } from "../verify/structural-verifier";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
  type OptIrDecisionLog,
} from "../policy/decision-log";
import type { OptIrProductionPassScheduleEntry } from "../policy/pass-order-policy";
import {
  optIrCodeSizeBudget,
  optIrExpansionFuel,
  type OptIrExpansionBudgetInput,
} from "../policy/expansion-budget";
import { stableDigestHex, stableJson, stableProgram } from "./pipeline-support";
import { pipelineErrorDiagnostic } from "./pipeline-diagnostics";
import type {
  OptimizedOptIrProgram,
  OptimizedOptIrProvenanceSnapshot,
  OptIrVerifierCheckpoint,
  OptimizeOptIrInput,
  PipelineState,
  PipelineStepResult,
} from "./pipeline-types";

export function operationMap(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

export function sortedOperations(operations: readonly OptIrOperation[]): readonly OptIrOperation[] {
  return Object.freeze([...operations].sort((left, right) => left.operationId - right.operationId));
}

export function operationsInProgramOrder(
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

export function removeOperationsFromProgram(
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

export function removedOperationIdsBetween(
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

export function runPerFunctionPass<
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

export function verifyPipelineState(
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

export function appendPipelineDecision(
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

export function mergeDecisionLogs(
  left: OptIrDecisionLog | undefined,
  right: OptIrDecisionLog,
): OptIrDecisionLog | undefined {
  let output = left;
  for (const entry of right.entries()) {
    output = appendOptIrDecisionLogEntry(output, entry);
  }
  return output;
}

export function withOptimizedProvenance(
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

export function snapshotProvenance(
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

export function rejectExternalProvenance(input: OptimizeOptIrInput) {
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

export function replaceFunction(
  program: OptIrProgram,
  functionOutput: OptIrFunction,
): OptIrProgram {
  return optIrProgram({
    ...program,
    functions: optIrFunctionTable(
      program.functions
        .entries()
        .map((func) => (func.functionId === functionOutput.functionId ? functionOutput : func)),
    ),
  });
}

export function functionContainingOperation(
  program: OptIrProgram,
  operationId: OptIrOperationId,
): OptIrFunction | undefined {
  return program.functions
    .entries()
    .find((func) => func.blocks.some((block) => block.operations.includes(operationId)));
}

export function isSourceCall(operation: OptIrOperation): operation is OptIrOperation & {
  readonly target: {
    readonly kind: "source";
    readonly functionInstanceId: OptIrFunction["monoInstanceId"];
  };
} {
  return (
    operation.kind === "sourceCall" && "target" in operation && operation.target.kind === "source"
  );
}

export function stateChanged(left: PipelineState, right: PipelineState): boolean {
  return (
    stableJson(stableProgram(left.program)) !== stableJson(stableProgram(right.program)) ||
    stableJson(left.operations) !== stableJson(right.operations)
  );
}

export function liveValueIds(program: OptIrProgram) {
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

export function optimizationRegionsForProgram(
  program: OptIrProgram & { readonly optimizationRegions?: readonly OptIrRegion[] },
): readonly OptIrRegion[] {
  return program.optimizationRegions ?? [];
}

export function nextFactIdCounter(facts: OptIrFactSet): () => OptIrFactId {
  let next = facts.records.reduce((maximum, fact) => Math.max(maximum, Number(fact.factId)), 0) + 1;
  return () => {
    const factId = optIrFactId(next);
    next += 1;
    return factId;
  };
}

export function defaultScopeExpansionBudget(): OptIrExpansionBudgetInput {
  return {
    perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 256),
    perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 512),
    perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 2048),
    fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 256),
  };
}

export function emptyDecisionLog(): OptIrDecisionLog {
  return Object.freeze({ entries: () => [] });
}

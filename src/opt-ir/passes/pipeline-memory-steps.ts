import { buildOptIrMemorySsa } from "../analyses/memory-ssa";
import { runCopyPropagation } from "./copy-propagation";
import { runDeadStoreElimination, runLoadStoreForwarding } from "./memory-optimization";
import { pipelineInfoDiagnostic } from "./pipeline-diagnostics";
import {
  operationMap,
  removeOperationsFromProgram,
  runPerFunctionPass,
  sortedOperations,
} from "./pipeline-state";
import type { PipelineState, PipelineStepResult } from "./pipeline-types";

export function runMemorySsaAnalysisStep(state: PipelineState): PipelineStepResult {
  const result = buildOptIrMemorySsa({
    program: state.program,
    regions: state.optimizationRegions,
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

export function runLoadStoreForwardingStep(state: PipelineState): PipelineState {
  const result = runLoadStoreForwarding({
    program: state.program,
    regions: state.optimizationRegions,
    operations: state.operations,
    operationForId(operationId) {
      return operationMap(state.operations).get(operationId);
    },
  });
  const removed = new Set(result.removedOperationIds);
  const diagnostics = [
    ...state.diagnostics,
    ...result.diagnostics,
    ...result.valueForwards.map((valueForward) =>
      pipelineInfoDiagnostic(
        "opt-ir-optimization",
        "load-store-forwarding",
        `memory:value-forward:${Number(valueForward.sourceValue)}:${Number(
          valueForward.replacementValue,
        )}`,
      ),
    ),
    ...result.rewriteRecords.map((record) =>
      pipelineInfoDiagnostic(
        "opt-ir-optimization",
        "load-store-forwarding",
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

export function runDeadStoreEliminationStep(state: PipelineState): PipelineState {
  const result = runDeadStoreElimination({
    program: state.program,
    regions: state.optimizationRegions,
    operations: state.operations,
    operationForId(operationId) {
      return operationMap(state.operations).get(operationId);
    },
  });
  const removed = new Set(result.removedOperationIds);
  return {
    ...state,
    program: removeOperationsFromProgram(result.program, removed),
    operations: sortedOperations(
      state.operations.filter((operation) => !removed.has(operation.operationId)),
    ),
    diagnostics: [
      ...state.diagnostics,
      ...result.diagnostics,
      ...result.rewriteRecords.map((record) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "dead-store-elimination",
          `memory:${record.subject.kind}:${Number(
            record.subject.kind === "operation"
              ? record.subject.operationId
              : record.subject.regionId,
          )}:${record.invariant.kind}`,
        ),
      ),
    ],
  };
}

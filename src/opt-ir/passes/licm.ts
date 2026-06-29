import type { OptIrOperationId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrMemoryRewriteRecord } from "./memory-optimization";

export interface OptIrLicmInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly loopOperationIds: readonly OptIrOperationId[];
  readonly effectBoundaryOperationIds: readonly OptIrOperationId[];
  readonly regionSafeOperationIds?: readonly OptIrOperationId[];
}

export interface OptIrLicmResult {
  readonly program: OptIrProgram;
  readonly movedOperationIds: readonly OptIrOperationId[];
  readonly blockedOperationIds: readonly OptIrOperationId[];
  readonly rewriteRecords: readonly OptIrMemoryRewriteRecord[];
}

export function runLicmForTest(input: OptIrLicmInput): OptIrLicmResult {
  return runLicm(input);
}

export function runLicm(input: OptIrLicmInput): OptIrLicmResult {
  const operations = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const boundaries = new Set(input.effectBoundaryOperationIds);
  const regionSafe = new Set(input.regionSafeOperationIds ?? []);
  const movedOperationIds: OptIrOperationId[] = [];
  const blockedOperationIds: OptIrOperationId[] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];

  for (const operationId of input.loopOperationIds) {
    const operation = operations.get(operationId);
    if (operation === undefined) {
      continue;
    }
    if (boundaries.has(operationId)) {
      blockedOperationIds.push(operationId);
      continue;
    }
    if (operation.effects.isRuntimePure || regionSafe.has(operationId)) {
      movedOperationIds.push(operationId);
      rewriteRecords.push({
        subject: { kind: "operation", operationId },
        invariant: { kind: "effectBoundaryEquivalence" },
      });
    } else {
      blockedOperationIds.push(operationId);
    }
  }

  return { program: input.program, movedOperationIds, blockedOperationIds, rewriteRecords };
}

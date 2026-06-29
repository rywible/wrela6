import type { OptIrOperation } from "../operations";

export interface OptIrEGraphCostVector {
  readonly operationCount: number;
  readonly effectCount: number;
  readonly memoryAccessCount: number;
  readonly callCount: number;
}

export function optIrEGraphCostForOperations(
  operations: readonly OptIrOperation[],
): OptIrEGraphCostVector {
  let effectCount = 0;
  let memoryAccessCount = 0;
  let callCount = 0;

  for (const operation of operations) {
    if (!operation.effects.isRuntimePure) {
      effectCount += 1;
    }
    if ("memoryAccess" in operation) {
      memoryAccessCount += 1;
    }
    if ("callId" in operation) {
      callCount += 1;
    }
  }

  return Object.freeze({
    operationCount: operations.length,
    effectCount,
    memoryAccessCount,
    callCount,
  });
}

export function compareOptIrEGraphCost(
  left: OptIrEGraphCostVector,
  right: OptIrEGraphCostVector,
): number {
  return (
    left.effectCount - right.effectCount ||
    left.memoryAccessCount - right.memoryAccessCount ||
    left.callCount - right.callCount ||
    left.operationCount - right.operationCount
  );
}

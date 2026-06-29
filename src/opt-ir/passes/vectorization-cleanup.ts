import type { OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";

export interface RunVectorizationCleanupInput {
  readonly operations: readonly OptIrOperation[];
  readonly liveValueIds: readonly OptIrValueId[];
}

export interface RunVectorizationCleanupResult {
  readonly operations: readonly OptIrOperation[];
  readonly preservedUnknownVectorValueIds: readonly OptIrValueId[];
}

export function runVectorizationCleanup(
  input: RunVectorizationCleanupInput,
): RunVectorizationCleanupResult {
  const liveValues = new Set(input.liveValueIds);
  const operations = input.operations.filter((operation) => {
    if (operation.kind !== "vectorShuffle") {
      return true;
    }
    return operation.resultIds.some((resultId) => liveValues.has(resultId));
  });
  const definedValues = new Set(input.operations.flatMap((operation) => operation.resultIds));
  const preservedUnknownVectorValueIds = input.operations
    .flatMap((operation) => operation.operandIds)
    .filter((valueId) => !definedValues.has(valueId))
    .sort(compareNumbers);

  return {
    operations: Object.freeze(operations),
    preservedUnknownVectorValueIds: Object.freeze([...new Set(preservedUnknownVectorValueIds)]),
  };
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

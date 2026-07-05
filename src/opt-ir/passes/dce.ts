import { computeOptIrLiveness } from "../analyses/liveness";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";

export interface DeadCodeEliminationInput {
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly liveOutValues?: readonly OptIrValueId[];
  readonly canRemoveOperation?: (operation: OptIrOperation) => boolean;
}

export interface DeadCodeEliminationResult {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly removedOperationIds: readonly OptIrOperationId[];
}

export function runDeadCodeElimination(input: DeadCodeEliminationInput): DeadCodeEliminationResult {
  const survivorIds = new Set<OptIrOperationId>();
  const removedOperationIds: OptIrOperationId[] = [];

  const liveness = computeOptIrLiveness({
    func: input.function,
    operationForId(operationId) {
      return input.operations.get(operationId);
    },
  });

  for (const block of [...input.function.blocks].reverse()) {
    const liveValues = new Set<OptIrValueId>([
      ...liveness.liveOut(block.blockId),
      ...(input.liveOutValues ?? []),
    ]);
    addTerminatorOperands(block.terminator, liveValues);

    for (let index = block.operations.length - 1; index >= 0; index -= 1) {
      const operationId = block.operations[index];
      const operation = operationId === undefined ? undefined : input.operations.get(operationId);
      if (operation === undefined) {
        continue;
      }

      if (shouldKeepOperation(operation, liveValues, input.canRemoveOperation)) {
        survivorIds.add(operation.operationId);
        for (const resultId of operation.resultIds) {
          liveValues.delete(resultId);
        }
        for (const operandId of operation.operandIds) {
          liveValues.add(operandId);
        }
      } else {
        removedOperationIds.push(operation.operationId);
      }
    }
  }
  const blockOperationIds = input.function.blocks.flatMap((block) => block.operations);

  const functionOutput: OptIrFunction = {
    ...input.function,
    blocks: input.function.blocks.map((block) => ({
      ...block,
      operations: block.operations.filter((operationId) => survivorIds.has(operationId)),
    })),
  };

  return {
    function: functionOutput,
    operations: blockOperationIds
      .filter((operationId) => survivorIds.has(operationId))
      .map((operationId) => requireOperation(input.operations, operationId)),
    removedOperationIds: removedOperationIds.reverse(),
  };
}

function shouldKeepOperation(
  operation: OptIrOperation,
  liveValues: ReadonlySet<OptIrValueId>,
  canRemoveOperation: ((operation: OptIrOperation) => boolean) | undefined,
): boolean {
  if (operation.resultIds.some((resultId) => liveValues.has(resultId))) {
    return true;
  }
  if (!isSemanticallyDiscardable(operation)) {
    return true;
  }
  return canRemoveOperation === undefined ? false : !canRemoveOperation(operation);
}

function isSemanticallyDiscardable(operation: OptIrOperation): boolean {
  if (!operation.effects.isRuntimePure) {
    return false;
  }
  if ("memoryAccess" in operation && operation.memoryAccess.volatility === "volatile") {
    return false;
  }
  return true;
}

function addTerminatorOperands(
  terminator: OptIrFunction["blocks"][number]["terminator"],
  liveValues: Set<OptIrValueId>,
): void {
  if (terminator === undefined) {
    return;
  }
  switch (terminator.kind) {
    case "branch":
      liveValues.add(terminator.condition);
      return;
    case "switch":
      liveValues.add(terminator.scrutinee);
      return;
    case "return":
      for (const value of terminator.values) {
        liveValues.add(value);
      }
      return;
    case "jump":
    case "unreachable":
      return;
  }
}

function requireOperation(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.get(operationId);
  if (operation === undefined) {
    throw new RangeError(`Missing OptIR operation ${operationId}.`);
  }
  return operation;
}

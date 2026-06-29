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
  const liveValues = new Set<OptIrValueId>(input.liveOutValues ?? []);
  const survivorIds = new Set<OptIrOperationId>();
  const removedOperationIds: OptIrOperationId[] = [];
  const blockOperationIds = input.function.blocks.flatMap((block) => block.operations);

  for (const block of input.function.blocks) {
    const terminator = block.terminator;
    if (terminator === undefined) {
      continue;
    }
    addTerminatorOperands(terminator, liveValues);
  }
  for (const edge of input.function.edges.entries()) {
    for (const argumentId of edge.arguments) {
      liveValues.add(argumentId);
    }
  }

  for (let index = blockOperationIds.length - 1; index >= 0; index -= 1) {
    const operationId = blockOperationIds[index];
    const operation = operationId === undefined ? undefined : input.operations.get(operationId);
    if (operation === undefined) {
      continue;
    }

    if (shouldKeepOperation(operation, liveValues, input.canRemoveOperation)) {
      survivorIds.add(operation.operationId);
      for (const operandId of operation.operandIds) {
        liveValues.add(operandId);
      }
    } else {
      removedOperationIds.push(operation.operationId);
    }
  }

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

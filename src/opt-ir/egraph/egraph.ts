import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrEGraphClass, type OptIrEGraphClass } from "./equivalence-class";

export interface OptIrEGraphImportEntry {
  readonly operationId: OptIrOperationId;
  readonly operandIds: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
}

export interface OptIrEGraph {
  readonly importOrder: readonly OptIrEGraphImportEntry[];
  readonly classes: readonly OptIrEGraphClass[];
}

export function importOperationsIntoEGraphForTest(
  operations: readonly OptIrOperation[],
): OptIrEGraph {
  return importOperationsIntoEGraph(operations);
}

export function importOperationsIntoEGraph(operations: readonly OptIrOperation[]): OptIrEGraph {
  const importOrder = [...operations].sort(compareOperationsForImport).map((operation) =>
    Object.freeze({
      operationId: operation.operationId,
      operandIds: Object.freeze([...operation.operandIds]),
      resultIds: Object.freeze([...operation.resultIds]),
    }),
  );

  return Object.freeze({
    importOrder: Object.freeze(importOrder),
    classes: Object.freeze(
      importOrder.map((entry, index) =>
        optIrEGraphClass({
          classId: index,
          operationIds: [entry.operationId],
          valueIds: entry.resultIds,
        }),
      ),
    ),
  });
}

function compareOperationsForImport(left: OptIrOperation, right: OptIrOperation): number {
  return (
    compareIdLists(left.operandIds, right.operandIds) ||
    Number(left.operationId) - Number(right.operationId)
  );
}

function compareIdLists(left: readonly number[], right: readonly number[]): number {
  const leftSorted = sortIds(left);
  const rightSorted = sortIds(right);
  const count = Math.min(leftSorted.length, rightSorted.length);
  for (let index = 0; index < count; index += 1) {
    const difference = Number(leftSorted[index]) - Number(rightSorted[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftSorted.length - rightSorted.length;
}

function sortIds<Identifier extends number>(
  identifiers: readonly Identifier[],
): readonly Identifier[] {
  return [...identifiers].sort((left, right) => Number(left) - Number(right));
}

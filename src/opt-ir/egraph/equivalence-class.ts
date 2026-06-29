import type { OptIrOperationId, OptIrValueId } from "../ids";

export interface OptIrEGraphClass {
  readonly classId: number;
  readonly operationIds: readonly OptIrOperationId[];
  readonly valueIds: readonly OptIrValueId[];
}

export function optIrEGraphClass(input: {
  readonly classId: number;
  readonly operationIds?: readonly OptIrOperationId[];
  readonly valueIds?: readonly OptIrValueId[];
}): OptIrEGraphClass {
  return Object.freeze({
    classId: input.classId,
    operationIds: Object.freeze(uniqueSortedNumbers(input.operationIds ?? [])),
    valueIds: Object.freeze(uniqueSortedNumbers(input.valueIds ?? [])),
  });
}

export function mergeOptIrEGraphClasses(
  classId: number,
  classes: readonly OptIrEGraphClass[],
): OptIrEGraphClass {
  return optIrEGraphClass({
    classId,
    operationIds: classes.flatMap((entry) => entry.operationIds),
    valueIds: classes.flatMap((entry) => entry.valueIds),
  });
}

function uniqueSortedNumbers<Identifier extends number>(
  values: readonly Identifier[],
): readonly Identifier[] {
  return [...new Set(values)].sort((left, right) => Number(left) - Number(right));
}

import { optIrIntegerConstant } from "../constants";
import { optIrConstantId } from "../ids";
import { optIrConstantOperation, type OptIrOperation } from "../operations";

export interface LowerZeroSizedResultOperationsResult {
  readonly operations: readonly OptIrOperation[];
  readonly loweredOperationIds: readonly number[];
}

export function lowerZeroSizedResultOperations(input: {
  readonly operations: readonly OptIrOperation[];
}): LowerZeroSizedResultOperationsResult {
  const loweredOperationIds: number[] = [];
  const operations = input.operations.map((operation) => {
    if (!isLowerableZeroSizedResultOperation(operation)) {
      return operation;
    }
    const resultId = operation.resultIds[0];
    const resultType = operation.resultTypes[0];
    if (resultId === undefined || resultType === undefined) {
      return operation;
    }
    loweredOperationIds.push(Number(operation.operationId));
    return optIrConstantOperation({
      operationId: operation.operationId,
      resultId,
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(Number(operation.operationId)),
        type: resultType,
        normalizedValue: 0n,
      }),
      originId: operation.originId,
    });
  });

  return Object.freeze({
    operations: Object.freeze(operations),
    loweredOperationIds: Object.freeze(loweredOperationIds.sort((left, right) => left - right)),
  });
}

function isLowerableZeroSizedResultOperation(operation: OptIrOperation): boolean {
  return (
    (operation.kind === "aggregateConstruct" ||
      operation.kind === "aggregateExtract" ||
      operation.kind === "memoryLoad") &&
    operation.resultTypes.length === 1 &&
    operation.resultTypes.every((type) => type.kind === "zeroSized")
  );
}

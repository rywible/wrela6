import type { OptIrOperationId } from "../ids";
import type { OptIrOperation } from "../operations";

export function operationCanMoveToPreheader(
  operation: OptIrOperation,
  operationId: OptIrOperationId,
  regionSafeOperationIds: ReadonlySet<OptIrOperationId>,
): boolean {
  if (regionSafeOperationIds.has(operationId)) {
    return operation.kind === "memoryLoad";
  }
  return operation.effects.isRuntimePure && operationIsSpeculatable(operation);
}

function operationIsSpeculatable(operation: OptIrOperation): boolean {
  switch (operation.kind) {
    case "constant":
    case "constAddr":
    case "integerCompare":
    case "booleanNot":
    case "booleanBinary":
    case "aggregateConstruct":
    case "aggregateExtract":
    case "aggregateInsert":
    case "layoutOffset":
    case "layoutByteRange":
    case "layoutEndianDecode":
      return true;
    case "integerUnary":
      return operation.operator === "bitwiseNot";
    case "integerBinary":
      return integerBinaryOperatorIsSpeculatable(operation.operator);
    default:
      return false;
  }
}

function integerBinaryOperatorIsSpeculatable(operator: unknown): boolean {
  switch (operator) {
    case "and":
    case "or":
    case "xor":
    case "shiftLeft":
    case "shiftRight":
      return true;
    default:
      return false;
  }
}

import type { OptIrEdge } from "../cfg";
import type { OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import {
  isOptIrSourceValueOperation,
  rewriteOptIrSourceValueOperationOperands,
} from "../source-value-operations";
import type { OptIrTerminator } from "../terminators";

export function rewriteEdgeValues(
  edge: OptIrEdge,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrEdge {
  const argumentsAfterRewrite = edge.arguments.map(
    (argumentId) => substitutions.get(argumentId) ?? argumentId,
  );
  const condition =
    edge.condition === undefined
      ? undefined
      : (substitutions.get(edge.condition) ?? edge.condition);
  if (arraysEqual(argumentsAfterRewrite, edge.arguments) && condition === edge.condition) {
    return edge;
  }
  return {
    ...edge,
    arguments: argumentsAfterRewrite,
    ...(condition === undefined ? {} : { condition }),
  };
}

export function rewriteTerminatorValues(
  terminator: OptIrTerminator,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrTerminator {
  switch (terminator.kind) {
    case "branch":
      return {
        ...terminator,
        condition: substitutions.get(terminator.condition) ?? terminator.condition,
      };
    case "switch":
      return {
        ...terminator,
        scrutinee: substitutions.get(terminator.scrutinee) ?? terminator.scrutinee,
      };
    case "return":
      return {
        ...terminator,
        values: terminator.values.map((valueId) => substitutions.get(valueId) ?? valueId),
      };
    case "jump":
    case "unreachable":
      return terminator;
  }
}

export function rewriteOperation(
  operation: OptIrOperation,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrOperation {
  const operandIds = operation.operandIds.map((valueId) => substitutions.get(valueId) ?? valueId);
  if (arraysEqual(operandIds, operation.operandIds)) {
    return operation;
  }

  if (isOptIrSourceValueOperation(operation)) {
    return rewriteOptIrSourceValueOperationOperands(operation, operandIds);
  }

  switch (operation.kind) {
    case "constant":
    case "constAddr":
    case "memoryLoad":
    case "proofErasedMarker":
      return operation;
    case "integerUnary":
      return {
        ...operation,
        operandIds,
        operand: operandIds[0] ?? operation.operand,
      };
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return {
        ...operation,
        operandIds,
        left: operandIds[0] ?? operation.left,
        right: operandIds[1] ?? operation.right,
      };
    case "booleanNot":
      return {
        ...operation,
        operandIds,
        operand: operandIds[0] ?? operation.operand,
      };
    case "aggregateConstruct":
      return { ...operation, operandIds, fieldIds: operandIds };
    case "aggregateExtract":
      return {
        ...operation,
        operandIds,
        aggregate: operandIds[0] ?? operation.aggregate,
      };
    case "aggregateInsert":
      return {
        ...operation,
        operandIds,
        aggregate: operandIds[0] ?? operation.aggregate,
        field: operandIds[1] ?? operation.field,
      };
    case "enumTagStore":
      return {
        ...operation,
        operandIds,
        tagValue: operandIds[0] ?? operation.tagValue,
      };
    case "enumPayloadStore":
      return {
        ...operation,
        operandIds,
        enumValue: operandIds[0] ?? operation.enumValue,
        payloadValue: operandIds[1] ?? operation.payloadValue,
      };
    case "enumTagLoad":
    case "enumPayloadLoad":
      return {
        ...operation,
        operandIds,
        enumValue: operandIds[0] ?? operation.enumValue,
      };
    case "layoutOffset":
    case "layoutByteRange":
      return {
        ...operation,
        operandIds,
        base: operandIds[0] ?? operation.base,
      };
    case "layoutEndianDecode":
      return {
        ...operation,
        operandIds,
        bytes: operandIds[0] ?? operation.bytes,
      };
    case "memoryStore":
      return {
        ...operation,
        operandIds,
        storeValue: operandIds[0] ?? operation.storeValue,
      };
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return { ...operation, operandIds, argumentIds: operandIds };
    case "vectorLoad":
    case "vectorMaskedLoad":
      return {
        ...operation,
        operandIds,
        mask: operation.mask === undefined ? undefined : operandIds[0],
      };
    case "vectorStore":
    case "vectorMaskedStore":
      return {
        ...operation,
        operandIds,
        vector: operandIds[0] ?? operation.vector,
        storeValue: operandIds[1] ?? operation.storeValue,
        mask: operation.mask === undefined ? undefined : operandIds[2],
      };
    case "vectorByteSwap":
      return {
        ...operation,
        operandIds,
        vector: operandIds[0] ?? operation.vector,
      };
  }
}

function arraysEqual<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

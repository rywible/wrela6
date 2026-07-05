import type { OptIrIntegerConstant } from "../constants";
import type { OptIrConstantId, OptIrOperationId, OptIrOriginId, OptIrValueId } from "../ids";
import { optIrBooleanType, type OptIrType } from "../types";
import {
  defineOptIrOperation,
  type OptIrOperation,
  type OptIrOperationBase,
} from "../operations.ts";

export type OptIrIntegerUnaryOperator = "negate" | "bitwiseNot";
export type OptIrIntegerBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "unsignedDivide"
  | "signedDivide"
  | "and"
  | "or"
  | "xor"
  | "shiftLeft"
  | "shiftRight";
export type OptIrIntegerCompareOperator =
  | "equal"
  | "notEqual"
  | "unsignedLessThan"
  | "unsignedLessThanOrEqual"
  | "signedLessThan"
  | "signedLessThanOrEqual";
export type OptIrBooleanBinaryOperator = "and" | "or" | "xor" | "equal" | "notEqual";

function operation<Kind extends OptIrScalarOperation["kind"], Extra extends object>(
  input: Parameters<typeof defineOptIrOperation<Kind>>[0],
  extra: Extra,
): OptIrOperationBase<Kind> & Extra {
  const base = defineOptIrOperation(input);
  const { attributes: _attributes, ...withoutAttributes } = base;
  void _attributes;
  return Object.freeze({ ...withoutAttributes, ...extra });
}

export type OptIrScalarOperation =
  | (OptIrOperationBase<"constant"> & { readonly constant: OptIrIntegerConstant })
  | (OptIrOperationBase<"constAddr"> & { readonly constantId: OptIrConstantId })
  | (OptIrOperationBase<"integerUnary"> & {
      readonly operator: OptIrIntegerUnaryOperator;
      readonly operand: OptIrValueId;
    })
  | (OptIrOperationBase<"integerBinary"> & {
      readonly operator: OptIrIntegerBinaryOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    })
  | (OptIrOperationBase<"integerCompare"> & {
      readonly operator: OptIrIntegerCompareOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    })
  | (OptIrOperationBase<"booleanNot"> & { readonly operand: OptIrValueId })
  | (OptIrOperationBase<"booleanBinary"> & {
      readonly operator: OptIrBooleanBinaryOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    });

export function optIrConstantOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly constant: OptIrIntegerConstant;
  readonly originId: OptIrOriginId;
  readonly displayName?: string;
}): OptIrOperation {
  return operation(
    {
      kind: "constant",
      operationId: input.operationId,
      operandIds: [],
      resultIds: [input.resultId],
      resultTypes: [input.constant.type],
      originId: input.originId,
      displayName: input.displayName,
    },
    { constant: input.constant },
  ) as OptIrOperation;
}

export function optIrConstAddrOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly constantId: OptIrConstantId;
  readonly originId: OptIrOriginId;
  readonly displayName?: string;
}): OptIrOperation {
  return operation(
    {
      kind: "constAddr",
      operationId: input.operationId,
      operandIds: [],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
      displayName: input.displayName,
    },
    { constantId: input.constantId },
  ) as OptIrOperation;
}

export function optIrIntegerUnaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly operand: OptIrValueId;
  readonly operator: OptIrIntegerUnaryOperator;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerUnary",
      operationId: input.operationId,
      operandIds: [input.operand],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { operand: input.operand, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrIntegerBinaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrIntegerBinaryOperator;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerBinary",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrIntegerCompareOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrIntegerCompareOperator;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerCompare",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrBooleanNotOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly operand: OptIrValueId;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "booleanNot",
      operationId: input.operationId,
      operandIds: [input.operand],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { operand: input.operand },
  ) as OptIrOperation;
}

export function optIrBooleanBinaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrBooleanBinaryOperator;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "booleanBinary",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

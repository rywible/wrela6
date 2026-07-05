import type { OptIrOperationId, OptIrOriginId, OptIrValueId } from "../ids";
import type { OptIrType } from "../types";
import {
  defineOptIrOperation,
  type OptIrOperation,
  type OptIrOperationBase,
} from "../operations.ts";

function operation<Kind extends OptIrAggregateOperation["kind"], Extra extends object>(
  input: Parameters<typeof defineOptIrOperation<Kind>>[0],
  extra: Extra,
): OptIrOperationBase<Kind> & Extra {
  const base = defineOptIrOperation(input);
  const { attributes: _attributes, ...withoutAttributes } = base;
  void _attributes;
  return Object.freeze({ ...withoutAttributes, ...extra });
}

export type OptIrAggregateOperation =
  | (OptIrOperationBase<"aggregateConstruct"> & { readonly fieldIds: readonly OptIrValueId[] })
  | (OptIrOperationBase<"aggregateExtract"> & {
      readonly aggregate: OptIrValueId;
      readonly fieldPath: readonly string[];
    })
  | (OptIrOperationBase<"aggregateInsert"> & {
      readonly aggregate: OptIrValueId;
      readonly field: OptIrValueId;
      readonly fieldPath: readonly string[];
    });

export function optIrAggregateConstructOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly fieldIds: readonly OptIrValueId[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateConstruct",
      operationId: input.operationId,
      operandIds: input.fieldIds,
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { fieldIds: Object.freeze([...input.fieldIds]) },
  ) as OptIrOperation;
}

export function optIrAggregateExtractOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly aggregate: OptIrValueId;
  readonly fieldPath: readonly string[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateExtract",
      operationId: input.operationId,
      operandIds: [input.aggregate],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { aggregate: input.aggregate, fieldPath: Object.freeze([...input.fieldPath]) },
  ) as OptIrOperation;
}

export function optIrAggregateInsertOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly aggregate: OptIrValueId;
  readonly field: OptIrValueId;
  readonly fieldPath: readonly string[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateInsert",
      operationId: input.operationId,
      operandIds: [input.aggregate, input.field],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    {
      aggregate: input.aggregate,
      field: input.field,
      fieldPath: Object.freeze([...input.fieldPath]),
    },
  ) as OptIrOperation;
}

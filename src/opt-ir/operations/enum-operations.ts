import type { OptIrOperationId, OptIrOriginId, OptIrValueId } from "../ids";
import type { OptIrType } from "../types";
import {
  defineOptIrOperation,
  type OptIrOperation,
  type OptIrOperationBase,
} from "../operations.ts";

export interface OptIrEnumCaseDescriptor {
  readonly enumTypeKey: string;
  readonly caseName: string;
  readonly caseOrdinal: number;
  readonly tagValue: string;
  readonly payloadFieldName?: string;
  readonly layoutPath?: readonly string[];
  readonly byteOffset?: bigint;
}

function operation<Kind extends OptIrEnumOperation["kind"], Extra extends object>(
  input: Parameters<typeof defineOptIrOperation<Kind>>[0],
  extra: Extra,
): OptIrOperationBase<Kind> & Extra {
  const base = defineOptIrOperation(input);
  const { attributes: _attributes, ...withoutAttributes } = base;
  void _attributes;
  return Object.freeze({ ...withoutAttributes, ...extra });
}

function descriptor(input: OptIrEnumCaseDescriptor): OptIrEnumCaseDescriptor {
  return Object.freeze({
    enumTypeKey: input.enumTypeKey,
    caseName: input.caseName,
    caseOrdinal: input.caseOrdinal,
    tagValue: input.tagValue,
    ...(input.payloadFieldName === undefined ? {} : { payloadFieldName: input.payloadFieldName }),
    ...(input.layoutPath === undefined ? {} : { layoutPath: Object.freeze([...input.layoutPath]) }),
    ...(input.byteOffset === undefined ? {} : { byteOffset: input.byteOffset }),
  });
}

export type OptIrEnumOperation =
  | (OptIrOperationBase<"enumTagStore"> & {
      readonly tagValue: OptIrValueId;
      readonly enumCase: OptIrEnumCaseDescriptor;
    })
  | (OptIrOperationBase<"enumPayloadStore"> & {
      readonly enumValue: OptIrValueId;
      readonly payloadValue: OptIrValueId;
      readonly enumCase: OptIrEnumCaseDescriptor;
    })
  | (OptIrOperationBase<"enumTagLoad"> & {
      readonly enumValue: OptIrValueId;
      readonly enumCase: OptIrEnumCaseDescriptor;
    })
  | (OptIrOperationBase<"enumPayloadLoad"> & {
      readonly enumValue: OptIrValueId;
      readonly enumCase: OptIrEnumCaseDescriptor;
    });

export function optIrEnumTagStoreOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly tagValue: OptIrValueId;
  readonly enumCase: OptIrEnumCaseDescriptor;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "enumTagStore",
      operationId: input.operationId,
      operandIds: [input.tagValue],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { tagValue: input.tagValue, enumCase: descriptor(input.enumCase) },
  ) as OptIrOperation;
}

export function optIrEnumPayloadStoreOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly enumValue: OptIrValueId;
  readonly payloadValue: OptIrValueId;
  readonly enumCase: OptIrEnumCaseDescriptor;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "enumPayloadStore",
      operationId: input.operationId,
      operandIds: [input.enumValue, input.payloadValue],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    {
      enumValue: input.enumValue,
      payloadValue: input.payloadValue,
      enumCase: descriptor(input.enumCase),
    },
  ) as OptIrOperation;
}

export function optIrEnumTagLoadOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly enumValue: OptIrValueId;
  readonly enumCase: OptIrEnumCaseDescriptor;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "enumTagLoad",
      operationId: input.operationId,
      operandIds: [input.enumValue],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { enumValue: input.enumValue, enumCase: descriptor(input.enumCase) },
  ) as OptIrOperation;
}

export function optIrEnumPayloadLoadOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly enumValue: OptIrValueId;
  readonly enumCase: OptIrEnumCaseDescriptor;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "enumPayloadLoad",
      operationId: input.operationId,
      operandIds: [input.enumValue],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { enumValue: input.enumValue, enumCase: descriptor(input.enumCase) },
  ) as OptIrOperation;
}

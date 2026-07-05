import type { ProofMirValueId } from "../../proof-mir/ids";
import type { ProofMirFunction, ProofMirStatement } from "../../proof-mir/model/graph";
import { optIrConstantId, type OptIrOriginId } from "../ids";
import {
  optIrAggregateConstructOperation,
  optIrConstantOperation,
  optIrEnumPayloadStoreOperation,
  optIrEnumTagStoreOperation,
  type OptIrOperation,
} from "../operations";
import { optIrTypeStableKey, type OptIrType } from "../types";
import type { ProofMirLoweringContext } from "./lower-checked-mir";
import { nextStatementOperationId, proofMirValueIdFor } from "./proof-mir-lowering-helpers";
import { aliasProofMirValue } from "./proof-mir-place-aliases";

type ProofMirConstructObjectStatement = Extract<
  ProofMirStatement["kind"],
  { readonly kind: "constructObject" }
>;

export function lowerProofMirConstructObjectStatement(input: {
  readonly function_: ProofMirFunction;
  readonly construct: ProofMirConstructObjectStatement;
  readonly context: ProofMirLoweringContext;
  readonly originId: OptIrOriginId;
  readonly valueTypeForLowering: (valueId: ProofMirValueId) => OptIrType;
}): readonly OptIrOperation[] {
  const sourceConstruct = lowerSourceTypeConstruct(input);
  if (sourceConstruct !== undefined) {
    return sourceConstruct;
  }

  const tagConstruct = tagOnlyConstructConstant(input);
  if (tagConstruct !== undefined) {
    return [
      optIrConstantOperation({
        operationId: nextStatementOperationId(input.context),
        resultId: proofMirValueIdFor(input.function_, input.construct.result, input.context),
        constant: input.context.constantPool.internInteger({
          constantId: optIrConstantId(input.context.nextConstantId++),
          type: input.valueTypeForLowering(input.construct.result),
          normalizedValue: tagConstruct,
        }),
        originId: input.originId,
      }),
    ];
  }

  const emptyConstruct = emptyConstructConstant(input);
  if (emptyConstruct !== undefined) {
    return [
      optIrConstantOperation({
        operationId: nextStatementOperationId(input.context),
        resultId: proofMirValueIdFor(input.function_, input.construct.result, input.context),
        constant: input.context.constantPool.internInteger({
          constantId: optIrConstantId(input.context.nextConstantId++),
          type: input.valueTypeForLowering(input.construct.result),
          normalizedValue: emptyConstruct,
        }),
        originId: input.originId,
      }),
    ];
  }
  const enumConstruct = payloadEnumConstructOperations(input);
  if (enumConstruct !== undefined) {
    return enumConstruct;
  }
  return [
    optIrAggregateConstructOperation({
      operationId: nextStatementOperationId(input.context),
      fieldIds: input.construct.fields.map((field) =>
        proofMirValueIdFor(input.function_, field.value, input.context),
      ),
      resultId: proofMirValueIdFor(input.function_, input.construct.result, input.context),
      resultType: input.valueTypeForLowering(input.construct.result),
      originId: input.originId,
    }),
  ];
}

function payloadEnumConstructOperations(input: {
  readonly function_: ProofMirFunction;
  readonly construct: ProofMirConstructObjectStatement;
  readonly context: ProofMirLoweringContext;
  readonly originId: OptIrOriginId;
  readonly valueTypeForLowering: (valueId: ProofMirValueId) => OptIrType;
}): readonly OptIrOperation[] | undefined {
  const tagField = input.construct.fields[0];
  if (input.construct.fields.length <= 1 || tagField?.name !== "__tag") {
    return undefined;
  }
  const tagValue = proofMirValueIdFor(input.function_, tagField.value, input.context);
  const resultType = input.valueTypeForLowering(input.construct.result);
  const resultValue = proofMirValueIdFor(input.function_, input.construct.result, input.context);
  const tagLiteral = integerLiteralForValue(input.function_, tagField.value);
  if (tagLiteral === undefined) {
    return undefined;
  }
  const enumCase = {
    enumTypeKey: optIrTypeStableKey(resultType),
    caseName: `case${String(tagLiteral)}`,
    caseOrdinal: Number(tagLiteral),
    tagValue: String(tagLiteral),
  };
  const operations: OptIrOperation[] = [];
  let currentEnumValue = input.context.values.declareValue({
    valueKey: `enum:${String(input.function_.functionInstanceId)}:${String(
      input.construct.result,
    )}:tag`,
    runtime: true,
  });
  operations.push(
    optIrEnumTagStoreOperation({
      operationId: nextStatementOperationId(input.context),
      tagValue,
      enumCase,
      resultId: currentEnumValue,
      resultType,
      originId: input.originId,
    }),
  );

  for (const [index, field] of input.construct.fields.slice(1).entries()) {
    const resultId =
      index === input.construct.fields.length - 2
        ? resultValue
        : input.context.values.declareValue({
            valueKey: `enum:${String(input.function_.functionInstanceId)}:${String(
              input.construct.result,
            )}:payload:${index}`,
            runtime: true,
          });
    operations.push(
      optIrEnumPayloadStoreOperation({
        operationId: nextStatementOperationId(input.context),
        enumValue: currentEnumValue,
        payloadValue: proofMirValueIdFor(input.function_, field.value, input.context),
        enumCase: {
          ...enumCase,
          payloadFieldName: field.name,
        },
        resultId,
        resultType,
        originId: input.originId,
      }),
    );
    currentEnumValue = resultId;
  }
  return operations;
}

function tagOnlyConstructConstant(input: {
  readonly function_: ProofMirFunction;
  readonly construct: ProofMirConstructObjectStatement;
  readonly valueTypeForLowering: (valueId: ProofMirValueId) => OptIrType;
}): bigint | undefined {
  const field = input.construct.fields[0];
  if (input.construct.fields.length !== 1 || field?.name !== "__tag") {
    return undefined;
  }
  if (input.valueTypeForLowering(input.construct.result).kind !== "integer") {
    return undefined;
  }
  return integerLiteralForValue(input.function_, field.value);
}

function integerLiteralForValue(
  function_: ProofMirFunction,
  valueId: ProofMirValueId,
): bigint | undefined {
  for (const block of function_.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "literal" || statement.kind.value !== valueId) {
        continue;
      }
      const literal = statement.kind.literal;
      if (literal.kind !== "integer") {
        return undefined;
      }
      if (literal.value !== undefined) {
        return literal.value;
      }
      try {
        return BigInt(literal.text);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function lowerSourceTypeConstruct(input: {
  readonly function_: ProofMirFunction;
  readonly construct: ProofMirConstructObjectStatement;
  readonly context: ProofMirLoweringContext;
  readonly originId: OptIrOriginId;
  readonly valueTypeForLowering: (valueId: ProofMirValueId) => OptIrType;
}): readonly OptIrOperation[] | undefined {
  const resultValue = input.function_.values.get(input.construct.result);
  if (resultValue === undefined) {
    return undefined;
  }
  const lowering = input.context.target.sourceTypeAbi?.lowerConstruct?.({
    type: resultValue.type,
    fields: input.construct.fields.map((field) => ({
      name: field.name,
      type: input.function_.values.get(field.value)?.type,
    })),
  });
  if (lowering === undefined) {
    return undefined;
  }
  if (lowering.kind === "fieldAlias") {
    const field = input.construct.fields.find((candidate) => candidate.name === lowering.fieldName);
    if (field === undefined) {
      return undefined;
    }
    aliasProofMirValue({
      function_: input.function_,
      result: input.construct.result,
      targetValueId: proofMirValueIdFor(input.function_, field.value, input.context),
      context: input.context,
    });
    return [];
  }
  return [
    optIrConstantOperation({
      operationId: nextStatementOperationId(input.context),
      resultId: proofMirValueIdFor(input.function_, input.construct.result, input.context),
      constant: input.context.constantPool.internInteger({
        constantId: optIrConstantId(input.context.nextConstantId++),
        type: input.valueTypeForLowering(input.construct.result),
        normalizedValue: lowering.value,
      }),
      originId: input.originId,
    }),
  ];
}

function emptyConstructConstant(input: {
  readonly function_: ProofMirFunction;
  readonly construct: ProofMirConstructObjectStatement;
  readonly context: ProofMirLoweringContext;
}): bigint | undefined {
  if (input.construct.fields.length !== 0) {
    return undefined;
  }
  const resultValue = input.function_.values.get(input.construct.result);
  const emptyConstruct =
    resultValue === undefined
      ? undefined
      : input.context.target.sourceTypeAbi?.lowerEmptyConstruct?.({ type: resultValue.type });
  return emptyConstruct?.kind === "integerConstant" ? emptyConstruct.value : undefined;
}

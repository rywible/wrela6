import type { ProofMirValueId } from "../../proof-mir/ids";
import type { ProofMirFunction, ProofMirStatement } from "../../proof-mir/model/graph";
import { optIrConstantId, type OptIrOriginId } from "../ids";
import {
  optIrAggregateConstructOperation,
  optIrConstantOperation,
  type OptIrOperation,
} from "../operations";
import type { OptIrType } from "../types";
import type { ProofMirLoweringContext } from "./lower-checked-mir";
import { nextStatementOperationId, proofMirValueIdFor } from "./proof-mir-lowering-helpers";

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

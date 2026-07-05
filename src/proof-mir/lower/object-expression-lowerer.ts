import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoExpression, MonoResourcePlace } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirStatementKind } from "../draft/draft-statement";
import type { ProofMirDraftOperand, ProofMirDraftPlaceOperand } from "./lowering-operands";
import type { ProofMirExpressionLoweringInput, ProofMirLoweringResult } from "./lowering-context";
import { objectConstructFields, recordObjectFieldConsumes } from "./object-construction-lowerer";
import { objectNeedsPlace } from "./object-place-requirements";
import {
  invalidValueResourceKindDiagnostic,
  loweringError,
  loweringOk,
  originForExpression,
  unlowerableExpressionDiagnostic,
} from "./expression-lowerer-helpers";

export type LowerProofMirObjectFieldValue = (input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
}) => ProofMirLoweringResult<ProofMirDraftOperand>;

export type LowerProofMirObjectPlace = (input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly monoPlace: MonoResourcePlace;
  readonly originKey: ProofMirCanonicalKey;
}) => ProofMirLoweringResult<ProofMirCanonicalKey>;

export type RecordProofMirObjectStatement = (
  statementKind: DraftProofMirStatementKind,
  originKey: ProofMirCanonicalKey,
  loweringInput: ProofMirExpressionLoweringInput,
  expression: MonoExpression,
) => void;

function valueOperand(valueKey: ProofMirCanonicalKey): ProofMirDraftOperand {
  return { kind: "value", value: valueKey };
}

export function lowerObjectAsValue(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
  readonly lowerExpressionValue: LowerProofMirObjectFieldValue;
  readonly lowerPlaceFromMono: LowerProofMirObjectPlace;
  readonly recordStatement: RecordProofMirObjectStatement;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const { loweringInput, expression } = input;
  if (expression.kind.kind !== "object") {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: loweringInput.context.functionInstanceId,
        stableDetail: "object:shape",
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }
  const fieldValues: {
    readonly field: (typeof expression.kind.fields)[number];
    readonly operand: ProofMirDraftOperand;
  }[] = [];
  for (const field of expression.kind.fields) {
    const lowered = input.lowerExpressionValue({
      loweringInput,
      expression: field.value,
    });
    if (lowered.kind !== "ok") {
      return lowered;
    }
    fieldValues.push({ field, operand: lowered.value });
  }
  const needsPlace =
    objectNeedsPlace(expression) ||
    fieldValues.some(
      (entry) => entry.operand.kind === "place" || entry.operand.kind === "valueAndPlace",
    );
  const originKey = originForExpression(loweringInput.context, expression);
  const constructFields = objectConstructFields({
    loweringInput,
    fieldValues,
  });
  if (constructFields.kind !== "ok") {
    return constructFields;
  }
  if (!needsPlace) {
    const valueKey = loweringInput.context.graph.createValue({
      role: `object:copy-scalar:${instantiatedHirIdKey(expression.expressionId)}`,
      origin: originKey,
      type: expression.type,
      resourceKind: expression.resourceKind,
    });
    input.recordStatement(
      {
        kind: "constructObject",
        resultKey: valueKey,
        fields: constructFields.value,
      },
      originKey,
      loweringInput,
      expression,
    );
    recordObjectFieldConsumes({
      loweringInput,
      fieldValues,
      recordStatement: input.recordStatement,
    });
    return loweringOk(valueOperand(valueKey));
  }
  const aggregateValueKey = loweringInput.context.graph.createValue({
    role: `object:aggregate:${instantiatedHirIdKey(expression.expressionId)}`,
    origin: originKey,
    type: expression.type,
    resourceKind: expression.resourceKind,
  });
  input.recordStatement(
    {
      kind: "constructObject",
      resultKey: aggregateValueKey,
      fields: constructFields.value,
    },
    originKey,
    loweringInput,
    expression,
  );
  recordObjectFieldConsumes({
    loweringInput,
    fieldValues,
    recordStatement: input.recordStatement,
  });
  const placeKey =
    expression.place === undefined
      ? loweringOk(
          loweringInput.context.effects.placeFromRuntimeTemporary({
            valueKey: aggregateValueKey,
            originKey,
          }),
        )
      : input.lowerPlaceFromMono({
          loweringInput,
          monoPlace: expression.place,
          originKey,
        });
  if (placeKey.kind !== "ok") {
    return placeKey;
  }
  input.recordStatement(
    {
      kind: "store",
      placeKey: placeKey.value,
      valueKey: aggregateValueKey,
    },
    originKey,
    loweringInput,
    expression,
  );
  return loweringOk({
    kind: "valueAndPlace",
    value: aggregateValueKey,
    place: placeKey.value,
  });
}

export function lowerObjectAsPlace(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
  readonly lowerObjectValue: LowerProofMirObjectFieldValue;
}): ProofMirLoweringResult<ProofMirDraftPlaceOperand> {
  const valueResult = input.lowerObjectValue({
    loweringInput: input.loweringInput,
    expression: input.expression,
  });
  if (valueResult.kind !== "ok") {
    return valueResult;
  }
  if (valueResult.value.kind === "place") {
    return loweringOk(valueResult.value);
  }
  if (valueResult.value.kind === "valueAndPlace") {
    return loweringOk({ kind: "place", place: valueResult.value.place });
  }
  return loweringError([
    invalidValueResourceKindDiagnostic({
      functionInstanceId: input.loweringInput.context.functionInstanceId,
      stableDetail: "object:scalar-as-place",
      sourceOrigin: input.expression.sourceOrigin,
    }),
  ]);
}

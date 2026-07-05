import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoExpression } from "../../mono/mono-hir";
import { coreTypeId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirObjectFieldValue,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";
import type { ProofMirExpressionLoweringInput, ProofMirLoweringResult } from "./lowering-context";
import { operandValueKey, type ProofMirDraftOperand } from "./lowering-operands";
import {
  invalidValueResourceKindDiagnostic,
  originForExpression,
  loweringError,
  loweringOk,
  unlowerableExpressionDiagnostic,
} from "./expression-lowerer-helpers";

export function lowerProofMirEnumConstructorAsValue(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
  readonly lowerExpressionValue: (input: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly expression: MonoExpression;
  }) => ProofMirLoweringResult<ProofMirDraftOperand>;
  readonly recordStatement: (
    statementKind: DraftProofMirStatementKind,
    originKey: ProofMirCanonicalKey,
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ) => void;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const { loweringInput, expression } = input;
  if (expression.kind.kind !== "enumConstructor") {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: loweringInput.context.functionInstanceId,
        stableDetail: "enum-constructor:shape",
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }
  const originKey = originForExpression(loweringInput.context, expression);
  const tagValueKey = loweringInput.context.graph.createValue({
    role: `enum:tag:${instantiatedHirIdKey(expression.expressionId)}`,
    origin: originKey,
    type: { kind: "core", coreTypeId: coreTypeId("u32") } as typeof expression.type,
    resourceKind: "Copy",
  });
  input.recordStatement(
    {
      kind: "literal",
      valueKey: tagValueKey,
      literal: {
        kind: "integer",
        text: String(expression.kind.constructor.caseOrdinal),
        value: BigInt(expression.kind.constructor.caseOrdinal),
      },
    },
    originKey,
    loweringInput,
    expression,
  );

  const fields: DraftProofMirObjectFieldValue[] = [
    {
      name: "__tag",
      valueKey: tagValueKey,
      originKey,
    },
  ];
  for (const payloadField of expression.kind.constructor.payloadFields) {
    const lowered = input.lowerExpressionValue({
      loweringInput,
      expression: payloadField.value,
    });
    if (lowered.kind !== "ok") return lowered;
    const valueKey = operandValueKey(lowered.value);
    if (valueKey === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: loweringInput.context.functionInstanceId,
          stableDetail: `enum:payload:${payloadField.name}`,
          sourceOrigin: payloadField.sourceOrigin,
        }),
      ]);
    }
    fields.push({
      fieldId: payloadField.fieldId,
      name: payloadField.name,
      valueKey,
      originKey: originForExpression(loweringInput.context, payloadField.value),
    });
  }

  const resultKey = loweringInput.context.graph.createValue({
    role: `enum:construct:${expression.kind.constructor.caseName}:${instantiatedHirIdKey(
      expression.expressionId,
    )}`,
    origin: originKey,
    type: expression.type,
    resourceKind: expression.resourceKind,
  });
  input.recordStatement(
    {
      kind: "constructObject",
      resultKey,
      fields,
    },
    originKey,
    loweringInput,
    expression,
  );
  return loweringOk({ kind: "value", value: resultKey });
}

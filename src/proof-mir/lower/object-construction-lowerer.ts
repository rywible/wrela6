import type { MonoExpression, MonoObjectField } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirObjectFieldValue,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { operandValueKey } from "./lowering-operands";
import type { ProofMirExpressionLoweringInput, ProofMirLoweringResult } from "./lowering-context";
import {
  invalidValueResourceKindDiagnostic,
  loweringError,
  loweringOk,
  originForExpression,
} from "./expression-lowerer-helpers";

export interface LoweredObjectFieldValue {
  readonly field: MonoObjectField;
  readonly operand: ProofMirDraftOperand;
}

export type RecordProofMirExpressionStatement = (
  statementKind: DraftProofMirStatementKind,
  originKey: ProofMirCanonicalKey,
  loweringInput: ProofMirExpressionLoweringInput,
  expression: MonoExpression,
) => void;

export function objectConstructFields(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly fieldValues: readonly LoweredObjectFieldValue[];
}): ProofMirLoweringResult<readonly DraftProofMirObjectFieldValue[]> {
  const constructFields: DraftProofMirObjectFieldValue[] = [];
  for (const entry of input.fieldValues) {
    const valueKey = operandValueKey(entry.operand);
    if (valueKey === undefined) {
      return loweringError([
        invalidValueResourceKindDiagnostic({
          functionInstanceId: input.loweringInput.context.functionInstanceId,
          stableDetail: `object:field:${entry.field.name}`,
          sourceOrigin: entry.field.sourceOrigin,
        }),
      ]);
    }
    constructFields.push({
      ...(entry.field.fieldId === undefined ? {} : { fieldId: entry.field.fieldId }),
      name: entry.field.name,
      valueKey,
      originKey: originForExpression(input.loweringInput.context, entry.field.value),
    });
  }
  return loweringOk(Object.freeze(constructFields));
}

export function recordObjectFieldConsumes(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly fieldValues: readonly LoweredObjectFieldValue[];
  readonly recordStatement: RecordProofMirExpressionStatement;
}): void {
  for (const entry of input.fieldValues) {
    if (entry.operand.kind !== "valueAndPlace") {
      continue;
    }
    input.recordStatement(
      {
        kind: "consumePlace",
        placeKey: entry.operand.place,
        reason: "move",
      },
      originForExpression(input.loweringInput.context, entry.field.value),
      input.loweringInput,
      entry.field.value,
    );
  }
}

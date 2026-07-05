import type { LayoutTerm } from "../../layout/layout-program";
import type {
  MonoExpression,
  MonoResourcePlace,
  MonoValidatedBufferLayoutField,
} from "../../mono/mono-hir";
import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type { FieldId } from "../../semantic/ids";
import { proofMirDiagnostic } from "../diagnostics";
import { findLayoutValidatedBufferForPlace } from "../domains/validated-buffer-layout-lookup";
import {
  classifyValidatedBufferMemberRead,
  containerPlaceForMemberPlace,
  findDerivedField,
  splitMemberPlace,
} from "../domains/validated-buffer-read-detection";
import { loweringError, loweringOk } from "./call-lowering-shared";
import type {
  ProofMirDerivedFieldComparisonLoweringInput,
  ProofMirLoweringResult,
} from "./lowering-context";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { monoPlaceForLocal, originForExpression } from "./expression-lowerer-helpers";
import { recordValidatedBufferReadStatement } from "./validated-buffer-read-statement-recorder";
import {
  lowerLayoutFieldRead,
  unlowerableValidatedBufferReadDiagnostic,
} from "./validated-buffer-read-field-lowering";
import type { RecordedProofMirStatement } from "./validated-buffer-read-statement-recorder";

type DerivedComparisonCandidate = {
  readonly memberExpression: MonoExpression;
  readonly literalExpression: MonoExpression;
};

function integerLiteralValue(expression: MonoExpression): bigint | undefined {
  return expression.kind.kind === "literal" && expression.kind.literal.kind === "integer"
    ? expression.kind.literal.value
    : undefined;
}

function comparisonCandidate(expression: MonoExpression): DerivedComparisonCandidate | undefined {
  if (expression.kind.kind !== "comparison") return undefined;
  const left = expression.kind.left;
  const right = expression.kind.right;
  if (left.kind.kind === "member" && integerLiteralValue(right) !== undefined) {
    return { memberExpression: left, literalExpression: right };
  }
  if (right.kind.kind === "member" && integerLiteralValue(left) !== undefined) {
    return { memberExpression: right, literalExpression: left };
  }
  return undefined;
}

function constantScalarValue(term: LayoutTerm): bigint | undefined {
  return term.kind === "constant" && term.unit === "scalarValue" ? term.value : undefined;
}

function sourceLayoutFieldId(term: LayoutTerm): FieldId | undefined {
  return term.kind === "fieldValue" && term.source === "layout" && term.unit === "scalarValue"
    ? term.fieldId
    : undefined;
}

function monoLayoutField(input: {
  readonly context: ProofMirDerivedFieldComparisonLoweringInput["context"];
  readonly instanceId: MonoInstanceId;
  readonly fieldId: FieldId;
}): MonoValidatedBufferLayoutField | undefined {
  return input.context.program.validatedBuffers
    .get(input.instanceId)
    ?.layoutFields.find((field) => field.field.fieldId === input.fieldId);
}

function memberPlaceForSourceLayoutField(input: {
  readonly context: ProofMirDerivedFieldComparisonLoweringInput["context"];
  readonly containerPlace: MonoResourcePlace;
  readonly field: MonoValidatedBufferLayoutField;
}): MonoResourcePlace | undefined {
  const projection = [
    ...input.containerPlace.projection,
    { kind: "field" as const, fieldId: input.field.field.fieldId },
  ];
  switch (input.containerPlace.root.kind) {
    case "local":
      return monoPlaceForLocal({
        program: input.context.program,
        functionInstanceId: input.context.functionInstanceId,
        localId: input.containerPlace.root.localId,
        type: input.field.field.type,
        resourceKind: input.field.field.resourceKind,
        sourceOrigin: input.field.sourceOrigin,
        projection,
      });
    case "parameter":
    case "receiver":
      return {
        placeId: input.containerPlace.placeId,
        canonicalKey: `${input.containerPlace.canonicalKey}/field:${String(
          input.field.field.fieldId,
        )}`,
        root: input.containerPlace.root,
        projection,
        type: input.field.field.type,
        resourceKind: input.field.field.resourceKind,
        sourceOrigin: input.field.sourceOrigin,
        kind: "parameter",
        parameterId: input.containerPlace.root.parameterId,
      };
    default:
      return undefined;
  }
}

export function lowerDerivedFieldComparison(input: {
  readonly loweringInput: ProofMirDerivedFieldComparisonLoweringInput;
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<ProofMirDraftOperand> | undefined {
  const expression = input.loweringInput.expression;
  if (expression.kind.kind !== "comparison") return undefined;
  const operator = expression.kind.operator.trim();
  if (operator !== "==" && operator !== "!=") return undefined;
  const candidate = comparisonCandidate(expression);
  if (candidate === undefined) return undefined;
  const memberPlace =
    candidate.memberExpression.kind.kind === "member"
      ? candidate.memberExpression.kind.memberPlace
      : undefined;
  if (memberPlace === undefined) return undefined;
  const containerPlace = containerPlaceForMemberPlace({
    program: input.loweringInput.context.program,
    memberPlace,
  });
  if (containerPlace === undefined) return undefined;
  const split = splitMemberPlace(memberPlace);
  if (split === undefined) return undefined;
  const actualLayoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.loweringInput.context.program,
    layout: input.loweringInput.context.layout,
    place: containerPlace,
  });
  if (actualLayoutBuffer === undefined) return undefined;
  const readKind = classifyValidatedBufferMemberRead({
    layoutBuffer: actualLayoutBuffer,
    fieldId: split.fieldProjection.fieldId,
  });
  if (readKind?.kind !== "derivedField") return undefined;
  const derivedField = findDerivedField(actualLayoutBuffer, readKind.fieldId);
  const sourceFieldId =
    derivedField === undefined ? undefined : sourceLayoutFieldId(derivedField.source);
  const comparedValue = integerLiteralValue(candidate.literalExpression);
  const matchingCase = derivedField?.cases.find(
    (entry) =>
      entry.condition.kind === "equals" &&
      comparedValue !== undefined &&
      constantScalarValue(entry.result) === comparedValue,
  );
  const conditionValue =
    matchingCase?.condition.kind === "equals"
      ? constantScalarValue(matchingCase.condition.value)
      : undefined;
  if (
    derivedField === undefined ||
    sourceFieldId === undefined ||
    comparedValue === undefined ||
    matchingCase === undefined ||
    conditionValue === undefined
  ) {
    return loweringError([
      unlowerableValidatedBufferReadDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: `derived-comparison:${String(split.fieldProjection.fieldId)}`,
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }
  const sourceField = monoLayoutField({
    context: input.loweringInput.context,
    instanceId: actualLayoutBuffer.instanceId,
    fieldId: sourceFieldId,
  });
  if (sourceField === undefined) {
    return loweringError([
      unlowerableValidatedBufferReadDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: `derived-source-field:${String(sourceFieldId)}`,
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }
  const sourceMemberPlace = memberPlaceForSourceLayoutField({
    context: input.loweringInput.context,
    containerPlace,
    field: sourceField,
  });
  if (sourceMemberPlace === undefined) {
    return loweringError([
      unlowerableValidatedBufferReadDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: `derived-source-root:${containerPlace.root.kind}`,
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }
  const sourceRead = lowerLayoutFieldRead({
    loweringInput: {
      context: input.loweringInput.context,
      expression: candidate.memberExpression,
      blockKey: input.loweringInput.blockKey,
    },
    expression: candidate.memberExpression,
    memberPlace: sourceMemberPlace,
    resultType: sourceField.field.type,
    resultResourceKind: sourceField.field.resourceKind,
    recorded: input.recorded,
  });
  if (sourceRead.kind !== "ok" || sourceRead.value.kind !== "value") {
    return sourceRead.kind === "error"
      ? sourceRead
      : loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
            message: "Proof MIR derived-field comparison requires a scalar source-field read.",
            functionInstanceId: input.loweringInput.context.functionInstanceId,
            ownerKey: `function:${String(input.loweringInput.context.functionInstanceId)}`,
            rootCauseKey: "validated-buffer-derived-comparison",
            stableDetail: `derived-source-scalar:${String(sourceFieldId)}`,
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
  }
  const originKey = originForExpression(input.loweringInput.context, expression);
  const literalKey = input.loweringInput.context.graph.createValue({
    role: `derivedFieldCondition:${String(sourceFieldId)}:${instantiatedHirIdKey(
      expression.expressionId,
    )}`,
    origin: originKey,
    type: sourceField.field.type,
    resourceKind: sourceField.field.resourceKind,
  });
  recordValidatedBufferReadStatement({
    recorded: input.recorded,
    context: input.loweringInput.context,
    blockKey: input.loweringInput.blockKey,
    originKey,
    kind: {
      kind: "literal",
      valueKey: literalKey,
      literal: { kind: "integer", text: String(conditionValue), value: conditionValue },
    },
  });
  const resultKey = input.loweringInput.context.graph.createValue({
    role: `derivedFieldComparison:${String(readKind.fieldId)}:${instantiatedHirIdKey(
      expression.expressionId,
    )}`,
    origin: originKey,
    type: expression.type,
    resourceKind: expression.resourceKind,
  });
  recordValidatedBufferReadStatement({
    recorded: input.recorded,
    context: input.loweringInput.context,
    blockKey: input.loweringInput.blockKey,
    originKey,
    kind: {
      kind: "comparison",
      operator: operator === "==" ? "eq" : "ne",
      leftKey: sourceRead.value.value,
      rightKey: literalKey,
      resultKey,
    },
  });
  return loweringOk({ kind: "value", value: resultKey });
}

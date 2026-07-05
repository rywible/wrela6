import type { CallExpressionView } from "../frontend/ast/expression-views";
import type { ItemId, TypeId } from "../semantic/ids";
import { concreteKind, errorKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import {
  checkedTypesEqual,
  errorCheckedType,
  sourceCheckedType,
} from "../semantic/surface/type-model";
import type { HirCallArgument, HirEnumPayloadFieldBinding, HirExpression } from "./hir";
import type { HirOriginId } from "./ids";
import type { HirLoweringContext } from "./lowering-context";
import { hirDiagnostic, hirOwnerKey } from "./lowering-context";
import { hirEnumCaseOrdinal } from "./enum-case-model";
import { errorExpression } from "./expression-builder";

function enumConstructorResultType(input: {
  readonly enumTypeId: TypeId;
  readonly enumItemId: ItemId;
  readonly expectedType: CheckedType | undefined;
}): CheckedType {
  if (
    input.expectedType?.kind === "applied" &&
    input.expectedType.constructor.kind === "source" &&
    input.expectedType.constructor.typeId === input.enumTypeId
  ) {
    return input.expectedType;
  }
  if (input.expectedType?.kind === "source" && input.expectedType.typeId === input.enumTypeId) {
    return input.expectedType;
  }
  return sourceCheckedType({ itemId: input.enumItemId, typeId: input.enumTypeId });
}

export function reportEnumConstructorMismatch(input: {
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_ENUM_CONSTRUCTOR_ARGUMENT_MISMATCH",
      message: "Enum constructor arguments do not match the enum case payload fields.",
      originId: input.origin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.origin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

export function lowerEnumConstructorExpression(input: {
  readonly view: CallExpressionView;
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly caseItemId: ItemId;
  readonly expectedType?: CheckedType;
  readonly loweredByName: ReadonlyMap<string, HirCallArgument>;
  readonly positional: readonly HirCallArgument[];
}): HirExpression | undefined {
  const ordinalResult = hirEnumCaseOrdinal({
    index: input.context.index,
    caseItemId: input.caseItemId,
  });
  if (ordinalResult.kind === "not-enum-case") return undefined;
  if (ordinalResult.kind === "broken") {
    reportEnumConstructorMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: ordinalResult.stableDetail,
    });
    return errorExpression(input.context, input.origin, ordinalResult.stableDetail);
  }

  const missingFieldId = ordinalResult.record.payloadFieldIds.find(
    (fieldIdValue) => input.context.program.fields.get(fieldIdValue) === undefined,
  );
  if (missingFieldId !== undefined) {
    reportEnumConstructorMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: `missing-checked-field:${String(missingFieldId)}`,
    });
    return errorExpression(input.context, input.origin, "enum-constructor-missing-payload-field");
  }
  const payloadFields = ordinalResult.record.payloadFieldIds.map(
    (fieldIdValue) => input.context.program.fields.get(fieldIdValue)!,
  );

  const consumedNames = new Set<string>();
  const payloadBindings: HirEnumPayloadFieldBinding[] = [];
  let hasMismatch = false;
  let positionalIndex = 0;
  for (const field of payloadFields) {
    if (field === undefined) continue;
    const named = input.loweredByName.get(field.name);
    const next = named ?? input.positional[positionalIndex++];
    if (named !== undefined) consumedNames.add(field.name);
    if (next === undefined) {
      hasMismatch = true;
      reportEnumConstructorMismatch({
        context: input.context,
        origin: input.origin,
        stableDetail: `missing:${field.name}`,
      });
      continue;
    }
    if (
      next.expression.type.kind !== "error" &&
      field.type.kind !== "error" &&
      !checkedTypesEqual(field.type, next.expression.type)
    ) {
      hasMismatch = true;
      reportEnumConstructorMismatch({
        context: input.context,
        origin: input.origin,
        stableDetail: `type:${field.name}`,
      });
    }
    payloadBindings.push({
      fieldId: field.fieldId,
      name: field.name,
      value: next.expression,
      sourceOrigin: next.expression.sourceOrigin,
    });
  }

  for (const [name] of input.loweredByName) {
    if (!consumedNames.has(name)) {
      hasMismatch = true;
      reportEnumConstructorMismatch({
        context: input.context,
        origin: input.origin,
        stableDetail: `extra:${name}`,
      });
    }
  }
  if (positionalIndex < input.positional.length) {
    hasMismatch = true;
    reportEnumConstructorMismatch({
      context: input.context,
      origin: input.origin,
      stableDetail: `extra-positional:${input.positional.length - positionalIndex}`,
    });
  }

  const resultType = enumConstructorResultType({
    enumTypeId: ordinalResult.record.enumTypeId,
    enumItemId: ordinalResult.record.enumItemId,
    expectedType: input.expectedType,
  });
  const expression: HirExpression = {
    expressionId: input.context.bodyIndex.nextExpressionId(),
    kind: hasMismatch
      ? { kind: "error", reason: "enum-constructor-argument-mismatch" }
      : {
          kind: "enumConstructor",
          constructor: {
            enumTypeId: ordinalResult.record.enumTypeId,
            caseItemId: ordinalResult.record.caseItemId,
            caseName: ordinalResult.record.name,
            caseOrdinal: ordinalResult.record.ordinal,
            payloadFields: payloadBindings,
          },
        },
    type: hasMismatch ? errorCheckedType() : resultType,
    resourceKind: hasMismatch ? errorKind() : concreteKind("Copy"),
    sourceOrigin: input.origin,
  };
  input.context.bodyIndex.addExpression(expression);
  return expression;
}

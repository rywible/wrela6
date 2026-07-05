import type { ResolvedReference } from "../semantic/names/reference";
import { concreteKind } from "../semantic/surface/resource-kind";
import { sourceCheckedType, type CheckedType } from "../semantic/surface/type-model";
import type { HirExpression } from "./hir";
import type { HirOriginId } from "./ids";
import type { HirLoweringContext } from "./lowering-context";
import { hirDiagnostic, hirOwnerKey } from "./lowering-context";
import { hirEnumCaseOrdinal } from "./enum-case-model";
import { addExpression, errorExpression } from "./expression-builder";
import { reportTypeMismatch } from "./expression-type-diagnostics";

export function lowerEnumCaseMember(input: {
  readonly context: HirLoweringContext;
  readonly completed: ResolvedReference | undefined;
  readonly origin: HirOriginId;
  readonly expectedType: CheckedType | undefined;
}): HirExpression | undefined {
  if (input.completed?.kind !== "item") return undefined;
  const ordinalResult = hirEnumCaseOrdinal({
    index: input.context.index,
    caseItemId: input.completed.itemId,
  });
  if (ordinalResult.kind === "not-enum-case") return undefined;
  if (ordinalResult.kind === "broken") {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_MEMBER_REFERENCE_MISMATCH",
        message: "Resolved enum case metadata is inconsistent with the item index.",
        originId: input.origin,
        ownerKey: hirOwnerKey(input.context),
        originKey: `origin:${input.origin}`,
        stableDetail: ordinalResult.stableDetail,
      }),
    );
    return errorExpression(input.context, input.origin, ordinalResult.stableDetail);
  }
  const { ordinal, enumItemId, enumTypeId } = ordinalResult.record;
  if (ordinalResult.record.payloadFieldIds.length > 0) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_ENUM_CONSTRUCTOR_ARGUMENT_MISMATCH",
        message: "Payload-bearing enum case requires constructor arguments.",
        originId: input.origin,
        ownerKey: hirOwnerKey(input.context),
        originKey: `origin:${input.origin}`,
        stableDetail: ordinalResult.record.name,
      }),
    );
    return errorExpression(input.context, input.origin, "enum-constructor-payload-required");
  }
  const expression = addExpression(input.context, {
    kind: {
      kind: "enumConstructor",
      constructor: {
        enumTypeId,
        caseItemId: ordinalResult.record.caseItemId,
        caseName: ordinalResult.record.name,
        caseOrdinal: ordinal,
        payloadFields: [],
      },
    },
    type: enumCaseResultType({
      enumItemId,
      enumTypeId,
      expectedType: input.expectedType,
    }),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: input.origin,
  });
  reportTypeMismatch({
    context: input.context,
    sourceOrigin: input.origin,
    expectedType: input.expectedType,
    actualType: expression.type,
  });
  return expression;
}

function enumCaseResultType(input: {
  readonly enumItemId: import("../semantic/ids").ItemId;
  readonly enumTypeId: import("../semantic/ids").TypeId;
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

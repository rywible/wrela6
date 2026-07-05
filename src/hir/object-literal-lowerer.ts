import type { ObjectLiteralExpressionView } from "../frontend/ast/expression-views";
import { checkedTypesEqual, type CheckedType } from "../semantic/surface/type-model";
import type { ItemId, TypeId } from "../semantic/ids";
import type { HirExpression, HirObjectField } from "./hir";
import type { HirOriginId } from "./ids";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic, hirOwnerKey } from "./lowering-context";
import type { LowerExpressionInput } from "./expression-lowerer";
import { checkConstructibility } from "./constructibility";
import { addExpression, errorExpression } from "./expression-builder";
import { resourceKindForCheckedType } from "./type-resource-kind";

type RecursiveLowerExpression = (input: LowerExpressionInput) => HirExpression;

export function lowerObjectLiteral(
  input: LowerExpressionInput & { readonly lowerExpression: RecursiveLowerExpression },
  view: ObjectLiteralExpressionView,
): HirExpression {
  const origin = originForExpression(view, input.context);
  const targetSource = objectTargetSource(input.context, input.expectedType);
  if (input.expectedType === undefined || targetSource === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
        message: "Object literal requires an expected source type.",
        originId: origin,
        ownerKey: hirOwnerKey(input.context),
        originKey: `origin:${origin}`,
        stableDetail: "object-literal",
      }),
    );
    return errorExpression(input.context, origin, "object-type-required");
  }
  const targetType = input.expectedType;

  const resourceKind =
    input.expectedResourceKind ?? resourceKindForCheckedType(input.context, input.expectedType);
  const constructibility = checkConstructibility({
    targetType: input.expectedType,
    targetKind: resourceKind,
    constructorFunctionId: undefined,
    surfaces: input.context.program.proofSurface.constructibilitySurfaces,
    sourceOrigin: view.node.span,
    moduleId: currentHirModuleId(input.context),
  });
  for (const diagnostic of constructibility.diagnostics) {
    input.context.diagnostics.report(diagnostic);
  }
  if (!constructibility.allowed) return errorExpression(input.context, origin, "forged-object");

  const checkedFieldsByName = new Map(
    input.context.program.fields
      .entries()
      .filter((field) => field.itemId === targetSource.itemId)
      .map((field) => [field.name, field]),
  );
  const seenFieldNames = new Set<string>();
  const fields: HirObjectField[] = [];
  for (const fieldView of view.fields()) {
    const fieldOrigin = originForObjectField(fieldView, input.context);
    const name = fieldView.nameText();
    if (name === undefined) {
      reportMissingObjectFieldName({
        context: input.context,
        sourceOrigin: fieldOrigin,
      });
      continue;
    }
    seenFieldNames.add(name);
    const checkedField = checkedFieldsByName.get(name);
    const valueView = fieldView.value();
    const value =
      valueView !== undefined
        ? input.lowerExpression({
            view: valueView,
            context: input.context,
            expectedType: checkedField?.type,
            expectedResourceKind: checkedField?.resourceKind,
          })
        : errorExpression(input.context, fieldOrigin, `missing-object-field:${name}`);
    if (checkedField === undefined) {
      reportObjectFieldMismatch({
        context: input.context,
        sourceOrigin: fieldOrigin,
        stableDetail: `unknown:${name}`,
      });
    } else if (value.type.kind !== "error" && !checkedTypesEqual(checkedField.type, value.type)) {
      reportObjectFieldMismatch({
        context: input.context,
        sourceOrigin: fieldOrigin,
        stableDetail: `type:${name}`,
      });
    }
    fields.push({
      name,
      value,
      sourceOrigin: fieldOrigin,
      ...(checkedField !== undefined ? { fieldId: checkedField.fieldId } : {}),
    });
  }
  for (const checkedField of checkedFieldsByName.values()) {
    if (seenFieldNames.has(checkedField.name)) {
      continue;
    }
    reportObjectFieldMismatch({
      context: input.context,
      sourceOrigin: origin,
      stableDetail: `missing:${checkedField.name}`,
    });
  }

  return addExpression(input.context, {
    kind: { kind: "object", typeId: targetSource.typeId, fields },
    type: targetType,
    resourceKind,
    sourceOrigin: origin,
  });
}

function originForExpression(
  view: ObjectLiteralExpressionView,
  context: HirLoweringContext,
): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function originForObjectField(
  view: ReturnType<ObjectLiteralExpressionView["fields"]>[number],
  context: HirLoweringContext,
): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function reportMissingObjectFieldName(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_MISSING_NAME_TEXT",
      message: "Object literal field is missing name text.",
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "object-field",
    }),
  );
}

function reportObjectFieldMismatch(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_OBJECT_FIELD_TYPE_MISMATCH",
      message: "Object literal field does not match the checked field surface.",
      originId: input.sourceOrigin,
      ownerKey: hirOwnerKey(input.context),
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function objectTargetSource(
  context: HirLoweringContext,
  type: CheckedType | undefined,
): { readonly itemId: ItemId; readonly typeId: TypeId } | undefined {
  if (type?.kind === "source") {
    return { itemId: type.itemId, typeId: type.typeId };
  }
  if (type?.kind !== "applied" || type.constructor.kind !== "source") return undefined;
  const typeRecord = context.index.type(type.constructor.typeId);
  if (typeRecord === undefined) return undefined;
  return { itemId: typeRecord.itemId, typeId: type.constructor.typeId };
}

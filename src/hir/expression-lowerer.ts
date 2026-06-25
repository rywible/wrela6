import {
  CallExpressionView,
  AttemptExpressionView,
  BinaryExpressionView,
  ComparisonExpressionView,
  EqualityExpressionView,
  LiteralExpressionView,
  MemberAccessExpressionView,
  NameExpressionView,
  ObjectLiteralExpressionView,
  TypeApplicationExpressionView,
  UnaryExpressionView,
  type ExpressionView,
} from "../frontend/ast/expression-views";
import { presentTokenSpan } from "../frontend/ast/syntax-query";
import { SyntaxKind } from "../frontend/syntax/syntax-kind";
import type { ResolvedReference } from "../semantic/names/reference";
import { concreteKind, errorKind } from "../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import {
  checkedTypeFingerprint,
  checkedTypesEqual,
  coreCheckedType,
  errorCheckedType,
} from "../semantic/surface/type-model";
import type { CheckedType } from "../semantic/surface/type-model";
import { coreTypeId } from "../semantic/ids";
import type { HirExpression, HirExpressionKind, HirObjectField, HirResourcePlace } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";
import type { HirOriginId } from "./ids";
import { lowerCallExpression } from "./call-lowerer";
import { lowerAttemptExpression } from "./attempt-lowerer";
import { checkConstructibility } from "./constructibility";
import { resourceKindForCheckedType } from "./type-resource-kind";

export interface LowerExpressionInput {
  readonly view: ExpressionView;
  readonly expectedType?: CheckedType;
  readonly context: HirLoweringContext;
}

function originForExpression(view: ExpressionView, context: HirLoweringContext): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node: view.node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function addExpression(
  context: HirLoweringContext,
  input: {
    readonly kind: HirExpressionKind;
    readonly type: CheckedType;
    readonly resourceKind: CheckedResourceKind;
    readonly sourceOrigin: HirOriginId;
    readonly place?: HirResourcePlace;
  },
): HirExpression {
  const expression: HirExpression = {
    expressionId: context.bodyIndex.nextExpressionId(),
    kind: input.kind,
    type: input.type,
    resourceKind: input.resourceKind,
    sourceOrigin: input.sourceOrigin,
    ...(input.place !== undefined ? { place: input.place } : {}),
  };
  context.bodyIndex.addExpression(expression);
  return expression;
}

function errorExpression(
  context: HirLoweringContext,
  sourceOrigin: HirOriginId,
  reason: string,
): HirExpression {
  return addExpression(context, {
    kind: { kind: "error", reason },
    type: errorCheckedType(),
    resourceKind: errorKind(),
    sourceOrigin,
  });
}

function findReferenceBySpan(
  context: HirLoweringContext,
  span: { readonly start: number; readonly end: number },
  kind?: import("../semantic/names/reference").NameReferenceKind,
): ResolvedReference | undefined {
  return context.referenceLookup.referenceForSpan({
    moduleId: currentHirModuleId(context),
    span,
    ...(kind !== undefined ? { kind } : {}),
  });
}

function reportTypeMismatch(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly expectedType: CheckedType | undefined;
  readonly actualType: CheckedType;
}): void {
  if (input.expectedType === undefined) return;
  if (input.actualType.kind === "error") return;
  if (checkedTypesEqual(input.expectedType, input.actualType)) return;
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_EXPRESSION_TYPE_MISMATCH",
      message: "Expression type does not match expected type.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "expression-type",
    }),
  );
}

function isIntegerCheckedType(type: CheckedType | undefined): boolean {
  if (type?.kind !== "core") return false;
  return (
    type.coreTypeId === coreTypeId("u8") ||
    type.coreTypeId === coreTypeId("u16") ||
    type.coreTypeId === coreTypeId("u32") ||
    type.coreTypeId === coreTypeId("u64") ||
    type.coreTypeId === coreTypeId("usize")
  );
}

function maximumIntegerValue(type: CheckedType): bigint | undefined {
  if (type.kind !== "core") return undefined;
  if (type.coreTypeId === coreTypeId("u8")) return 255n;
  if (type.coreTypeId === coreTypeId("u16")) return 65_535n;
  if (type.coreTypeId === coreTypeId("u32")) return 4_294_967_295n;
  if (type.coreTypeId === coreTypeId("u64") || type.coreTypeId === coreTypeId("usize")) {
    return 18_446_744_073_709_551_615n;
  }
  return undefined;
}

function reportIntegerLiteralOutOfRange(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly valueText: string;
  readonly type: CheckedType;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
      message: "Integer literal is outside the expected type range.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: `${input.valueText}:${checkedTypeFingerprint(input.type)}`,
    }),
  );
}

function lowerLiteral(input: LowerExpressionInput, view: LiteralExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const token = view.literalToken();
  const text = view.literalText() ?? "";
  if (token?.kind === SyntaxKind.StringLiteralToken) {
    const expression = addExpression(input.context, {
      kind: { kind: "literal", literal: { kind: "string", value: text } },
      type: coreCheckedType(coreTypeId("string")),
      resourceKind: concreteKind("Copy"),
      sourceOrigin: origin,
    });
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: origin,
      expectedType: input.expectedType,
      actualType: expression.type,
    });
    return expression;
  }

  const value = BigInt(text.length > 0 ? text : "0");
  const integerType = isIntegerCheckedType(input.expectedType)
    ? input.expectedType!
    : coreCheckedType(coreTypeId("u32"));
  const maxValue = maximumIntegerValue(integerType);
  if (maxValue !== undefined && value > maxValue) {
    reportIntegerLiteralOutOfRange({
      context: input.context,
      sourceOrigin: origin,
      valueText: text,
      type: integerType,
    });
    return errorExpression(input.context, origin, "integer-literal-out-of-range");
  }
  const expression = addExpression(input.context, {
    kind: { kind: "literal", literal: { kind: "integer", text, value } },
    type: integerType,
    resourceKind: concreteKind("Copy"),
    sourceOrigin: origin,
  });
  reportTypeMismatch({
    context: input.context,
    sourceOrigin: origin,
    expectedType: input.expectedType,
    actualType: expression.type,
  });
  return expression;
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
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function lowerName(input: LowerExpressionInput, view: NameExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const name = view.nameText() ?? "";
  const nameSpan = presentTokenSpan(view.nameToken()) ?? view.node.span;
  if (name === "true" || name === "false") {
    const expression = addExpression(input.context, {
      kind: { kind: "literal", literal: { kind: "bool", value: name === "true" } },
      type: coreCheckedType(coreTypeId("bool")),
      resourceKind: concreteKind("Copy"),
      sourceOrigin: origin,
    });
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: origin,
      expectedType: input.expectedType,
      actualType: expression.type,
    });
    return expression;
  }

  const local = input.context.locals.lookup(name);
  if (local !== undefined) {
    const place = input.context.places.placeForProjection({
      root:
        local.parameterId !== undefined
          ? { kind: "parameter", parameterId: local.parameterId }
          : { kind: "local", localId: local.localId },
      projection: [],
      type: local.type,
      resourceKind: local.resourceKind,
      sourceOrigin: origin,
    });
    const expression = addExpression(input.context, {
      kind: {
        kind: "name",
        name,
        localId: local.localId,
        ...(local.parameterId !== undefined ? { parameterId: local.parameterId } : {}),
      },
      type: local.type,
      resourceKind: local.resourceKind,
      sourceOrigin: origin,
      place,
    });
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: origin,
      expectedType: input.expectedType,
      actualType: expression.type,
    });
    return expression;
  }

  const imageReference = findReferenceBySpan(input.context, nameSpan, "imageName");
  if (imageReference?.kind === "image") {
    return addExpression(input.context, {
      kind: { kind: "name", name },
      type: errorCheckedType(),
      resourceKind: errorKind(),
      sourceOrigin: origin,
    });
  }

  const reference = findReferenceBySpan(input.context, nameSpan, "functionName");
  if (reference?.kind === "function") {
    const expression = addExpression(input.context, {
      kind: { kind: "name", name, functionId: reference.functionId },
      type: coreCheckedType(coreTypeId("Function")),
      resourceKind: concreteKind("Copy"),
      sourceOrigin: origin,
    });
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: origin,
      expectedType: input.expectedType,
      actualType: expression.type,
    });
    return expression;
  }

  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_NAME_REFERENCE_MISSING",
      message: `Missing HIR reference for '${name}'.`,
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: name,
    }),
  );
  return errorExpression(input.context, origin, `missing-name:${name}`);
}

function imageDevicePlace(input: {
  readonly context: HirLoweringContext;
  readonly fieldId: import("../semantic/ids").FieldId;
  readonly sourceOrigin: HirOriginId;
}):
  | {
      readonly place: HirResourcePlace;
      readonly type: CheckedType;
      readonly resourceKind: CheckedResourceKind;
    }
  | undefined {
  const fieldRecord = input.context.index.field(input.fieldId);
  if (fieldRecord?.role !== "imageDevice") return undefined;
  const imageRecord = input.context.index
    .images()
    .find((image) => image.itemId === fieldRecord.ownerItemId);
  const checkedDevice =
    imageRecord !== undefined && input.context.image?.imageId === imageRecord.id
      ? input.context.image.devices.find((device) => device.fieldId === input.fieldId)
      : undefined;
  const checkedField = input.context.program.fields.get(input.fieldId);
  const type = checkedDevice?.type ?? checkedField?.type ?? errorCheckedType();
  const resourceKind = checkedDevice?.resourceKind ?? errorKind();
  return {
    type,
    resourceKind,
    place: input.context.places.placeForProjection({
      root:
        checkedDevice !== undefined && imageRecord !== undefined
          ? { kind: "imageDevice", imageId: imageRecord.id, fieldId: input.fieldId }
          : { kind: "error" },
      projection: [],
      type,
      resourceKind,
      sourceOrigin: input.sourceOrigin,
    }),
  };
}

function lowerMember(input: LowerExpressionInput, view: MemberAccessExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const receiverView = view.receiver();
  const receiver =
    receiverView !== undefined
      ? lowerExpression({ view: receiverView, context: input.context })
      : errorExpression(input.context, origin, "missing-member-receiver");
  const memberName = view.memberName() ?? "";
  const memberSpan =
    presentTokenSpan(view.memberToken()) ?? view.memberToken()?.span ?? view.node.span;
  const completed =
    input.context.referenceLookup.completedMemberForSpan({
      moduleId: currentHirModuleId(input.context),
      span: memberSpan,
      kind: "memberName",
    }) ??
    input.context.referenceLookup.completedMemberForSpan({
      moduleId: currentHirModuleId(input.context),
      span: memberSpan,
    });

  if (completed?.kind === "field") {
    const imageDevice = imageDevicePlace({
      context: input.context,
      fieldId: completed.fieldId,
      sourceOrigin: origin,
    });
    if (imageDevice !== undefined) {
      return addExpression(input.context, {
        kind: {
          kind: "member",
          receiver,
          fieldId: completed.fieldId,
          memberPlace: imageDevice.place,
        },
        type: imageDevice.type,
        resourceKind: imageDevice.resourceKind,
        sourceOrigin: origin,
        place: imageDevice.place,
      });
    }

    const field = input.context.program.fields.get(completed.fieldId);
    const type = field?.type ?? errorCheckedType();
    const resourceKind = field?.resourceKind ?? errorKind();
    const memberPlace =
      receiver.place !== undefined
        ? input.context.places.placeForProjection({
            root: receiver.place.root,
            projection: [
              ...receiver.place.projection,
              { kind: "field", fieldId: completed.fieldId },
            ],
            type,
            resourceKind,
            sourceOrigin: origin,
          })
        : undefined;
    return addExpression(input.context, {
      kind: { kind: "member", receiver, fieldId: completed.fieldId, memberPlace },
      type,
      resourceKind,
      sourceOrigin: origin,
      place: memberPlace,
    });
  }

  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_MEMBER_REFERENCE_MISSING",
      message: `Missing HIR member reference for '${memberName}'.`,
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: memberName,
    }),
  );
  return errorExpression(input.context, origin, `missing-member:${memberName}`);
}

function lowerObject(
  input: LowerExpressionInput,
  view: ObjectLiteralExpressionView,
): HirExpression {
  const origin = originForExpression(view, input.context);
  if (input.expectedType?.kind !== "source") {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
        message: "Object literal requires an expected source type.",
        originId: origin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${origin}`,
        stableDetail: "object-literal",
      }),
    );
    return errorExpression(input.context, origin, "object-type-required");
  }
  const targetType = input.expectedType;

  const resourceKind = resourceKindForCheckedType(input.context, input.expectedType);
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
      .filter((field) => field.itemId === targetType.itemId)
      .map((field) => [field.name, field]),
  );
  const fields: HirObjectField[] = [];
  for (const fieldView of view.fields()) {
    const fieldOrigin = originForObjectField(fieldView, input.context);
    const name = fieldView.nameText() ?? "";
    const checkedField = checkedFieldsByName.get(name);
    const valueView = fieldView.value();
    const value =
      valueView !== undefined
        ? lowerExpression({
            view: valueView,
            context: input.context,
            expectedType: checkedField?.type,
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

  return addExpression(input.context, {
    kind: { kind: "object", typeId: targetType.typeId, fields },
    type: targetType,
    resourceKind,
    sourceOrigin: origin,
  });
}

function lowerUnary(input: LowerExpressionInput, view: UnaryExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const operandView = view.operand();
  const operand =
    operandView !== undefined
      ? lowerExpression({ view: operandView, context: input.context })
      : errorExpression(input.context, origin, "missing-unary-operand");
  const expression = addExpression(input.context, {
    kind: { kind: "unary", operator: view.operatorToken()?.text ?? "", operand },
    type: operand.type,
    resourceKind: operand.resourceKind,
    sourceOrigin: origin,
  });
  reportTypeMismatch({
    context: input.context,
    sourceOrigin: origin,
    expectedType: input.expectedType,
    actualType: expression.type,
  });
  return expression;
}

function lowerBinaryLike(
  input: LowerExpressionInput,
  view: BinaryExpressionView | ComparisonExpressionView | EqualityExpressionView,
): HirExpression {
  const origin = originForExpression(view, input.context);
  const leftView = view.left();
  const rightView = view.right();
  const left =
    leftView !== undefined
      ? lowerExpression({ view: leftView, context: input.context })
      : errorExpression(input.context, origin, "missing-left-operand");
  const right =
    rightView !== undefined
      ? lowerExpression({ view: rightView, context: input.context })
      : errorExpression(input.context, origin, "missing-right-operand");
  const isPredicate =
    view instanceof ComparisonExpressionView || view instanceof EqualityExpressionView;
  const expression = addExpression(input.context, {
    kind: {
      kind: isPredicate ? "comparison" : "binary",
      operator: view.operatorToken()?.text ?? "",
      left,
      right,
    },
    type: isPredicate ? coreCheckedType(coreTypeId("bool")) : left.type,
    resourceKind: concreteKind("Copy"),
    sourceOrigin: origin,
  });
  reportTypeMismatch({
    context: input.context,
    sourceOrigin: origin,
    expectedType: input.expectedType,
    actualType: expression.type,
  });
  return expression;
}

function lowerAttempt(input: LowerExpressionInput, view: AttemptExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const fallibleView = view.expression();
  const fallibleExpression =
    fallibleView !== undefined
      ? lowerExpression({ view: fallibleView, context: input.context })
      : errorExpression(input.context, origin, "missing-attempt-expression");
  const alternativeView = view.alternative();
  const alternativeExpression =
    alternativeView !== undefined
      ? lowerExpression({ view: alternativeView, context: input.context })
      : undefined;
  const call = fallibleExpression.kind.kind === "call" ? fallibleExpression.kind.call : undefined;
  const contracts =
    call?.calleeFunctionId !== undefined
      ? input.context.program.proofSurface.attemptContracts.get(call.calleeFunctionId)
      : [];
  return lowerAttemptExpression({
    view,
    fallibleExpression,
    ...(alternativeExpression !== undefined ? { alternativeExpression } : {}),
    context: input.context,
    contracts,
  });
}

function lowerTypeApplication(
  input: LowerExpressionInput,
  view: TypeApplicationExpressionView,
): HirExpression {
  const origin = originForExpression(view, input.context);
  const expressionView = view.expression();
  return expressionView !== undefined
    ? lowerExpression({
        view: expressionView,
        expectedType: input.expectedType,
        context: input.context,
      })
    : errorExpression(input.context, origin, "missing-type-application-expression");
}

export function lowerExpression(input: LowerExpressionInput): HirExpression {
  if (input.view instanceof LiteralExpressionView) return lowerLiteral(input, input.view);
  if (input.view instanceof NameExpressionView) return lowerName(input, input.view);
  if (input.view instanceof MemberAccessExpressionView) return lowerMember(input, input.view);
  if (input.view instanceof TypeApplicationExpressionView)
    return lowerTypeApplication(input, input.view);
  if (input.view instanceof ObjectLiteralExpressionView) return lowerObject(input, input.view);
  if (input.view instanceof UnaryExpressionView) return lowerUnary(input, input.view);
  if (
    input.view instanceof BinaryExpressionView ||
    input.view instanceof ComparisonExpressionView ||
    input.view instanceof EqualityExpressionView
  ) {
    return lowerBinaryLike(input, input.view);
  }
  if (input.view instanceof AttemptExpressionView) return lowerAttempt(input, input.view);
  if (input.view instanceof CallExpressionView) {
    return lowerCallExpression({
      view: input.view,
      expectedType: input.expectedType,
      context: input.context,
    });
  }
  const origin = originForExpression(input.view, input.context);
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_UNSUPPORTED_EXPRESSION",
      message: `Unsupported expression kind '${SyntaxKind[input.view.node.kind]}'.`,
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: String(input.view.node.kind),
    }),
  );
  return errorExpression(input.context, origin, "unsupported-expression");
}

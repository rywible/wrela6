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
  checkedTypesEqual,
  coreCheckedType,
  errorCheckedType,
  sourceCheckedType,
} from "../semantic/surface/type-model";
import type { CheckedType } from "../semantic/surface/type-model";
import { coreTypeId, type FieldId, type ItemId, type TypeId } from "../semantic/ids";
import type { HirExpression, HirExpressionKind, HirObjectField, HirResourcePlace } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";
import type { HirOriginId } from "./ids";
import { lowerCallExpression } from "./call-lowerer";
import { lowerAttemptExpression } from "./attempt-lowerer";
import { checkConstructibility } from "./constructibility";
import { resourceKindForCheckedType } from "./type-resource-kind";
import { hirEnumCaseOrdinal } from "./enum-case-model";
import { parseWrIntegerLiteral } from "../shared/integer-literal";
import {
  isArithmeticOperator,
  isBitwiseOperator,
  isIntegerCheckedType,
  isLogicalOperator,
  maximumIntegerValue,
  reportArithmeticOperandDiagnostics,
  reportBitwiseOperandDiagnostics,
  reportArithmeticRequiresInteger,
  reportBinaryOperandTypeMismatch,
  reportIntegerLiteralOutOfRange,
  reportLogicalOperandDiagnostics,
  reportTypeMismatch,
  unaryNegationStableDetail,
} from "./expression-type-diagnostics";

export interface LowerExpressionInput {
  readonly view: ExpressionView;
  readonly expectedType?: CheckedType;
  readonly expectedResourceKind?: CheckedResourceKind;
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

function lowerLiteral(input: LowerExpressionInput, view: LiteralExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const token = view.literalToken();
  const text = view.literalText() ?? "";
  if (token?.kind === SyntaxKind.TrueKeyword || token?.kind === SyntaxKind.FalseKeyword) {
    const expression = addExpression(input.context, {
      kind: {
        kind: "literal",
        literal: { kind: "bool", value: token.kind === SyntaxKind.TrueKeyword },
      },
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
  if (token?.kind === SyntaxKind.StringLiteralToken) {
    const value = view.cookedStringValue() ?? "";
    const expression = addExpression(input.context, {
      kind: { kind: "literal", literal: { kind: "string", value } },
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

  const value = parseWrIntegerLiteral(text) ?? 0n;
  const integerType = isIntegerCheckedType(input.expectedType)
    ? input.expectedType!
    : coreCheckedType(coreTypeId("u64"));
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

function lowerName(input: LowerExpressionInput, view: NameExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const name = view.nameText() ?? "";
  const nameSpan = presentTokenSpan(view.nameToken()) ?? view.node.span;
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
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_IMAGE_NAME_NOT_A_VALUE",
        message: "Image names are declarations and cannot be used as values.",
        originId: origin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${origin}`,
        stableDetail: name,
      }),
    );
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

function lowerEnumCaseMember(input: {
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
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${input.origin}`,
        stableDetail: ordinalResult.stableDetail,
      }),
    );
    return errorExpression(input.context, input.origin, ordinalResult.stableDetail);
  }
  const { ordinal, enumItemId, enumTypeId } = ordinalResult.record;
  const expression = addExpression(input.context, {
    kind: {
      kind: "literal",
      literal: { kind: "integer", text: String(ordinal), value: BigInt(ordinal) },
    },
    type: sourceCheckedType({ itemId: enumItemId, typeId: enumTypeId }),
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

function ownerItemIdForMemberFallback(
  context: HirLoweringContext,
  type: CheckedType,
): ItemId | undefined {
  if (type.kind === "source") return type.itemId;
  if (type.kind !== "applied" || type.constructor.kind !== "source") return undefined;
  return context.index.type(type.constructor.typeId)?.itemId;
}

function completedFieldForReceiver(input: {
  readonly context: HirLoweringContext;
  readonly receiver: HirExpression;
  readonly memberName: string;
}): FieldId | undefined {
  const ownerItemId = ownerItemIdForMemberFallback(input.context, input.receiver.type);
  if (ownerItemId === undefined) return undefined;
  return input.context.fieldLookupByOwnerAndName().get(ownerItemId)?.get(input.memberName)?.fieldId;
}

function lowerMember(input: LowerExpressionInput, view: MemberAccessExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
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
  const enumCaseReference =
    completed ??
    input.context.referenceLookup.referenceForSpan({
      moduleId: currentHirModuleId(input.context),
      span: memberSpan,
      kind: "enumCase",
    }) ??
    input.context.referenceLookup.referenceForSpan({
      moduleId: currentHirModuleId(input.context),
      span: memberSpan,
      kind: "memberName",
    });

  const enumCase = lowerEnumCaseMember({
    context: input.context,
    completed: enumCaseReference,
    origin,
    expectedType: input.expectedType,
  });
  if (enumCase !== undefined) return enumCase;

  const receiverView = view.receiver();
  const receiver =
    receiverView !== undefined
      ? lowerExpression({ view: receiverView, context: input.context })
      : errorExpression(input.context, origin, "missing-member-receiver");

  const fieldId =
    completed?.kind === "field"
      ? completed.fieldId
      : completedFieldForReceiver({
          context: input.context,
          receiver,
          memberName,
        });

  if (fieldId !== undefined) {
    const imageDevice = imageDevicePlace({
      context: input.context,
      fieldId,
      sourceOrigin: origin,
    });
    if (imageDevice !== undefined) {
      return addExpression(input.context, {
        kind: {
          kind: "member",
          receiver,
          fieldId,
          memberPlace: imageDevice.place,
        },
        type: imageDevice.type,
        resourceKind: imageDevice.resourceKind,
        sourceOrigin: origin,
        place: imageDevice.place,
      });
    }

    const field = input.context.program.fields.get(fieldId);
    const type = field?.type ?? errorCheckedType();
    const resourceKind = field?.resourceKind ?? errorKind();
    const memberPlace =
      receiver.place !== undefined
        ? input.context.places.placeForProjection({
            root: receiver.place.root,
            projection: [...receiver.place.projection, { kind: "field", fieldId }],
            type,
            resourceKind,
            sourceOrigin: origin,
          })
        : undefined;
    return addExpression(input.context, {
      kind: { kind: "member", receiver, fieldId, memberPlace },
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
  const targetSource = objectTargetSource(input.context, input.expectedType);
  if (input.expectedType === undefined || targetSource === undefined) {
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
    const name = fieldView.nameText() ?? "";
    if (name.length > 0) {
      seenFieldNames.add(name);
    }
    const checkedField = checkedFieldsByName.get(name);
    const valueView = fieldView.value();
    const value =
      valueView !== undefined
        ? lowerExpression({
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

function lowerUnary(input: LowerExpressionInput, view: UnaryExpressionView): HirExpression {
  const origin = originForExpression(view, input.context);
  const operandView = view.operand();
  const operand =
    operandView !== undefined
      ? lowerExpression({ view: operandView, context: input.context })
      : errorExpression(input.context, origin, "missing-unary-operand");
  if (view.operatorToken()?.kind === SyntaxKind.MinusToken && operand.type.kind !== "error") {
    reportArithmeticRequiresInteger({
      context: input.context,
      sourceOrigin: origin,
      stableDetail: unaryNegationStableDetail(operand.type),
      message: "Integer negation is not supported in HIR.",
    });
  }
  const expression = addExpression(input.context, {
    kind: { kind: "unary", operator: view.operatorToken()?.green.lexeme ?? "", operand },
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

function expectedIntegerType(type: CheckedType | undefined): CheckedType | undefined {
  return isIntegerCheckedType(type) ? type : undefined;
}

function lowerBinaryOperand(input: {
  readonly view: ExpressionView | undefined;
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly missingReason: string;
  readonly expectedType?: CheckedType;
}): HirExpression {
  return input.view !== undefined
    ? lowerExpression({
        view: input.view,
        context: input.context,
        ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
      })
    : errorExpression(input.context, input.origin, input.missingReason);
}

function lowerBinaryOperands(input: {
  readonly context: HirLoweringContext;
  readonly origin: HirOriginId;
  readonly leftView: ExpressionView | undefined;
  readonly rightView: ExpressionView | undefined;
  readonly expectedType?: CheckedType;
}): { readonly left: HirExpression; readonly right: HirExpression } {
  const leftIsLiteral = input.leftView instanceof LiteralExpressionView;
  const rightIsLiteral = input.rightView instanceof LiteralExpressionView;

  if (leftIsLiteral && !rightIsLiteral) {
    const right = lowerBinaryOperand({
      view: input.rightView,
      context: input.context,
      origin: input.origin,
      missingReason: "missing-right-operand",
    });
    return {
      left: lowerBinaryOperand({
        view: input.leftView,
        context: input.context,
        origin: input.origin,
        missingReason: "missing-left-operand",
        ...(expectedIntegerType(right.type) !== undefined
          ? { expectedType: expectedIntegerType(right.type) }
          : {}),
      }),
      right,
    };
  }

  const left = lowerBinaryOperand({
    view: input.leftView,
    context: input.context,
    origin: input.origin,
    missingReason: "missing-left-operand",
    ...(leftIsLiteral && expectedIntegerType(input.expectedType) !== undefined
      ? { expectedType: expectedIntegerType(input.expectedType) }
      : {}),
  });
  const rightExpectedType =
    expectedIntegerType(left.type) ?? expectedIntegerType(input.expectedType);
  const right = lowerBinaryOperand({
    view: input.rightView,
    context: input.context,
    origin: input.origin,
    missingReason: "missing-right-operand",
    ...(rightIsLiteral && rightExpectedType !== undefined
      ? { expectedType: rightExpectedType }
      : {}),
  });
  return { left, right };
}

function lowerBinaryLike(
  input: LowerExpressionInput,
  view: BinaryExpressionView | ComparisonExpressionView | EqualityExpressionView,
): HirExpression {
  const origin = originForExpression(view, input.context);
  const leftView = view.left();
  const rightView = view.right();
  const { left, right } = lowerBinaryOperands({
    context: input.context,
    origin,
    leftView,
    rightView,
    ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
  });
  const operatorKind = view.operatorToken()?.kind;
  const operator = view.operatorToken()?.green.lexeme ?? "";
  reportBinaryOperandTypeMismatch({
    context: input.context,
    sourceOrigin: origin,
    operator,
    leftType: left.type,
    rightType: right.type,
  });
  if (view instanceof BinaryExpressionView && isArithmeticOperator(operatorKind)) {
    reportArithmeticOperandDiagnostics({
      context: input.context,
      sourceOrigin: origin,
      operator,
      leftType: left.type,
      rightType: right.type,
    });
  }
  if (view instanceof BinaryExpressionView && isBitwiseOperator(operatorKind)) {
    reportBitwiseOperandDiagnostics({
      context: input.context,
      sourceOrigin: origin,
      operator,
      leftType: left.type,
      rightType: right.type,
    });
  }
  if (view instanceof BinaryExpressionView && isLogicalOperator(operatorKind)) {
    reportLogicalOperandDiagnostics({
      context: input.context,
      sourceOrigin: origin,
      operator,
      leftType: left.type,
      rightType: right.type,
    });
  }
  const isPredicate =
    view instanceof ComparisonExpressionView || view instanceof EqualityExpressionView;
  const isLogical = view instanceof BinaryExpressionView && isLogicalOperator(operatorKind);
  const expression = addExpression(input.context, {
    kind: {
      kind: isPredicate ? "comparison" : "binary",
      operator,
      left,
      right,
    },
    type: isPredicate || isLogical ? coreCheckedType(coreTypeId("bool")) : left.type,
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
    ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
    ...(input.expectedResourceKind !== undefined
      ? { expectedResourceKind: input.expectedResourceKind }
      : {}),
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

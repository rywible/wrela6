import {
  BinaryExpressionView,
  LiteralExpressionView,
  MemberAccessExpressionView,
  NameExpressionView,
  type ExpressionView,
} from "../frontend/ast/expression-views";
import { presentTokenSpan } from "../frontend/ast/syntax-query";
import type { RedNode } from "../frontend/syntax/red-node";
import { SyntaxKind } from "../frontend/syntax";
import { SourceSpan } from "../shared/source-span";
import type { FieldId, ItemId, TypeId } from "../semantic/ids";
import type { HirLayoutExpression } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";
import type { HirOriginId } from "./ids";
import { hirEnumCaseOrdinal } from "./enum-case-model";

export type LayoutFieldKind = "parameter" | "layout" | "derived";

export interface ValidatedBufferLayoutFieldContext {
  readonly ownerItemId: ItemId;
  readonly typeId: TypeId;
  readonly availableFields: ReadonlyMap<
    string,
    { readonly fieldId: FieldId; readonly fieldKind: LayoutFieldKind }
  >;
}

export type LowerLayoutExpressionResult =
  | { readonly kind: "ok"; readonly expression: HirLayoutExpression }
  | { readonly kind: "error" };

function originForLayoutExpression(node: RedNode, context: HirLoweringContext): HirOriginId {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node,
    ownerItemId: context.ownerItemId,
  });
}

function reportUnsupportedLayoutExpression(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly spanStart?: number;
  readonly spanEnd?: number;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_UNSUPPORTED_LAYOUT_EXPRESSION",
      message: "Validated buffer layout expression is not supported in HIR lowering.",
      originId: input.sourceOrigin,
      ownerKey: input.ownerKey,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
      ...(input.spanStart !== undefined ? { spanStart: input.spanStart } : {}),
      ...(input.spanEnd !== undefined ? { spanEnd: input.spanEnd } : {}),
    }),
  );
}

function lowerIntegerLiteral(
  view: LiteralExpressionView,
  input: {
    readonly context: HirLoweringContext;
    readonly ownerKey: string;
  },
): LowerLayoutExpressionResult {
  const sourceOrigin = originForLayoutExpression(view.node, input.context);
  const token = view.literalToken();
  if (token?.kind !== SyntaxKind.IntegerLiteralToken) {
    reportUnsupportedLayoutExpression({
      context: input.context,
      sourceOrigin,
      ownerKey: input.ownerKey,
      stableDetail: view.literalText() ?? "non-integer-literal",
      spanStart: token !== undefined ? presentTokenSpan(token)?.start : undefined,
      spanEnd: token !== undefined ? presentTokenSpan(token)?.end : undefined,
    });
    return { kind: "error" };
  }
  const text = view.literalText() ?? "0";
  return {
    kind: "ok",
    expression: {
      kind: "integerLiteral",
      value: BigInt(text.length > 0 ? text : "0"),
      sourceOrigin,
    },
  };
}

function lowerFieldNameReference(
  view: NameExpressionView,
  input: {
    readonly context: HirLoweringContext;
    readonly fieldContext: ValidatedBufferLayoutFieldContext;
    readonly ownerKey: string;
  },
): LowerLayoutExpressionResult {
  const sourceOrigin = originForLayoutExpression(view.node, input.context);
  const name = view.nameText();
  if (name === undefined) {
    reportUnsupportedLayoutExpression({
      context: input.context,
      sourceOrigin,
      ownerKey: input.ownerKey,
      stableDetail: "missing-name",
    });
    return { kind: "error" };
  }
  const field = input.fieldContext.availableFields.get(name);
  if (field === undefined) {
    reportUnsupportedLayoutExpression({
      context: input.context,
      sourceOrigin,
      ownerKey: input.ownerKey,
      stableDetail: name,
    });
    return { kind: "error" };
  }
  return {
    kind: "ok",
    expression: {
      kind: "fieldValue",
      fieldId: field.fieldId,
      fieldKind: field.fieldKind,
      sourceOrigin,
    },
  };
}

function lowerMemberAccess(
  view: MemberAccessExpressionView,
  input: {
    readonly context: HirLoweringContext;
    readonly fieldContext: ValidatedBufferLayoutFieldContext;
    readonly ownerKey: string;
  },
): LowerLayoutExpressionResult {
  const sourceOrigin = originForLayoutExpression(view.node, input.context);
  const receiver = view.receiver();
  const memberName = view.memberName();
  const memberSpan =
    presentTokenSpan(view.memberToken()) ?? view.memberToken()?.span ?? view.node.span;
  const enumCaseReference =
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
  const referencedCaseItem =
    enumCaseReference?.kind === "item"
      ? input.context.index.item(enumCaseReference.itemId)
      : undefined;
  const localEnumCaseItem =
    referencedCaseItem ??
    (receiver instanceof NameExpressionView && memberName !== undefined
      ? (() => {
          const ownerItem = input.context.index.item(input.fieldContext.ownerItemId);
          const enumItem = input.context.index
            .itemsInModule(ownerItem?.moduleId ?? currentHirModuleId(input.context))
            .find(
              (candidate) =>
                candidate.kind === "enum" &&
                candidate.parentItemId === undefined &&
                candidate.name === receiver.nameText(),
            );
          if (enumItem === undefined) return undefined;
          return input.context.index
            .items()
            .find(
              (candidate) =>
                candidate.kind === "enumCase" &&
                candidate.parentItemId === enumItem.id &&
                candidate.name === memberName,
            );
        })()
      : undefined);
  if (localEnumCaseItem !== undefined) {
    const ordinalResult = hirEnumCaseOrdinal({
      index: input.context.index,
      caseItemId: localEnumCaseItem.id,
    });
    if (ordinalResult.kind === "ok") {
      const ordinal = ordinalResult.record.ordinal;
      return {
        kind: "ok",
        expression: {
          kind: "integerLiteral",
          value: BigInt(ordinal),
          sourceOrigin,
        },
      };
    }
    if (ordinalResult.kind === "broken") {
      reportUnsupportedLayoutExpression({
        context: input.context,
        sourceOrigin,
        ownerKey: input.ownerKey,
        stableDetail: ordinalResult.stableDetail,
      });
      return { kind: "error" };
    }
  }
  if (
    receiver instanceof NameExpressionView &&
    receiver.nameText() === "source" &&
    memberName === "len"
  ) {
    return {
      kind: "ok",
      expression: {
        kind: "sourceLength",
        sourceOrigin,
      },
    };
  }
  reportUnsupportedLayoutExpression({
    context: input.context,
    sourceOrigin,
    ownerKey: input.ownerKey,
    stableDetail: memberName ?? "member-access",
  });
  return { kind: "error" };
}

function lowerBinaryExpression(
  view: BinaryExpressionView,
  input: {
    readonly context: HirLoweringContext;
    readonly fieldContext: ValidatedBufferLayoutFieldContext;
    readonly ownerKey: string;
  },
): LowerLayoutExpressionResult {
  const sourceOrigin = originForLayoutExpression(view.node, input.context);
  const operatorKind = view.operatorToken()?.kind;
  const arithmeticKind =
    operatorKind === SyntaxKind.PlusToken
      ? "add"
      : operatorKind === SyntaxKind.MinusToken
        ? "subtract"
        : operatorKind === SyntaxKind.StarToken
          ? "multiply"
          : undefined;
  if (arithmeticKind === undefined) {
    reportUnsupportedLayoutExpression({
      context: input.context,
      sourceOrigin,
      ownerKey: input.ownerKey,
      stableDetail: "binary-operator",
    });
    return { kind: "error" };
  }
  const left = lowerLayoutExpression({
    view: view.left(),
    context: input.context,
    fieldContext: input.fieldContext,
    ownerKey: input.ownerKey,
  });
  if (left.kind === "error") {
    return left;
  }
  const right = lowerLayoutExpression({
    view: view.right(),
    context: input.context,
    fieldContext: input.fieldContext,
    ownerKey: input.ownerKey,
  });
  if (right.kind === "error") {
    return right;
  }
  return {
    kind: "ok",
    expression: {
      kind: arithmeticKind,
      left: left.expression,
      right: right.expression,
      sourceOrigin,
    },
  };
}

export function lowerLayoutExpression(input: {
  readonly view: ExpressionView | undefined;
  readonly context: HirLoweringContext;
  readonly fieldContext: ValidatedBufferLayoutFieldContext;
  readonly ownerKey: string;
}): LowerLayoutExpressionResult {
  const view = input.view;
  if (view === undefined) {
    const sourceOrigin = input.context.origins.forSynthetic({
      moduleId: currentHirModuleId(input.context),
      span: SourceSpan.from(0, 0),
      stableDetail: "missing-layout-expression",
      ownerItemId: input.fieldContext.ownerItemId,
    });
    reportUnsupportedLayoutExpression({
      context: input.context,
      sourceOrigin,
      ownerKey: input.ownerKey,
      stableDetail: "missing-expression",
    });
    return { kind: "error" };
  }

  if (view instanceof LiteralExpressionView) {
    return lowerIntegerLiteral(view, input);
  }
  if (view instanceof NameExpressionView) {
    return lowerFieldNameReference(view, input);
  }
  if (view instanceof MemberAccessExpressionView) {
    return lowerMemberAccess(view, input);
  }
  if (view instanceof BinaryExpressionView) {
    return lowerBinaryExpression(view, input);
  }

  const sourceOrigin = originForLayoutExpression(view.node, input.context);
  reportUnsupportedLayoutExpression({
    context: input.context,
    sourceOrigin,
    ownerKey: input.ownerKey,
    stableDetail: view.node.kind.toString(),
  });
  return { kind: "error" };
}

export function lowerDerivedCaseCondition(input: {
  readonly view: ExpressionView | undefined;
  readonly context: HirLoweringContext;
  readonly fieldContext: ValidatedBufferLayoutFieldContext;
  readonly ownerKey: string;
}): HirLayoutExpression | { readonly kind: "otherwise" } | undefined {
  const view = input.view;
  if (view instanceof NameExpressionView && view.nameText() === "otherwise") {
    return { kind: "otherwise" };
  }
  const lowered = lowerLayoutExpression(input);
  if (lowered.kind === "error") {
    return undefined;
  }
  return lowered.expression;
}

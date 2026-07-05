import { errorKind, type CheckedResourceKind } from "../semantic/surface/resource-kind";
import { errorCheckedType, type CheckedType } from "../semantic/surface/type-model";
import type { HirExpression, HirExpressionKind, HirResourcePlace } from "./hir";
import type { HirOriginId } from "./ids";
import type { HirLoweringContext } from "./lowering-context";

export function addExpression(
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

export function errorExpression(
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

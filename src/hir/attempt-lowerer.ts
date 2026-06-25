import type { CheckedAttemptContractSurface } from "../semantic/surface/proof-contracts";
import { functionId } from "../semantic/ids";
import { errorKind } from "../semantic/surface/resource-kind";
import { errorCheckedType } from "../semantic/surface/type-model";
import type { AttemptExpressionView } from "../frontend/ast/expression-views";
import type { HirExpression, HirAttempt } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { ownedAttemptId } from "./ids";
import { hirDiagnostic } from "./lowering-context";
import { resourceKindForCheckedType } from "./type-resource-kind";

function expressionCall(input: HirExpression) {
  return input.kind?.kind === "call" ? input.kind.call : undefined;
}

function declaredInputPlaces(input: {
  readonly contract: CheckedAttemptContractSurface;
  readonly fallibleExpression: HirExpression;
  readonly context: HirLoweringContext;
}): import("./hir").HirResourcePlace[] | undefined {
  const call = expressionCall(input.fallibleExpression);
  const places: import("./hir").HirResourcePlace[] = [];
  for (const position of input.contract.inputs) {
    const place =
      position.kind === "receiver"
        ? (call?.receiver?.place ?? input.fallibleExpression.place)
        : (call?.arguments.find((argument) => argument.parameterId === position.parameterId)
            ?.place ?? input.fallibleExpression.place);
    if (place === undefined) {
      input.context.diagnostics.report(
        hirDiagnostic({
          code: "HIR_ATTEMPT_INPUT_NOT_PLACE",
          message: "Attempt contract input does not map to a resource place.",
          originId: input.fallibleExpression.sourceOrigin,
          ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
          originKey: `origin:${input.fallibleExpression.sourceOrigin}`,
          stableDetail: "attempt-input",
        }),
      );
      return undefined;
    }
    places.push(place);
  }
  return places;
}

export function lowerAttemptExpression(input: {
  readonly view: AttemptExpressionView | undefined;
  readonly fallibleExpression: HirExpression;
  readonly alternativeExpression?: HirExpression;
  readonly context: HirLoweringContext;
  readonly contracts?: readonly CheckedAttemptContractSurface[];
}): HirExpression {
  const owner = {
    kind: "function" as const,
    functionId: input.context.ownerFunctionId ?? functionId(0),
  };
  const contract = input.contracts?.[0];
  if (contract === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_UNLINKED_ATTEMPT_CONTRACT",
        message: "Attempt expression is not linked to a checked attempt contract.",
        originId: input.fallibleExpression.sourceOrigin,
        ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
        originKey: `origin:${input.fallibleExpression.sourceOrigin}`,
        stableDetail: "attempt-contract",
      }),
    );
    const expression: HirExpression = {
      expressionId: input.context.bodyIndex.nextExpressionId(),
      kind: { kind: "error", reason: "attempt-contract-missing" },
      type: errorCheckedType(),
      resourceKind: errorKind(),
      sourceOrigin: input.fallibleExpression.sourceOrigin,
    };
    input.context.bodyIndex.addExpression(expression);
    return expression;
  }
  const declaredPlaces = declaredInputPlaces({
    contract,
    fallibleExpression: input.fallibleExpression,
    context: input.context,
  });
  if (declaredPlaces === undefined) {
    const expression: HirExpression = {
      expressionId: input.context.bodyIndex.nextExpressionId(),
      kind: { kind: "error", reason: "attempt-input-not-place" },
      type: errorCheckedType(),
      resourceKind: errorKind(),
      sourceOrigin: input.fallibleExpression.sourceOrigin,
    };
    input.context.bodyIndex.addExpression(expression);
    return expression;
  }
  const attempt: HirAttempt = {
    attemptId: ownedAttemptId(owner, input.context.proofMetadata.count("attempt")),
    attemptExpressionId: input.context.bodyIndex.nextExpressionId(),
    fallibleExpression: input.fallibleExpression,
    ...(input.alternativeExpression !== undefined
      ? { alternativeExpression: input.alternativeExpression }
      : {}),
    declaredInputPlaces: declaredPlaces,
    sourceOrigin: input.fallibleExpression.sourceOrigin,
  };
  input.context.proofMetadata.addAttempt(attempt);
  const expression: HirExpression = {
    expressionId: attempt.attemptExpressionId,
    kind: { kind: "attempt", attempt },
    type: contract.okType,
    resourceKind: resourceKindForCheckedType(input.context, contract.okType),
    sourceOrigin: input.fallibleExpression.sourceOrigin,
  };
  input.context.bodyIndex.addExpression(expression);
  return expression;
}

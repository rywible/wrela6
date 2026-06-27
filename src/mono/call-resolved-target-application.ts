import { instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import type { MonoExpression, MonoResolvedCallTarget } from "./mono-hir";
import type { ReachabilityState } from "./reachability-shared";

export function callResolvedTargetKey(input: {
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpression["expressionId"];
}): string {
  return `${String(input.callerInstanceId)}|${instantiatedHirIdKey(input.callExpressionId)}`;
}

export function recordCallResolvedTarget(input: {
  readonly state: ReachabilityState;
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpression["expressionId"];
  readonly resolvedTarget: MonoResolvedCallTarget;
}): void {
  input.state.callResolvedTargets.set(
    callResolvedTargetKey({
      callerInstanceId: input.callerInstanceId,
      callExpressionId: input.callExpressionId,
    }),
    input.resolvedTarget,
  );
}

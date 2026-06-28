import { hirTable } from "../hir/hir-table";
import { hirOriginId, type HirOriginId } from "../hir/ids";
import { monoDiagnostic } from "./diagnostics";
import type { MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoExternalRoot,
  MonoFunctionInstance,
  MonoReachableFunction,
  MonoReachableFunctionReason,
  MonoReachableFunctionTable,
} from "./mono-hir";
import { monoResolvedCallTargetEntriesForCaller } from "./resolved-call-targets";
import type { ReachabilityState } from "./reachability-shared";

const MONO_REACHABLE_FUNCTION_REASON_RANK: Readonly<Record<MonoReachableFunctionReason, number>> = {
  imageEntry: 0,
  deviceHandler: 1,
  hardwareCallback: 2,
  targetRequired: 3,
  sourceCall: 4,
};

export type ReachableCallOriginResolution =
  | { readonly kind: "resolved"; readonly origin: HirOriginId }
  | { readonly kind: "unresolved"; readonly detail: string };

export function monoStringSourceOriginAsHirOriginId(sourceOrigin: string): HirOriginId | undefined {
  if (sourceOrigin.length === 0) {
    return undefined;
  }
  let parsed = 0;
  for (let index = 0; index < sourceOrigin.length; index += 1) {
    const code = sourceOrigin.charCodeAt(index);
    if (code < 48 || code > 57) {
      return undefined;
    }
    parsed = parsed * 10 + (code - 48);
  }
  return hirOriginId(parsed);
}

export function callOriginForReachableFunction(input: {
  readonly caller: MonoFunctionInstance;
  readonly callExpressionId: MonoExpressionId;
}): ReachableCallOriginResolution {
  const expression = input.caller.bodyIndex?.expressions.get(input.callExpressionId);
  if (expression !== undefined) {
    const expressionOrigin = monoStringSourceOriginAsHirOriginId(expression.sourceOrigin);
    if (expressionOrigin !== undefined) {
      return { kind: "resolved", origin: expressionOrigin };
    }
  }
  const callerOrigin = input.caller.hirSourceOrigin;
  if (callerOrigin === undefined) {
    return {
      kind: "unresolved",
      detail:
        expression !== undefined
          ? `expression:${expression.sourceOrigin}`
          : `caller:${input.caller.sourceOrigin}`,
    };
  }
  return { kind: "resolved", origin: callerOrigin };
}

export function recordMonoReachableFunction(
  state: ReachabilityState,
  entry: MonoReachableFunction,
): void {
  const key = String(entry.functionInstanceId);
  const existing = state.reachableFunctions.get(key);
  if (existing === undefined) {
    state.reachableFunctions.set(key, entry);
    return;
  }
  if (
    MONO_REACHABLE_FUNCTION_REASON_RANK[entry.reason] <
    MONO_REACHABLE_FUNCTION_REASON_RANK[existing.reason]
  ) {
    state.reachableFunctions.set(key, entry);
  }
}

function recordReachableFunctionFromSourceCall(input: {
  readonly state: ReachabilityState;
  readonly caller: MonoFunctionInstance;
  readonly callee: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
  readonly externalRootOriginByInstanceId: ReadonlyMap<string, HirOriginId>;
  readonly queue: MonoInstanceId[];
}): void {
  const originResolution = callOriginForReachableFunction({
    caller: input.caller,
    callExpressionId: input.callExpressionId,
  });
  let origin: HirOriginId;
  if (originResolution.kind === "resolved") {
    origin = originResolution.origin;
  } else {
    const externalRootOrigin = input.externalRootOriginByInstanceId.get(String(input.callee));
    if (externalRootOrigin === undefined) {
      input.state.diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_UNRESOLVED_REACHABLE_CALL_ORIGIN",
          message:
            "Reachable function call origin could not be resolved from expression or caller metadata.",
          ownerKey: `function:${String(input.caller.instanceId)}`,
          rootCauseKey: "reachable-call-origin",
          stableDetail: `call:${String(input.callExpressionId)}:${originResolution.detail}`,
          sourceOrigin: input.caller.sourceOrigin,
        }),
      );
      return;
    }
    origin = externalRootOrigin;
  }
  const key = String(input.callee);
  const existing = input.state.reachableFunctions.get(key);
  if (existing === undefined) {
    recordMonoReachableFunction(input.state, {
      functionInstanceId: input.callee,
      reason: "sourceCall",
      origin,
    });
    input.queue.push(input.callee);
    return;
  }
  recordMonoReachableFunction(input.state, {
    functionInstanceId: input.callee,
    reason: "sourceCall",
    origin,
  });
}

export function buildMonoReachableFunctionTable(
  entries: readonly MonoReachableFunction[],
): MonoReachableFunctionTable {
  const table = hirTable<MonoInstanceId, MonoReachableFunction>({
    entries,
    keyOf: (entry) => String(entry.functionInstanceId),
    lookupKeyOf: (id) => String(id),
  });
  return {
    get(key) {
      return table.get(key);
    },
    has(key) {
      return table.get(key) !== undefined;
    },
    entries() {
      return table.entries();
    },
  };
}

function closeReachableFunctionsFromCallGraph(input: {
  readonly state: ReachabilityState;
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly functions: readonly MonoFunctionInstance[];
}): void {
  const functionByInstanceId = new Map<string, MonoFunctionInstance>();
  for (const functionInstance of input.functions) {
    functionByInstanceId.set(String(functionInstance.instanceId), functionInstance);
  }
  const externalRootOriginByInstanceId = new Map<string, HirOriginId>();
  for (const root of input.externalRoots) {
    externalRootOriginByInstanceId.set(String(root.functionInstanceId), root.origin);
  }

  input.state.reachableFunctions.clear();

  const queue: MonoInstanceId[] = [];
  for (const root of input.externalRoots) {
    recordMonoReachableFunction(input.state, {
      functionInstanceId: root.functionInstanceId,
      reason: root.reason,
      origin: root.origin,
    });
    queue.push(root.functionInstanceId);
  }

  while (queue.length > 0) {
    const callerInstanceId = queue.shift();
    if (callerInstanceId === undefined) {
      continue;
    }
    const caller = functionByInstanceId.get(String(callerInstanceId));
    if (caller === undefined) {
      continue;
    }
    for (const resolvedCallTargetEntry of monoResolvedCallTargetEntriesForCaller({
      callResolvedTargets: input.state.callResolvedTargets,
      callerInstanceId,
    })) {
      if (resolvedCallTargetEntry.resolvedTarget.kind !== "sourceFunction") {
        continue;
      }
      const callee = resolvedCallTargetEntry.resolvedTarget.targetFunctionInstanceId;
      if (!functionByInstanceId.has(String(callee))) {
        continue;
      }
      recordReachableFunctionFromSourceCall({
        state: input.state,
        caller,
        callee,
        callExpressionId: resolvedCallTargetEntry.callExpressionId,
        externalRootOriginByInstanceId,
        queue,
      });
    }
  }
}

export function finalizeMonoReachableFunctionTable(input: {
  readonly state: ReachabilityState;
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly functions: readonly MonoFunctionInstance[];
}): MonoReachableFunctionTable {
  closeReachableFunctionsFromCallGraph(input);
  const sortedEntries = [...input.state.reachableFunctions.values()].sort((left, right) =>
    String(left.functionInstanceId) < String(right.functionInstanceId)
      ? -1
      : String(left.functionInstanceId) > String(right.functionInstanceId)
        ? 1
        : 0,
  );
  return buildMonoReachableFunctionTable(sortedEntries);
}

import { compareCodeUnitStrings } from "./deterministic-sort";
import { type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoResolvedCallTarget,
  MonoResolvedCallTargetEntry,
  MonoResolvedCallTargetTable,
} from "./mono-hir";
import { callResolvedTargetKey } from "./call-resolved-target-application";
import type { ReachabilityState } from "./reachability-shared";

export type MonoResolvedCallTargetLookupKey = string;

export type { MonoResolvedCallTargetEntry } from "./mono-hir";

export type { MonoResolvedCallTargetTable } from "./mono-hir";

export function emptyMonoResolvedCallTargetTable(): MonoResolvedCallTargetTable {
  return {
    get: () => undefined,
    entries: () => [],
  };
}

function monoResolvedCallTargetTableFromMap(
  lookup: ReadonlyMap<MonoResolvedCallTargetLookupKey, MonoResolvedCallTargetEntry>,
): MonoResolvedCallTargetTable {
  const sortedKeys = [...lookup.keys()].sort(compareCodeUnitStrings);
  return {
    get(key: MonoResolvedCallTargetLookupKey): MonoResolvedCallTarget | undefined {
      return lookup.get(key)?.resolvedTarget;
    },
    entries(): readonly MonoResolvedCallTarget[] {
      return sortedKeys.map((key) => {
        const entry = lookup.get(key);
        if (entry === undefined) {
          throw new RangeError(`Resolved call target table is missing entry for key ${key}.`);
        }
        return entry.resolvedTarget;
      });
    },
  };
}

export function monoResolvedCallTargetEntriesFromState(
  state: ReachabilityState,
): readonly MonoResolvedCallTargetEntry[] {
  return [...state.callResolvedTargets.values()].sort((left, right) =>
    compareCodeUnitStrings(
      callResolvedTargetKey({
        callerInstanceId: left.callerInstanceId,
        callExpressionId: left.callExpressionId,
      }),
      callResolvedTargetKey({
        callerInstanceId: right.callerInstanceId,
        callExpressionId: right.callExpressionId,
      }),
    ),
  );
}

export function buildMonoResolvedCallTargetTable(
  state: ReachabilityState,
): MonoResolvedCallTargetTable {
  return monoResolvedCallTargetTableFromMap(state.callResolvedTargets);
}

export function lookupMonoResolvedCallTarget(input: {
  readonly table: MonoResolvedCallTargetTable;
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
}): MonoResolvedCallTarget | undefined {
  return input.table.get(
    callResolvedTargetKey({
      callerInstanceId: input.callerInstanceId,
      callExpressionId: input.callExpressionId,
    }),
  );
}

export function monoResolvedCallTargetTableFromEntries(
  entries: readonly {
    readonly callerInstanceId: MonoInstanceId;
    readonly callExpressionId: MonoExpressionId;
    readonly resolvedTarget: MonoResolvedCallTarget;
  }[],
): MonoResolvedCallTargetTable {
  if (entries.length === 0) {
    return emptyMonoResolvedCallTargetTable();
  }
  const lookup = new Map<MonoResolvedCallTargetLookupKey, MonoResolvedCallTargetEntry>();
  for (const entry of entries) {
    lookup.set(
      callResolvedTargetKey({
        callerInstanceId: entry.callerInstanceId,
        callExpressionId: entry.callExpressionId,
      }),
      {
        callerInstanceId: entry.callerInstanceId,
        callExpressionId: entry.callExpressionId,
        resolvedTarget: entry.resolvedTarget,
      },
    );
  }
  return monoResolvedCallTargetTableFromMap(lookup);
}

export function monoResolvedCallTargetEntriesForCaller(input: {
  readonly callResolvedTargets: ReadonlyMap<string, MonoResolvedCallTargetEntry>;
  readonly callerInstanceId: MonoInstanceId;
}): readonly MonoResolvedCallTargetEntry[] {
  return [...input.callResolvedTargets.values()]
    .filter((entry) => String(entry.callerInstanceId) === String(input.callerInstanceId))
    .sort((left, right) =>
      compareCodeUnitStrings(
        callResolvedTargetKey({
          callerInstanceId: left.callerInstanceId,
          callExpressionId: left.callExpressionId,
        }),
        callResolvedTargetKey({
          callerInstanceId: right.callerInstanceId,
          callExpressionId: right.callExpressionId,
        }),
      ),
    );
}

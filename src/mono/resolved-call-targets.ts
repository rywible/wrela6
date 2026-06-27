import { compareCodeUnitStrings } from "./deterministic-sort";
import { type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoResolvedCallTarget,
  MonoResolvedCallTargetTable,
} from "./mono-hir";
import { callResolvedTargetKey } from "./call-resolved-target-application";
import type { ReachabilityState } from "./reachability-shared";

export type MonoResolvedCallTargetLookupKey = string;

export type { MonoResolvedCallTargetTable } from "./mono-hir";

export function emptyMonoResolvedCallTargetTable(): MonoResolvedCallTargetTable {
  return {
    get: () => undefined,
    entries: () => [],
  };
}

function monoResolvedCallTargetTableFromMap(
  lookup: ReadonlyMap<MonoResolvedCallTargetLookupKey, MonoResolvedCallTarget>,
): MonoResolvedCallTargetTable {
  const sortedKeys = [...lookup.keys()].sort(compareCodeUnitStrings);
  return {
    get(key: MonoResolvedCallTargetLookupKey): MonoResolvedCallTarget | undefined {
      return lookup.get(key);
    },
    entries(): readonly MonoResolvedCallTarget[] {
      return sortedKeys.map((key) => {
        const resolvedTarget = lookup.get(key);
        if (resolvedTarget === undefined) {
          throw new RangeError(`Resolved call target table is missing entry for key ${key}.`);
        }
        return resolvedTarget;
      });
    },
  };
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
  const lookup = new Map<MonoResolvedCallTargetLookupKey, MonoResolvedCallTarget>();
  for (const entry of entries) {
    lookup.set(
      callResolvedTargetKey({
        callerInstanceId: entry.callerInstanceId,
        callExpressionId: entry.callExpressionId,
      }),
      entry.resolvedTarget,
    );
  }
  return monoResolvedCallTargetTableFromMap(lookup);
}

import { compareCodeUnitStrings } from "./deterministic-sort";

export interface HirTable<LookupId, Entry> {
  get(id: LookupId): Entry | undefined;
  keyOf(entry: Entry): string;
  lookupKeyOf(id: LookupId): string;
  entries(): readonly Entry[];
}

export function hirTable<LookupId, Entry>(input: {
  readonly entries: readonly Entry[];
  readonly keyOf: (entry: Entry) => string;
  readonly lookupKeyOf: (id: LookupId) => string;
}): HirTable<LookupId, Entry> {
  const keyedPairs = input.entries
    .map((entry) => ({ key: input.keyOf(entry), entry }))
    .sort((left, right) => compareCodeUnitStrings(left.key, right.key));
  const sortedEntries: readonly Entry[] = keyedPairs.map((pair) => pair.entry);
  const lookup = new Map<string, Entry>();
  for (const pair of keyedPairs) {
    lookup.set(pair.key, pair.entry);
  }

  const storedKeyOf = input.keyOf;
  const storedLookupKeyOf = input.lookupKeyOf;

  return {
    get(id: LookupId): Entry | undefined {
      return lookup.get(storedLookupKeyOf(id));
    },
    keyOf(entry: Entry): string {
      return storedKeyOf(entry);
    },
    lookupKeyOf(id: LookupId): string {
      return storedLookupKeyOf(id);
    },
    entries(): readonly Entry[] {
      return sortedEntries.slice();
    },
  };
}

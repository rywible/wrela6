import type { LayoutCanonicalKeyString } from "./ids";
import type {
  LayoutDeterministicTable,
  LayoutFieldKey,
  LayoutImageDeviceKey,
  LayoutTypeKey,
} from "./layout-program";
import { compareCodeUnitStrings, layoutLengthDelimitedField } from "./deterministic-sort";

function asLayoutCanonicalKeyString(value: string): LayoutCanonicalKeyString {
  return value as LayoutCanonicalKeyString;
}

export function layoutTypeKeyString(key: LayoutTypeKey): LayoutCanonicalKeyString {
  switch (key.kind) {
    case "source":
      return asLayoutCanonicalKeyString(
        layoutLengthDelimitedField("source", String(key.instanceId)),
      );
    case "core":
      return asLayoutCanonicalKeyString(layoutLengthDelimitedField("core", String(key.coreTypeId)));
    case "target":
      return asLayoutCanonicalKeyString(
        layoutLengthDelimitedField("target", String(key.targetTypeId)),
      );
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

export function layoutFieldKeyString(key: LayoutFieldKey): LayoutCanonicalKeyString {
  const ownerKey = layoutTypeKeyString(key.owner);
  const fieldIdKey = layoutLengthDelimitedField("fieldId", String(key.fieldId));
  return asLayoutCanonicalKeyString(`field:owner:${ownerKey}:${fieldIdKey}`);
}

export function layoutImageDeviceKeyString(key: LayoutImageDeviceKey): LayoutCanonicalKeyString {
  const imageInstanceKey = layoutLengthDelimitedField(
    "imageInstanceId",
    String(key.imageInstanceId),
  );
  const fieldIdKey = layoutLengthDelimitedField("fieldId", String(key.fieldId));
  return asLayoutCanonicalKeyString(`image-device:${imageInstanceKey}:${fieldIdKey}`);
}

export function publishedLayoutTypeKeyToLayoutTypeKey(key: LayoutTypeKey): LayoutTypeKey {
  return key;
}

export interface LayoutTypeFingerprintTable {
  getByFingerprint(fingerprint: string): LayoutTypeKey | undefined;
  entries(): readonly { readonly fingerprint: string; readonly key: LayoutTypeKey }[];
}

export function layoutTypeFingerprintTable(input: {
  readonly entries: readonly { readonly fingerprint: string; readonly key: LayoutTypeKey }[];
}): LayoutTypeFingerprintTable {
  const sortedEntries = [...input.entries].sort((left, right) =>
    compareCodeUnitStrings(left.fingerprint, right.fingerprint),
  );
  const lookup = new Map<string, LayoutTypeKey>();
  for (const entry of sortedEntries) {
    lookup.set(entry.fingerprint, entry.key);
  }

  return {
    getByFingerprint(fingerprint: string): LayoutTypeKey | undefined {
      return lookup.get(fingerprint);
    },
    entries(): readonly { readonly fingerprint: string; readonly key: LayoutTypeKey }[] {
      return sortedEntries.slice();
    },
  };
}

export function layoutDeterministicTable<Key, Value>(input: {
  readonly entries: readonly Value[];
  readonly keyOf: (entry: Value) => Key;
  readonly keyString: (key: Key) => LayoutCanonicalKeyString;
}): LayoutDeterministicTable<Key, Value> {
  const keyedPairs = input.entries
    .map((entry) => ({ key: input.keyString(input.keyOf(entry)), entry }))
    .sort((left, right) => compareCodeUnitStrings(left.key, right.key));
  const sortedEntries: readonly Value[] = keyedPairs.map((pair) => pair.entry);
  const lookup = new Map<LayoutCanonicalKeyString, Value>();
  for (const pair of keyedPairs) {
    lookup.set(pair.key, pair.entry);
  }

  const storedKeyString = input.keyString;

  return {
    get(key: Key): Value | undefined {
      return lookup.get(storedKeyString(key));
    },
    has(key: Key): boolean {
      return lookup.has(storedKeyString(key));
    },
    entries(): readonly Value[] {
      return sortedEntries.slice();
    },
    keyString(key: Key): LayoutCanonicalKeyString {
      return storedKeyString(key);
    },
  };
}

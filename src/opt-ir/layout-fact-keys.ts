import type { LayoutFactProgram } from "../layout/layout-program";
import { layoutFactKey, type LayoutFactKey } from "../proof-check/model/fact-packet";

interface LayoutTableLike<Entry> {
  readonly entries?: () => readonly Entry[];
  readonly keyString?: (key: never) => string;
}

type RecordLike = Readonly<Record<string, unknown>>;

export function authenticatedLayoutFactKeys(facts: unknown): readonly LayoutFactKey[] {
  const layout = facts as Partial<LayoutFactProgram> | undefined;
  if (!isRecord(layout)) {
    return [];
  }

  const keys = new Set<string>();
  addValidatedBufferKeys(keys, layout.validatedBuffers);
  addKeyedEntryKeys(keys, layout.types, (entry) => recordProperty(entry, "key"));
  addKeyedEntryKeys(keys, layout.fields, (entry) => {
    const owner = recordProperty(entry, "owner");
    const fieldId = recordProperty(entry, "fieldId");
    return owner === undefined || fieldId === undefined ? undefined : { owner, fieldId };
  });
  addKeyedEntryKeys(keys, layout.enums, (entry) => recordProperty(entry, "owner"));
  addFunctionKeys(keys, layout.functions);
  addPlatformEdgeKeys(keys, layout.platformEdges);
  addKeyedEntryKeys(keys, layout.imageDevices, (entry) => recordProperty(entry, "key"));

  return Object.freeze([...keys].sort().map((key) => layoutFactKey(key)));
}

export function authenticatedLayoutFactKeySet(facts: unknown): ReadonlySet<string> {
  return new Set(authenticatedLayoutFactKeys(facts).map(String));
}

function addValidatedBufferKeys(keys: Set<string>, table: unknown): void {
  for (const entry of tableEntries<RecordLike>(table)) {
    const instanceId = recordProperty(entry, "instanceId");
    addKey(keys, instanceId);
    addTableKey(keys, table, instanceId);
  }
}

function addFunctionKeys(keys: Set<string>, table: unknown): void {
  for (const entry of tableEntries<RecordLike>(table)) {
    const functionInstanceId = recordProperty(entry, "functionInstanceId");
    addKey(keys, functionInstanceId);
    addTableKey(keys, table, functionInstanceId);
  }
}

function addPlatformEdgeKeys(keys: Set<string>, table: unknown): void {
  for (const entry of tableEntries<RecordLike>(table)) {
    const edgeId = recordProperty(entry, "edgeId");
    addKey(keys, edgeId);
    addTableKey(keys, table, edgeId);
  }
}

function addKeyedEntryKeys(
  keys: Set<string>,
  table: unknown,
  keyOf: (entry: RecordLike) => unknown,
): void {
  for (const entry of tableEntries<RecordLike>(table)) {
    addTableKey(keys, table, keyOf(entry));
  }
}

function addTableKey(keys: Set<string>, table: unknown, key: unknown): void {
  if (key === undefined) {
    return;
  }
  const tableLike = table as LayoutTableLike<unknown>;
  if (typeof tableLike.keyString !== "function") {
    return;
  }
  try {
    addKey(keys, tableLike.keyString(key as never));
  } catch {
    return;
  }
}

function addKey(keys: Set<string>, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  const key = String(value);
  if (key.length === 0) {
    return;
  }
  keys.add(String(layoutFactKey(key)));
}

function tableEntries<Entry>(table: unknown): readonly Entry[] {
  const tableLike = table as LayoutTableLike<Entry> | undefined;
  if (tableLike === undefined || typeof tableLike.entries !== "function") {
    return [];
  }
  const entries = tableLike.entries();
  return Array.isArray(entries) ? entries : [];
}

function recordProperty(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function isRecord(value: unknown): value is RecordLike {
  return value !== null && typeof value === "object";
}

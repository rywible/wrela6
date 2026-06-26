import { hirTable } from "../hir/hir-table";
import type { MonoDeterministicTable, MonoInstantiatedProofId, MonoProofOwner } from "./mono-hir";

export function buildMonoTable<LookupId, Entry>(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
  lookupKeyOf: (id: LookupId) => string,
): MonoDeterministicTable<LookupId, Entry> {
  return hirTable({
    entries,
    keyOf,
    lookupKeyOf,
  });
}

export function proofMetadataIdKey(id: MonoInstantiatedProofId<unknown>): string {
  const ownerKey = monoOwnerKey(id.owner);
  return `${ownerKey}/${String(id.hirId).padStart(12, "0")}`;
}

function monoOwnerKey(owner: MonoProofOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${String(owner.instanceId).padStart(12, "0")}`;
    case "image":
      return `image:${String(owner.instanceId).padStart(12, "0")}`;
    case "type":
      return `type:${String(owner.instanceId).padStart(12, "0")}`;
  }
}

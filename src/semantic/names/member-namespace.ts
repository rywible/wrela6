import type { ItemId } from "../ids";
import type { ItemIndex } from "../item-index/item-index";
import type { MemberNamespaceKind, ResolvedReference } from "./reference";

export interface ResolveMemberInput {
  readonly ownerItemId: ItemId;
  readonly name: string;
  readonly allowedNamespaces?: readonly MemberNamespaceKind[];
}

export type ResolveMemberResult =
  | { readonly kind: "resolved"; readonly reference: ResolvedReference }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly ResolvedReference[] };

export interface MemberNamespace {
  resolveMember(input: ResolveMemberInput): ResolveMemberResult;
}

interface MemberEntry {
  readonly kind: MemberNamespaceKind;
  readonly reference: ResolvedReference;
  readonly name: string;
}

function addEntry(map: Map<ItemId, MemberEntry[]>, ownerItemId: ItemId, entry: MemberEntry): void {
  const entries = map.get(ownerItemId);
  if (entries) {
    entries.push(entry);
  } else {
    map.set(ownerItemId, [entry]);
  }
}

export function buildMemberNamespace(index: ItemIndex): MemberNamespace {
  const membersByOwner = new Map<ItemId, MemberEntry[]>();

  for (const field of index.fields()) {
    const kind: MemberNamespaceKind = field.role === "imageDevice" ? "imageDevice" : "field";
    addEntry(membersByOwner, field.ownerItemId, {
      kind,
      reference: { kind: "field", ownerItemId: field.ownerItemId, fieldId: field.id },
      name: field.name,
    });
  }

  for (const func of index.functions()) {
    if (func.parentItemId === undefined) continue;
    addEntry(membersByOwner, func.parentItemId, {
      kind: "function",
      reference: { kind: "function", itemId: func.itemId, functionId: func.id },
      name: func.name,
    });
  }

  for (const item of index.items()) {
    if (item.kind !== "enumCase" || item.parentItemId === undefined) continue;
    addEntry(membersByOwner, item.parentItemId, {
      kind: "enumCase",
      reference: { kind: "item", itemId: item.id },
      name: item.name,
    });
  }

  return {
    resolveMember(input: ResolveMemberInput): ResolveMemberResult {
      const members = membersByOwner.get(input.ownerItemId);
      if (members === undefined) return { kind: "unresolved" };

      const allowedKinds = input.allowedNamespaces
        ? new Set(input.allowedNamespaces)
        : new Set<MemberNamespaceKind>(["field", "function", "enumCase", "imageDevice"]);

      const matchedEntries = members.filter(
        (member) => allowedKinds.has(member.kind) && member.name === input.name,
      );

      if (matchedEntries.length === 0) return { kind: "unresolved" };

      matchedEntries.sort((left, right) => {
        const kindOrder: Record<MemberNamespaceKind, number> = {
          field: 0,
          function: 1,
          enumCase: 2,
          imageDevice: 3,
        };
        return (kindOrder[left.kind] ?? 0) - (kindOrder[right.kind] ?? 0);
      });

      const matched = matchedEntries.map((entry) => entry.reference);

      if (matched.length === 1) return { kind: "resolved", reference: matched[0]! };
      return { kind: "ambiguous", candidates: matched };
    },
  };
}

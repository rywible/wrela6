import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import {
  proofMirDeterministicTable,
  type ProofMirDeterministicTableResult,
} from "./canonical-order";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";

export interface ProofMirCanonicalKeyLookup<DenseId> {
  resolve(key: ProofMirCanonicalKey): DenseId | undefined;
  has(key: ProofMirCanonicalKey): boolean;
  entries(): readonly { readonly canonicalKey: ProofMirCanonicalKey; readonly id: DenseId }[];
}

export type ProofMirDenseIdAssignmentResult<Entry, DenseId> =
  | {
      readonly kind: "ok";
      readonly lookup: ProofMirCanonicalKeyLookup<DenseId>;
      readonly entries: readonly Entry[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function assignProofMirDenseIds<Entry, DenseId>(input: {
  readonly entries: readonly Entry[];
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly idOf: (index: number) => DenseId;
  readonly normalizePayload: (entry: Entry) => string;
  readonly duplicateDetail?: (key: ProofMirCanonicalKey) => string;
}): ProofMirDenseIdAssignmentResult<Entry, DenseId> {
  const tableResult = proofMirDeterministicTable({
    entries: input.entries,
    keyOf: input.keyOf,
    lookupKeyOf: (key: ProofMirCanonicalKey) => key,
    normalizePayload: input.normalizePayload,
    duplicateDetail: input.duplicateDetail,
  });
  if (tableResult.kind === "error") {
    return tableResult;
  }

  const assignedEntries: { readonly canonicalKey: ProofMirCanonicalKey; readonly id: DenseId }[] =
    [];
  const lookup = new Map<ProofMirCanonicalKey, DenseId>();
  const sortedEntries = tableResult.table.entries();
  for (let index = 0; index < sortedEntries.length; index += 1) {
    const entry = sortedEntries[index]!;
    const canonicalKey = input.keyOf(entry);
    const id = input.idOf(index);
    assignedEntries.push({ canonicalKey, id });
    lookup.set(canonicalKey, id);
  }

  return {
    kind: "ok",
    lookup: {
      resolve(key: ProofMirCanonicalKey): DenseId | undefined {
        return lookup.get(key);
      },
      has(key: ProofMirCanonicalKey): boolean {
        return lookup.has(key);
      },
      entries(): readonly { readonly canonicalKey: ProofMirCanonicalKey; readonly id: DenseId }[] {
        return assignedEntries.slice();
      },
    },
    entries: sortedEntries,
  };
}

export function buildProofMirCanonicalKeyLookup<Entry, DenseId>(input: {
  readonly entries: readonly Entry[];
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly idOf: (index: number) => DenseId;
}): ProofMirCanonicalKeyLookup<DenseId> {
  const assignedEntries: { readonly canonicalKey: ProofMirCanonicalKey; readonly id: DenseId }[] =
    [];
  const lookup = new Map<ProofMirCanonicalKey, DenseId>();
  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index]!;
    const canonicalKey = input.keyOf(entry);
    const id = input.idOf(index);
    assignedEntries.push({ canonicalKey, id });
    lookup.set(canonicalKey, id);
  }

  return {
    resolve(key: ProofMirCanonicalKey): DenseId | undefined {
      return lookup.get(key);
    },
    has(key: ProofMirCanonicalKey): boolean {
      return lookup.has(key);
    },
    entries(): readonly { readonly canonicalKey: ProofMirCanonicalKey; readonly id: DenseId }[] {
      return assignedEntries.slice();
    },
  };
}

export function requireProofMirCanonicalKeyReference<DenseId>(input: {
  readonly lookup: ProofMirCanonicalKeyLookup<DenseId>;
  readonly key: ProofMirCanonicalKey;
  readonly referenceKind: string;
  readonly ownerKey: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly diagnostics: ProofMirDiagnostic[];
}): DenseId | undefined {
  const resolved = input.lookup.resolve(input.key);
  if (resolved === undefined) {
    input.diagnostics.push(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT",
        message: "Proof MIR draft reference does not resolve by canonical key.",
        ownerKey: input.ownerKey,
        rootCauseKey: "unresolved-canonical-key",
        stableDetail: `${input.referenceKind}:${String(input.key)}`,
        ...(input.functionInstanceId !== undefined
          ? { functionInstanceId: input.functionInstanceId }
          : {}),
      }),
    );
  }
  return resolved;
}

export function buildProofMirFrozenDeterministicTable<Entry, LookupId>(input: {
  readonly assignment: ProofMirDenseIdAssignmentResult<Entry, LookupId>;
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly lookupKeyOf: (id: LookupId) => ProofMirCanonicalKey;
  readonly normalizePayload: (entry: Entry) => string;
  readonly duplicateDetail?: (key: ProofMirCanonicalKey) => string;
}): ProofMirDeterministicTableResult<LookupId, Entry> {
  if (input.assignment.kind === "error") {
    return input.assignment;
  }

  return proofMirDeterministicTable({
    entries: input.assignment.entries,
    keyOf: input.keyOf,
    lookupKeyOf: input.lookupKeyOf,
    normalizePayload: input.normalizePayload,
    duplicateDetail: input.duplicateDetail,
  });
}

export function collectProofMirDiagnostics(
  diagnostics: readonly ProofMirDiagnostic[],
): readonly ProofMirDiagnostic[] {
  return sortProofMirDiagnostics(diagnostics);
}

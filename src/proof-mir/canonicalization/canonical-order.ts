import { compareCodeUnitStrings } from "../../semantic/surface/deterministic-sort";
import {
  proofMirDiagnostic,
  proofMirDiagnosticCode,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { ProofMirCanonicalKey } from "./canonical-keys";

export function proofMirLengthDelimitedField(kind: string, payload: string): string {
  return `${kind}:len(${payload.length}):${payload}`;
}

export function compareProofMirCanonicalKeys(
  left: ProofMirCanonicalKey,
  right: ProofMirCanonicalKey,
): number {
  return compareCodeUnitStrings(left, right);
}

export interface ProofMirDeterministicTable<LookupId, Entry> {
  get(key: LookupId): Entry | undefined;
  has(key: LookupId): boolean;
  entries(): readonly Entry[];
  keyOf(entry: Entry): ProofMirCanonicalKey;
  lookupKeyOf(key: LookupId): ProofMirCanonicalKey;
}

export type ProofMirDeterministicTableResult<LookupId, Entry> =
  | { readonly kind: "ok"; readonly table: ProofMirDeterministicTable<LookupId, Entry> }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function proofMirDeterministicTable<LookupId, Entry>(input: {
  readonly entries: readonly Entry[];
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly lookupKeyOf: (id: LookupId) => ProofMirCanonicalKey;
  readonly normalizePayload: (entry: Entry) => string;
  readonly duplicateDetail?: (key: ProofMirCanonicalKey) => string;
}): ProofMirDeterministicTableResult<LookupId, Entry> {
  const keyedEntries = input.entries.map((entry) => ({
    canonicalKey: input.keyOf(entry),
    entry,
    payload: input.normalizePayload(entry),
  }));
  keyedEntries.sort((left, right) =>
    compareProofMirCanonicalKeys(left.canonicalKey, right.canonicalKey),
  );

  const diagnostics: ProofMirDiagnostic[] = [];
  const acceptedEntries: Entry[] = [];
  let index = 0;
  while (index < keyedEntries.length) {
    const groupStart = index;
    const groupKey = keyedEntries[index]!.canonicalKey;
    const groupPayload = keyedEntries[index]!.payload;
    index += 1;

    while (
      index < keyedEntries.length &&
      compareProofMirCanonicalKeys(keyedEntries[index]!.canonicalKey, groupKey) === 0
    ) {
      if (keyedEntries[index]!.payload !== groupPayload) {
        const duplicateDetail =
          input.duplicateDetail?.(groupKey) ?? `duplicate:${String(groupKey)}`;
        diagnostics.push(
          proofMirDiagnostic({
            severity: "error",
            code: proofMirDiagnosticCode("PROOF_MIR_INVALID_TABLE_CANONICAL_KEY"),
            message: "Proof MIR table contains incompatible records for the same canonical key.",
            ownerKey: "program",
            rootCauseKey: "canonical-key",
            stableDetail: duplicateDetail,
          }),
        );
        return { kind: "error", diagnostics: sortProofMirDiagnostics(diagnostics) };
      }
      index += 1;
    }

    acceptedEntries.push(keyedEntries[groupStart]!.entry);
  }

  const lookup = new Map<ProofMirCanonicalKey, Entry>();
  for (const entry of acceptedEntries) {
    lookup.set(input.keyOf(entry), entry);
  }

  const storedKeyOf = input.keyOf;
  const storedLookupKeyOf = input.lookupKeyOf;

  return {
    kind: "ok",
    table: {
      get(id: LookupId): Entry | undefined {
        return lookup.get(storedLookupKeyOf(id));
      },
      has(id: LookupId): boolean {
        return lookup.has(storedLookupKeyOf(id));
      },
      entries(): readonly Entry[] {
        return acceptedEntries.slice();
      },
      keyOf(entry: Entry): ProofMirCanonicalKey {
        return storedKeyOf(entry);
      },
      lookupKeyOf(id: LookupId): ProofMirCanonicalKey {
        return storedLookupKeyOf(id);
      },
    },
  };
}

import type { AArch64MachineFunctionId, AArch64MachineProgramId, AArch64SymbolId } from "./ids";
import type { AArch64MachineFunction } from "./machine-function";
import type { AArch64ProvenanceMap } from "./provenance";
import type { AArch64SymbolReference } from "./symbol-reference";

export interface AArch64MachineTable<LookupId, Entry> {
  readonly get: (lookupId: LookupId) => Entry | undefined;
  readonly has: (lookupId: LookupId) => boolean;
  readonly entries: () => readonly Entry[];
}

export interface AArch64MachineProgram {
  readonly programId: AArch64MachineProgramId;
  readonly functions: AArch64MachineTable<AArch64MachineFunctionId, AArch64MachineFunction>;
  readonly globalSymbols: readonly AArch64SymbolReference[];
  readonly entrySymbol: AArch64SymbolId;
  readonly targetFingerprint: string;
  readonly consultedSubsurfaceFingerprints: readonly string[];
  readonly provenance: AArch64ProvenanceMap;
}

export function aarch64MachineProgram(input: {
  readonly programId: AArch64MachineProgramId;
  readonly functions: readonly AArch64MachineFunction[];
  readonly globalSymbols: readonly AArch64SymbolReference[];
  readonly entrySymbol: AArch64SymbolId;
  readonly targetFingerprint: string;
  readonly consultedSubsurfaceFingerprints: readonly string[];
  readonly provenance: AArch64ProvenanceMap;
}): AArch64MachineProgram {
  if (input.targetFingerprint.length === 0) {
    throw new RangeError("machine program target fingerprint must be non-empty.");
  }
  return Object.freeze({
    programId: input.programId,
    functions: aarch64MachineTable(input.functions, (entry) => entry.functionId),
    globalSymbols: Object.freeze(
      [...input.globalSymbols].sort((left, right) =>
        String(left.symbol).localeCompare(String(right.symbol)),
      ),
    ),
    entrySymbol: input.entrySymbol,
    targetFingerprint: input.targetFingerprint,
    consultedSubsurfaceFingerprints: Object.freeze(
      [...input.consultedSubsurfaceFingerprints].sort(),
    ),
    provenance: input.provenance,
  });
}

export function aarch64MachineTable<LookupId, Entry>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => LookupId,
): AArch64MachineTable<LookupId, Entry> {
  const sortedEntries = Object.freeze(
    [...entries].sort((left, right) => Number(idOf(left)) - Number(idOf(right))),
  );
  const byId = new Map<LookupId, Entry>();
  for (const entry of sortedEntries) {
    byId.set(idOf(entry), entry);
  }
  return Object.freeze({
    get(lookupId: LookupId): Entry | undefined {
      return byId.get(lookupId);
    },
    has(lookupId: LookupId): boolean {
      return byId.has(lookupId);
    },
    entries() {
      return sortedEntries;
    },
  });
}

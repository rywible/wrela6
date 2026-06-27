import type { ProofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirFactOperandFreezeLookups } from "../draft/draft-fact-operands";
import type {
  DraftProofMirFunctionDraft,
  DraftProofMirGraphSnapshot,
} from "../draft/draft-program";
import { compareProofMirCanonicalKeys } from "./canonical-order";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import type { ProofMirFactId } from "../ids";
import {
  proofMirFactId,
  proofMirLayoutTermBindingId,
  proofMirLayoutTermId,
  proofMirPlaceId,
  proofMirValueId,
  type ProofMirLayoutTermId,
} from "../ids";
import {
  assignProofMirDenseIds,
  buildProofMirCanonicalKeyLookup,
  type ProofMirCanonicalKeyLookup,
} from "./id-assignment";
import {
  mergeAssignmentError,
  placeRecordPayload,
  valueRecordPayload,
} from "./program-freeze-shared";

function layoutTermBindingKeysFromGraphSnapshot(
  snapshot: DraftProofMirGraphSnapshot | undefined,
): readonly ProofMirCanonicalKey[] {
  if (snapshot === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const bindingKeys: ProofMirCanonicalKey[] = [];
  for (const block of snapshot.blocks) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "bindLayoutTerm") {
        continue;
      }
      const keyString = String(statement.kind.binding.key);
      if (seen.has(keyString)) {
        continue;
      }
      seen.add(keyString);
      bindingKeys.push(statement.kind.binding.key);
    }
  }
  bindingKeys.sort(compareProofMirCanonicalKeys);
  return bindingKeys;
}

export function buildFunctionDraftOperandLookups(input: {
  readonly functionDrafts: readonly DraftProofMirFunctionDraft[];
  readonly diagnostics: ProofMirDiagnostic[];
}): DraftProofMirFactOperandFreezeLookups | "error" {
  const valueRecords = input.functionDrafts.flatMap((functionDraft) =>
    functionDraft.values.entries(),
  );
  const placeRecords = input.functionDrafts.flatMap((functionDraft) =>
    functionDraft.places.entries(),
  );
  const bindingRecords = input.functionDrafts.flatMap((functionDraft) =>
    layoutTermBindingKeysFromGraphSnapshot(functionDraft.graphSnapshot).map((key) => ({
      key,
      functionInstanceId: functionDraft.functionInstanceId,
    })),
  );

  const valueAssignment = assignProofMirDenseIds({
    entries: valueRecords,
    keyOf: (entry) => entry.key,
    idOf: proofMirValueId,
    normalizePayload: valueRecordPayload,
  });
  if (mergeAssignmentError(valueAssignment, input.diagnostics)) {
    return "error";
  }

  const placeAssignment = assignProofMirDenseIds({
    entries: placeRecords,
    keyOf: (entry) => entry.key,
    idOf: proofMirPlaceId,
    normalizePayload: placeRecordPayload,
  });
  if (mergeAssignmentError(placeAssignment, input.diagnostics)) {
    return "error";
  }

  const bindingAssignment = assignProofMirDenseIds({
    entries: bindingRecords,
    keyOf: (entry) => entry.key,
    idOf: proofMirLayoutTermBindingId,
    normalizePayload: (entry) => String(entry.key),
  });
  if (mergeAssignmentError(bindingAssignment, input.diagnostics)) {
    return "error";
  }

  const valueKeyLookup = buildProofMirCanonicalKeyLookup({
    entries: valueRecords,
    keyOf: (entry) => entry.key,
    idOf: (index) => {
      const entry = valueRecords[index]!;
      const valueId = valueAssignment.lookup.resolve(entry.key);
      if (valueId === undefined) {
        throw new RangeError(`Missing value id for key ${String(entry.key)}.`);
      }
      return { functionInstanceId: entry.functionInstanceId, valueId };
    },
  });
  const placeKeyLookup = buildProofMirCanonicalKeyLookup({
    entries: placeRecords,
    keyOf: (entry) => entry.key,
    idOf: (index) => {
      const entry = placeRecords[index]!;
      const placeId = placeAssignment.lookup.resolve(entry.key);
      if (placeId === undefined) {
        throw new RangeError(`Missing place id for key ${String(entry.key)}.`);
      }
      return { functionInstanceId: entry.functionInstanceId, placeId };
    },
  });
  const layoutTermBindingKeyLookup = buildProofMirCanonicalKeyLookup({
    entries: bindingRecords,
    keyOf: (entry) => entry.key,
    idOf: (index) => {
      const entry = bindingRecords[index]!;
      const bindingId = bindingAssignment.lookup.resolve(entry.key);
      if (bindingId === undefined) {
        throw new RangeError(`Missing layout-term binding id for key ${String(entry.key)}.`);
      }
      return { functionInstanceId: entry.functionInstanceId, bindingId };
    },
  });

  return {
    valueKeyLookup,
    placeKeyLookup,
    layoutTermBindingKeyLookup,
    factKeyLookup: emptyFactKeyLookup(),
    layoutTermKeyLookup: emptyLayoutTermKeyLookup(),
  };
}

function emptyLayoutTermKeyLookup(): ProofMirCanonicalKeyLookup<ProofMirLayoutTermId> {
  return buildProofMirCanonicalKeyLookup({
    entries: [],
    keyOf: (key) => key,
    idOf: proofMirLayoutTermId,
  });
}

function emptyFactKeyLookup(): ProofMirCanonicalKeyLookup<ProofMirFactId> {
  return buildProofMirCanonicalKeyLookup({
    entries: [],
    keyOf: (key) => key,
    idOf: proofMirFactId,
  });
}

export function withLayoutTermKeyLookup(
  lookups: DraftProofMirFactOperandFreezeLookups,
  layoutTermKeyLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>,
): DraftProofMirFactOperandFreezeLookups {
  return {
    ...lookups,
    layoutTermKeyLookup,
  };
}

export function withFactKeyLookup(
  lookups: DraftProofMirFactOperandFreezeLookups,
  factKeyLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>,
): DraftProofMirFactOperandFreezeLookups {
  return {
    ...lookups,
    factKeyLookup,
  };
}

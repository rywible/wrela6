import type { HirOriginId, HirPlatformContractEdgeId } from "../../hir/ids";
import type { PlatformPrimitiveId } from "../../semantic/ids";
import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoStatementId,
} from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ProofMirRuntimeOperationId } from "../../runtime/runtime-catalog-types";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDeterministicTable,
  proofMirLengthDelimitedField,
} from "../canonicalization/canonical-order";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";

export type ProofMirLayoutReference = string;

export type ProofMirOriginOwner =
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "image"; readonly imageInstanceId: MonoInstanceId }
  | {
      readonly kind: "platform";
      readonly edgeId?: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId?: PlatformPrimitiveId;
    }
  | { readonly kind: "runtimeCatalog"; readonly runtimeId?: ProofMirRuntimeOperationId }
  | { readonly kind: "program" };

export type DraftProofMirOriginKey = ProofMirCanonicalKey;

export interface DraftProofMirOrigin {
  readonly canonicalKey: DraftProofMirOriginKey;
  readonly owner: ProofMirOriginOwner;
  readonly sourceOrigin?: HirOriginId;
  readonly diagnosticOrigin?: string;
  readonly monoExpressionId?: MonoExpressionId;
  readonly monoStatementId?: MonoStatementId;
  readonly monoLocalId?: MonoLocalId;
  readonly monoProofId?: MonoInstantiatedProofId<unknown>;
  readonly layoutKey?: ProofMirLayoutReference;
  readonly note?: string;
  readonly parentOriginKey?: DraftProofMirOriginKey;
}

export interface ProofMirOriginMap {
  fromHirOrigin(input: {
    readonly owner: ProofMirOriginOwner;
    readonly sourceOrigin: HirOriginId;
  }): DraftProofMirOriginKey;
  fromMonoStatement(input: {
    readonly owner: ProofMirOriginOwner;
    readonly sourceOrigin?: HirOriginId;
    readonly monoStatementId: MonoStatementId;
  }): DraftProofMirOriginKey;
  fromMonoExpression(input: {
    readonly owner: ProofMirOriginOwner;
    readonly sourceOrigin?: HirOriginId;
    readonly monoExpressionId: MonoExpressionId;
  }): DraftProofMirOriginKey;
  fromMonoLocal(input: {
    readonly owner: ProofMirOriginOwner;
    readonly sourceOrigin?: HirOriginId;
    readonly monoLocalId: MonoLocalId;
  }): DraftProofMirOriginKey;
  fromMonoProof(input: {
    readonly owner: ProofMirOriginOwner;
    readonly sourceOrigin?: HirOriginId;
    readonly monoProofId: MonoInstantiatedProofId<unknown>;
  }): DraftProofMirOriginKey;
  fromLayout(input: {
    readonly owner: ProofMirOriginOwner;
    readonly layoutKey: ProofMirLayoutReference;
    readonly diagnosticOrigin?: string;
    readonly sourceOrigin?: HirOriginId;
  }): DraftProofMirOriginKey;
  fromRuntimeCatalog(input: {
    readonly runtimeId: ProofMirRuntimeOperationId;
    readonly diagnosticOrigin?: string;
  }): DraftProofMirOriginKey;
  syntheticFrom(parent: DraftProofMirOriginKey, note: string): DraftProofMirOriginKey;
  draftRecord(key: DraftProofMirOriginKey): DraftProofMirOrigin;
  entries(): readonly DraftProofMirOrigin[];
  diagnostics(): readonly ProofMirDiagnostic[];
}

interface ProofMirOriginMapImpl extends ProofMirOriginMap {}

function originIdSegment(originId: HirOriginId): string {
  return String(originId).padStart(12, "0");
}

function runtimeIdSegment(runtimeId: ProofMirRuntimeOperationId): string {
  return String(runtimeId).padStart(12, "0");
}

export function proofMirOriginOwnerKey(owner: ProofMirOriginOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${String(owner.functionInstanceId)}`;
    case "image":
      return `image:${String(owner.imageInstanceId)}`;
    case "platform": {
      const edge = owner.edgeId === undefined ? "" : proofMetadataIdKey(owner.edgeId);
      const primitive = owner.primitiveId === undefined ? "" : String(owner.primitiveId);
      return `platform:edge:${edge}:primitive:${primitive}`;
    }
    case "runtimeCatalog":
      return owner.runtimeId === undefined
        ? "runtimeCatalog"
        : `runtimeCatalog:${runtimeIdSegment(owner.runtimeId)}`;
    case "program":
      return "program";
    default: {
      const unreachable: never = owner;
      return unreachable;
    }
  }
}

function ownerKeySegment(owner: ProofMirOriginOwner): string {
  return proofMirLengthDelimitedField("owner", proofMirOriginOwnerKey(owner));
}

function draftOriginHirKey(
  owner: ProofMirOriginOwner,
  sourceOrigin: HirOriginId,
): DraftProofMirOriginKey {
  return proofMirCanonicalKey(
    `origin|kind:hir|${ownerKeySegment(owner)}|sourceOrigin:${originIdSegment(sourceOrigin)}`,
  );
}

function draftOriginMonoStatementKey(monoStatementId: MonoStatementId): DraftProofMirOriginKey {
  return proofMirCanonicalKey(`origin|kind:monoStatement|${instantiatedHirIdKey(monoStatementId)}`);
}

function draftOriginMonoExpressionKey(monoExpressionId: MonoExpressionId): DraftProofMirOriginKey {
  return proofMirCanonicalKey(
    `origin|kind:monoExpression|${instantiatedHirIdKey(monoExpressionId)}`,
  );
}

function draftOriginMonoLocalKey(monoLocalId: MonoLocalId): DraftProofMirOriginKey {
  return proofMirCanonicalKey(`origin|kind:monoLocal|${instantiatedHirIdKey(monoLocalId)}`);
}

function draftOriginMonoProofKey(
  monoProofId: MonoInstantiatedProofId<unknown>,
): DraftProofMirOriginKey {
  return proofMirCanonicalKey(`origin|kind:monoProof|${proofMetadataIdKey(monoProofId)}`);
}

function draftOriginLayoutKey(
  owner: ProofMirOriginOwner,
  layoutKey: ProofMirLayoutReference,
): DraftProofMirOriginKey {
  return proofMirCanonicalKey(
    `origin|kind:layout|${ownerKeySegment(owner)}|layoutKey:${proofMirLengthDelimitedField("layoutKey", layoutKey)}`,
  );
}

function draftOriginRuntimeCatalogKey(
  runtimeId: ProofMirRuntimeOperationId,
): DraftProofMirOriginKey {
  return proofMirCanonicalKey(
    `origin|kind:runtimeCatalog|runtimeId:${runtimeIdSegment(runtimeId)}`,
  );
}

function draftOriginSyntheticKey(
  parent: DraftProofMirOriginKey,
  note: string,
): DraftProofMirOriginKey {
  return proofMirCanonicalKey(
    `origin|kind:synthetic|parent:${String(parent)}|note:${proofMirLengthDelimitedField("note", note)}`,
  );
}

function normalizeDraftOrigin(record: DraftProofMirOrigin): string {
  return JSON.stringify({
    owner: proofMirOriginOwnerKey(record.owner),
    sourceOrigin: record.sourceOrigin === undefined ? null : originIdSegment(record.sourceOrigin),
    diagnosticOrigin: record.diagnosticOrigin ?? null,
    monoExpressionId:
      record.monoExpressionId === undefined ? null : instantiatedHirIdKey(record.monoExpressionId),
    monoStatementId:
      record.monoStatementId === undefined ? null : instantiatedHirIdKey(record.monoStatementId),
    monoLocalId: record.monoLocalId === undefined ? null : instantiatedHirIdKey(record.monoLocalId),
    monoProofId: record.monoProofId === undefined ? null : proofMetadataIdKey(record.monoProofId),
    layoutKey: record.layoutKey ?? null,
    note: record.note ?? null,
    parentOriginKey: record.parentOriginKey === undefined ? null : String(record.parentOriginKey),
  });
}

function functionInstanceIdForOwner(owner: ProofMirOriginOwner): MonoInstanceId | undefined {
  switch (owner.kind) {
    case "function":
      return owner.functionInstanceId;
    case "image":
    case "platform":
    case "runtimeCatalog":
    case "program":
      return undefined;
    default: {
      const unreachable: never = owner;
      return unreachable;
    }
  }
}

export function createProofMirOriginMap(): ProofMirOriginMap {
  const records = new Map<DraftProofMirOriginKey, DraftProofMirOrigin>();
  const diagnostics: ProofMirDiagnostic[] = [];

  function nearestSourceOrigin(key: DraftProofMirOriginKey): HirOriginId | undefined {
    const visited = new Set<string>();
    let current: DraftProofMirOriginKey | undefined = key;
    while (current !== undefined) {
      const currentKey = String(current);
      if (visited.has(currentKey)) {
        return undefined;
      }
      visited.add(currentKey);
      const record = records.get(current);
      if (record === undefined) {
        return undefined;
      }
      if (record.sourceOrigin !== undefined) {
        return record.sourceOrigin;
      }
      current = record.parentOriginKey;
    }
    return undefined;
  }

  function recordMissingSourceOrigin(input: {
    readonly owner: ProofMirOriginOwner;
    readonly stableDetail: string;
  }): void {
    const functionInstanceId = functionInstanceIdForOwner(input.owner);
    diagnostics.push(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_ORIGIN_MISSING",
        message: "Required source origin is missing for Proof MIR origin record.",
        ownerKey: proofMirOriginOwnerKey(input.owner),
        rootCauseKey: "origin",
        stableDetail: input.stableDetail,
        ...(functionInstanceId === undefined ? {} : { functionInstanceId }),
      }),
    );
  }

  function intern(record: DraftProofMirOrigin): DraftProofMirOriginKey {
    const existing = records.get(record.canonicalKey);
    if (existing !== undefined) {
      return record.canonicalKey;
    }
    records.set(record.canonicalKey, record);
    return record.canonicalKey;
  }

  const map: ProofMirOriginMapImpl = {
    fromHirOrigin(input) {
      const canonicalKey = draftOriginHirKey(input.owner, input.sourceOrigin);
      return intern({
        canonicalKey,
        owner: input.owner,
        sourceOrigin: input.sourceOrigin,
      });
    },

    fromMonoStatement(input) {
      if (input.sourceOrigin === undefined) {
        recordMissingSourceOrigin({
          owner: input.owner,
          stableDetail: `mono-statement:${instantiatedHirIdKey(input.monoStatementId)}`,
        });
      }
      const canonicalKey = draftOriginMonoStatementKey(input.monoStatementId);
      return intern({
        canonicalKey,
        owner: input.owner,
        ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
        monoStatementId: input.monoStatementId,
      });
    },

    fromMonoExpression(input) {
      if (input.sourceOrigin === undefined) {
        recordMissingSourceOrigin({
          owner: input.owner,
          stableDetail: `mono-expression:${instantiatedHirIdKey(input.monoExpressionId)}`,
        });
      }
      const canonicalKey = draftOriginMonoExpressionKey(input.monoExpressionId);
      return intern({
        canonicalKey,
        owner: input.owner,
        ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
        monoExpressionId: input.monoExpressionId,
      });
    },

    fromMonoLocal(input) {
      if (input.sourceOrigin === undefined) {
        recordMissingSourceOrigin({
          owner: input.owner,
          stableDetail: `mono-local:${instantiatedHirIdKey(input.monoLocalId)}`,
        });
      }
      const canonicalKey = draftOriginMonoLocalKey(input.monoLocalId);
      return intern({
        canonicalKey,
        owner: input.owner,
        ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
        monoLocalId: input.monoLocalId,
      });
    },

    fromMonoProof(input) {
      if (input.sourceOrigin === undefined) {
        recordMissingSourceOrigin({
          owner: input.owner,
          stableDetail: `mono-proof:${proofMetadataIdKey(input.monoProofId)}`,
        });
      }
      const canonicalKey = draftOriginMonoProofKey(input.monoProofId);
      return intern({
        canonicalKey,
        owner: input.owner,
        ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
        monoProofId: input.monoProofId,
      });
    },

    fromLayout(input) {
      const canonicalKey = draftOriginLayoutKey(input.owner, input.layoutKey);
      return intern({
        canonicalKey,
        owner: input.owner,
        layoutKey: input.layoutKey,
        ...(input.diagnosticOrigin === undefined
          ? {}
          : { diagnosticOrigin: input.diagnosticOrigin }),
        ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
      });
    },

    fromRuntimeCatalog(input) {
      const canonicalKey = draftOriginRuntimeCatalogKey(input.runtimeId);
      return intern({
        canonicalKey,
        owner: { kind: "runtimeCatalog", runtimeId: input.runtimeId },
        ...(input.diagnosticOrigin === undefined
          ? {}
          : { diagnosticOrigin: input.diagnosticOrigin }),
      });
    },

    syntheticFrom(parent, note) {
      const parentRecord = records.get(parent);
      if (parentRecord === undefined) {
        throw new RangeError(`Unknown parent Proof MIR origin key: ${String(parent)}.`);
      }
      const sourceOrigin = nearestSourceOrigin(parent);
      const canonicalKey = draftOriginSyntheticKey(parent, note);
      return intern({
        canonicalKey,
        owner: parentRecord.owner,
        ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
        note,
        parentOriginKey: parent,
      });
    },

    draftRecord(key) {
      const record = records.get(key);
      if (record === undefined) {
        throw new RangeError(`Unknown Proof MIR origin key: ${String(key)}.`);
      }
      return record;
    },

    entries() {
      const table = proofMirDeterministicTable({
        entries: [...records.values()],
        keyOf: (entry) => entry.canonicalKey,
        lookupKeyOf: (key: DraftProofMirOriginKey) => key,
        normalizePayload: normalizeDraftOrigin,
      });
      if (table.kind === "error") {
        diagnostics.push(...table.diagnostics);
        return [];
      }
      return table.table.entries();
    },

    diagnostics() {
      return sortProofMirDiagnostics(diagnostics);
    },
  };

  return map;
}

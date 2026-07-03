import type { BrandId, ObligationId, SessionId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoProofMetadata,
  MonoCheckedType,
} from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirBlockRecord,
  DraftProofMirControlEdgeRecord,
  DraftProofMirFactRecord,
  DraftProofMirLocalRecord,
  DraftProofMirLayoutTermRecord,
  DraftProofMirOriginRecord,
  DraftProofMirPlaceRecord,
  DraftProofMirPrivateStateGenerationRecord,
  DraftProofMirScopeRecord,
  DraftProofMirValueRecord,
} from "../draft/draft-program";
import { parseDraftLocalKey } from "../draft/draft-keys";
import type { ProofMirLocalStorageKind } from "../domains/effects-resources";
import { proofMirOriginId, type ProofMirOriginId } from "../ids";
import type { ProofMirControlEdge } from "../model/graph";
import type { ProofMirOrigin, ProofMirOriginOwner } from "../model/origins";
import { proofMirCanonicalKey, type ProofMirCanonicalKey } from "./canonical-keys";
import { proofMirDeterministicTable, type ProofMirDeterministicTable } from "./canonical-order";
import { assignProofMirDenseIds, type ProofMirDenseIdAssignmentResult } from "./id-assignment";

export function ownerKeyForFunction(functionInstanceId: MonoInstanceId): string {
  return `function:${String(functionInstanceId)}`;
}

export function functionCanonicalKey(functionInstanceId: MonoInstanceId): ProofMirCanonicalKey {
  return proofMirCanonicalKey(`function:${String(functionInstanceId)}`);
}

export function originRecordPayload(record: DraftProofMirOriginRecord): string {
  return [record.ownerKey, record.sourceOrigin ?? "", record.note ?? ""].join("|");
}

export function scopeRecordPayload(record: DraftProofMirScopeRecord): string {
  return [record.role, record.parentScopeKey ?? "", String(record.originKey)].join("|");
}

export function blockRecordPayload(record: DraftProofMirBlockRecord): string {
  return `${record.role}:${record.sourceOrigin}`;
}

export function controlEdgeRecordPayload(record: DraftProofMirControlEdgeRecord): string {
  return [
    record.role,
    String(record.fromBlockKey),
    String(record.toBlockKey),
    String(record.originKey),
  ].join("|");
}

export function placeRecordPayload(record: DraftProofMirPlaceRecord): string {
  return [
    record.monoPlaceCanonicalKey,
    record.root === undefined ? "" : JSON.stringify(record.root),
    record.projection === undefined ? "" : JSON.stringify(record.projection),
    record.type === undefined ? "" : JSON.stringify(record.type),
    record.resourceKind ?? "",
  ].join("|");
}

export function valueRecordPayload(record: DraftProofMirValueRecord): string {
  return [
    record.role,
    String(record.originKey),
    record.type === undefined ? "" : JSON.stringify(record.type),
    record.resourceKind ?? "",
    record.representation === undefined ? "" : JSON.stringify(record.representation),
  ].join("|");
}

export function localRecordPayload(record: DraftProofMirLocalRecord): string {
  return [
    record.name,
    String(record.originKey),
    record.type === undefined ? "" : JSON.stringify(record.type),
    record.resourceKind ?? "",
    record.storage ?? "",
    record.backingPlaceKey === undefined ? "" : String(record.backingPlaceKey),
  ].join("|");
}

export function missingMonoTypePlaceholder(): MonoCheckedType {
  return { kind: "error" } as MonoCheckedType;
}

/** @deprecated Use {@link missingMonoTypePlaceholder} for unknown types during freeze. */
export function unitMonoType(): MonoCheckedType {
  return missingMonoTypePlaceholder();
}

export function resolveMonoLocalId(input: {
  readonly functionInstance: MonoFunctionInstance | undefined;
  readonly localRecord: DraftProofMirLocalRecord;
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): MonoLocalId | undefined {
  const parsed = parseDraftLocalKey(input.localRecord.key);
  if (parsed !== undefined) {
    return parsed.monoLocalId;
  }

  input.diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
      message: "Proof MIR freeze could not parse monoLocalId from draft local key.",
      functionInstanceId: input.functionInstanceId,
      ownerKey: input.ownerKey,
      rootCauseKey: "local-key",
      stableDetail: `local:${String(input.localRecord.key)}`,
    }),
  );
  return undefined;
}

export function resolveLocalTypeFromInstance(
  functionInstance: MonoFunctionInstance | undefined,
  monoLocalId: MonoLocalId,
): MonoCheckedType | undefined {
  return functionInstance?.locals.get(monoLocalId)?.type;
}

export function resolveLocalResourceKindFromInstance(
  functionInstance: MonoFunctionInstance | undefined,
  monoLocalId: MonoLocalId,
): DraftProofMirLocalRecord["resourceKind"] | undefined {
  return functionInstance?.locals.get(monoLocalId)?.resourceKind;
}

export function resolveLocalStorageKind(
  record: DraftProofMirLocalRecord,
): ProofMirLocalStorageKind {
  return record.storage ?? "scalarSsa";
}

export function exitRecordPayload(record: {
  readonly role: string;
  readonly fromBlockKey: ProofMirCanonicalKey;
}): string {
  return [record.role, String(record.fromBlockKey)].join("|");
}

export function factRecordPayload(record: DraftProofMirFactRecord): string {
  return [record.role, record.kind, record.authorityKey, String(record.originKey)].join("|");
}

export function layoutTermRecordPayload(record: DraftProofMirLayoutTermRecord): string {
  return [record.layoutReferenceKey, record.termPath].join("|");
}

export function privateStateGenerationRecordPayload(
  record: DraftProofMirPrivateStateGenerationRecord,
): string {
  return [String(record.placeKey), String(record.generationOrdinal), String(record.originKey)].join(
    "|",
  );
}

export function controlEdgeKindFromRole(role: string): ProofMirControlEdge["kind"] {
  switch (role) {
    case "branchTrue":
    case "branchFalse":
    case "switchCase":
    case "validationOk":
    case "validationErr":
    case "attemptSuccess":
    case "attemptError":
    case "scopeBreak":
    case "scopeContinue":
    case "yieldSuspend":
    case "yieldResume":
    case "returnExit":
    case "panicExit":
    case "normal":
      return role;
    default:
      return "normal";
  }
}

export function parseOriginOwner(record: DraftProofMirOriginRecord): ProofMirOriginOwner {
  if (record.ownerKey === "program") {
    return { kind: "program" };
  }
  if (record.ownerKey.startsWith("function:")) {
    return {
      kind: "function",
      functionInstanceId: record.ownerKey.slice("function:".length) as MonoInstanceId,
    };
  }
  if (record.ownerKey.startsWith("image:")) {
    return {
      kind: "image",
      imageInstanceId: record.ownerKey.slice("image:".length) as MonoInstanceId,
    };
  }
  return { kind: "program" };
}

export function mergeAssignmentError<Entry, DenseId>(
  assignment: ProofMirDenseIdAssignmentResult<Entry, DenseId>,
  diagnostics: ProofMirDiagnostic[],
): assignment is { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] } {
  if (assignment.kind === "error") {
    for (const diagnostic of assignment.diagnostics) {
      diagnostics.push(diagnostic);
    }
    return true;
  }
  return false;
}

export function emptyDeterministicTable<LookupId, Entry>(
  prefix: string,
): ProofMirDeterministicTable<LookupId, Entry> {
  const result = proofMirDeterministicTable<LookupId, Entry>({
    entries: [],
    keyOf: (entry) => proofMirCanonicalKey(`${prefix}:${JSON.stringify(entry)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`${prefix}:${String(id)}`),
    normalizePayload: () => "",
  });
  if (result.kind !== "ok") {
    throw new Error(`empty ${prefix} table failed`);
  }
  return result.table;
}

export function freezeOriginAssignment(input: {
  readonly entries: readonly DraftProofMirOriginRecord[];
}): ProofMirDenseIdAssignmentResult<DraftProofMirOriginRecord, ProofMirOriginId> {
  return assignProofMirDenseIds({
    entries: input.entries,
    keyOf: (entry) => entry.key,
    idOf: proofMirOriginId,
    normalizePayload: originRecordPayload,
  });
}

export function buildFrozenOriginTable(
  assignment: Extract<
    ProofMirDenseIdAssignmentResult<DraftProofMirOriginRecord, ProofMirOriginId>,
    { readonly kind: "ok" }
  >,
): ProofMirDeterministicTable<ProofMirOriginId, ProofMirOrigin> {
  const frozenOrigins = assignment.entries.map((record) => {
    const originId = assignment.lookup.resolve(record.key)!;
    return {
      originId,
      owner: parseOriginOwner(record),
      ...(record.note !== undefined ? { note: record.note } : {}),
    } satisfies ProofMirOrigin;
  });

  const table = proofMirDeterministicTable({
    entries: frozenOrigins,
    keyOf: (origin) => proofMirCanonicalKey(`origin:${String(origin.originId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`origin:${String(id)}`),
    normalizePayload: (origin) => `${origin.owner.kind}:${String(origin.originId)}`,
  });
  if (table.kind !== "ok") {
    throw new Error("origin table failed");
  }
  return table.table;
}

export function obligationIdByProofKey(
  proofMetadata: MonoProofMetadata,
): ReadonlyMap<string, MonoInstantiatedProofId<ObligationId>> {
  const lookup = new Map<string, MonoInstantiatedProofId<ObligationId>>();
  const obligations = proofMetadata.obligations?.entries() ?? [];
  for (const obligation of obligations) {
    lookup.set(proofMetadataIdKey(obligation.obligationId), obligation.obligationId);
  }
  return lookup;
}

export function sessionIdByProofKey(
  proofMetadata: MonoProofMetadata,
): ReadonlyMap<string, MonoInstantiatedProofId<SessionId>> {
  const lookup = new Map<string, MonoInstantiatedProofId<SessionId>>();
  for (const session of proofMetadata.sessions?.entries() ?? []) {
    lookup.set(proofMetadataIdKey(session.sessionId), session.sessionId);
  }
  return lookup;
}

export function brandIdByProofKey(
  proofMetadata: MonoProofMetadata,
): ReadonlyMap<string, MonoInstantiatedProofId<BrandId>> {
  const lookup = new Map<string, MonoInstantiatedProofId<BrandId>>();
  for (const brand of proofMetadata.brands?.entries() ?? []) {
    lookup.set(proofMetadataIdKey(brand.brandId), brand.brandId);
  }
  return lookup;
}

import type {
  HirAttempt,
  HirBrand,
  HirCallSiteRequirement,
  HirFactOrigin,
  HirImageOrigin,
  HirObligation,
  HirPlatformContractEdge,
  HirPrivateStateTransition,
  HirResourcePlace,
  HirSession,
  HirTerminalCall,
  HirValidation,
} from "../hir/hir";
import type {
  HirExpressionId,
  HirLocalId,
  HirOwnedId,
  HirProofOwner,
  HirStatementId,
} from "../hir/ids";
import type { HirProofMetadata } from "../hir/proof-metadata";
import type { ImageId } from "../semantic/ids";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { instantiatedHirId, type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoProofOwner,
  MonoStatementId,
} from "./mono-hir";

export interface ProofMetadataIndex {
  recordsForOwner(owner: HirProofOwner): ProofRecordsByOwner;
}

export interface ProofRecordsByOwner {
  readonly obligations: readonly HirObligation[];
  readonly sessions: readonly HirSession[];
  readonly brands: readonly HirBrand[];
  readonly resourcePlaces: readonly HirResourcePlace[];
  readonly callSiteRequirements: readonly HirCallSiteRequirement[];
  readonly validations: readonly HirValidation[];
  readonly attempts: readonly HirAttempt[];
  readonly terminalCalls: readonly HirTerminalCall[];
  readonly privateStateTransitions: readonly HirPrivateStateTransition[];
  readonly factOrigins: readonly HirFactOrigin[];
  readonly platformContractEdges: readonly HirPlatformContractEdge[];
  readonly imageOrigins: readonly HirImageOrigin[];
}

export function buildProofMetadataIndex(metadata: HirProofMetadata): ProofMetadataIndex {
  const recordsByOwner = new Map<string, MutableProofRecordsByOwner>();
  const emptyRecords = emptyProofRecordsByOwner();

  for (const record of metadata.obligations.entries()) {
    recordsForMutableOwner(recordsByOwner, record.obligationId.owner).obligations.push(record);
  }
  for (const record of metadata.sessions.entries()) {
    recordsForMutableOwner(recordsByOwner, record.sessionId.owner).sessions.push(record);
  }
  for (const record of metadata.brands.entries()) {
    recordsForMutableOwner(recordsByOwner, record.brandId.owner).brands.push(record);
  }
  for (const record of metadata.resourcePlaces.entries()) {
    recordsForMutableOwner(recordsByOwner, record.placeId.owner).resourcePlaces.push(record);
  }
  for (const record of metadata.callSiteRequirements.entries()) {
    recordsForMutableOwner(
      recordsByOwner,
      record.callSiteRequirementId.owner,
    ).callSiteRequirements.push(record);
  }
  for (const record of metadata.validations.entries()) {
    recordsForMutableOwner(recordsByOwner, record.validationId.owner).validations.push(record);
  }
  for (const record of metadata.attempts.entries()) {
    recordsForMutableOwner(recordsByOwner, record.attemptId.owner).attempts.push(record);
  }
  for (const record of metadata.terminalCalls.entries()) {
    recordsForMutableOwner(recordsByOwner, record.terminalCallId.owner).terminalCalls.push(record);
  }
  for (const record of metadata.privateStateTransitions.entries()) {
    recordsForMutableOwner(recordsByOwner, record.transitionId.owner).privateStateTransitions.push(
      record,
    );
  }
  for (const record of metadata.factOrigins.entries()) {
    recordsForMutableOwner(recordsByOwner, record.factOriginId.owner).factOrigins.push(record);
  }
  for (const record of metadata.platformContractEdges.entries()) {
    recordsForMutableOwner(recordsByOwner, record.edgeId.owner).platformContractEdges.push(record);
  }
  for (const record of metadata.imageOrigins.entries()) {
    recordsForMutableOwner(recordsByOwner, record.imageOriginId.owner).imageOrigins.push(record);
  }

  return {
    recordsForOwner: (owner) => recordsByOwner.get(ownerKey(owner)) ?? emptyRecords,
  };
}

interface MutableProofRecordsByOwner {
  readonly obligations: HirObligation[];
  readonly sessions: HirSession[];
  readonly brands: HirBrand[];
  readonly resourcePlaces: HirResourcePlace[];
  readonly callSiteRequirements: HirCallSiteRequirement[];
  readonly validations: HirValidation[];
  readonly attempts: HirAttempt[];
  readonly terminalCalls: HirTerminalCall[];
  readonly privateStateTransitions: HirPrivateStateTransition[];
  readonly factOrigins: HirFactOrigin[];
  readonly platformContractEdges: HirPlatformContractEdge[];
  readonly imageOrigins: HirImageOrigin[];
}

function recordsForMutableOwner(
  recordsByOwner: Map<string, MutableProofRecordsByOwner>,
  owner: HirProofOwner,
): MutableProofRecordsByOwner {
  const key = ownerKey(owner);
  const existing = recordsByOwner.get(key);
  if (existing !== undefined) return existing;
  const created = emptyProofRecordsByOwner();
  recordsByOwner.set(key, created);
  return created;
}

function emptyProofRecordsByOwner(): MutableProofRecordsByOwner {
  return {
    obligations: [],
    sessions: [],
    brands: [],
    resourcePlaces: [],
    callSiteRequirements: [],
    validations: [],
    attempts: [],
    terminalCalls: [],
    privateStateTransitions: [],
    factOrigins: [],
    platformContractEdges: [],
    imageOrigins: [],
  };
}

export function ownersEqual(left: HirProofOwner, right: HirProofOwner): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "function":
      return right.kind === "function" && left.functionId === right.functionId;
    case "image":
      return right.kind === "image" && left.imageId === right.imageId;
    case "type":
      return right.kind === "type" && left.typeId === right.typeId;
  }
}

export type ProofMetadataLookupResult =
  | { readonly kind: "ok"; readonly owner: HirProofOwner; readonly canonicalKey: string }
  | { readonly kind: "missing"; readonly diagnostics: readonly MonoDiagnostic[] }
  | { readonly kind: "dangling"; readonly diagnostics: readonly MonoDiagnostic[] };

export type ProofMetadataIdFamily =
  | "obligation"
  | "session"
  | "brand"
  | "resourcePlace"
  | "callSiteRequirement"
  | "validation"
  | "attempt"
  | "terminalCall"
  | "privateStateTransition"
  | "factOrigin"
  | "platformContractEdge"
  | "imageOrigin";

export interface ProofMetadataOwnerLookupRequest {
  readonly family: ProofMetadataIdFamily;
  readonly id: HirOwnedId<unknown>;
}

export function lookupProofMetadataOwner(
  metadata: HirProofMetadata,
  request: ProofMetadataOwnerLookupRequest,
): ProofMetadataLookupResult {
  const hirProofId = request.id;
  const requested = hirProofId.owner;
  const found = findOwnerRecord(metadata, request);
  if (found === undefined) {
    return {
      kind: "missing",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_DANGLING_PROOF_METADATA",
          message: "Proof metadata record is missing for the requested owner.",
          ownerKey: ownerKey(requested),
          rootCauseKey: "proof-metadata",
          stableDetail: `missing:${ownerKey(requested)}`,
        }),
      ],
    };
  }
  if (!ownersEqual(found.owner, requested)) {
    return {
      kind: "dangling",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_DANGLING_PROOF_METADATA",
          message: "Proof metadata record owner does not match the requested owner.",
          ownerKey: ownerKey(requested),
          rootCauseKey: "proof-metadata",
          stableDetail: `mismatch:${ownerKey(found.owner)}->${ownerKey(requested)}`,
        }),
      ],
    };
  }
  return { kind: "ok", owner: found.owner, canonicalKey: ownerKey(requested) };
}

function findOwnerRecord(
  metadata: HirProofMetadata,
  request: ProofMetadataOwnerLookupRequest,
): { readonly owner: HirProofOwner } | undefined {
  switch (request.family) {
    case "obligation":
      return findOwnerInTable(metadata.obligations, (entry) => entry.obligationId, request.id);
    case "session":
      return findOwnerInTable(metadata.sessions, (entry) => entry.sessionId, request.id);
    case "brand":
      return findOwnerInTable(metadata.brands, (entry) => entry.brandId, request.id);
    case "resourcePlace":
      return findOwnerInTable(metadata.resourcePlaces, (entry) => entry.placeId, request.id);
    case "callSiteRequirement":
      return findOwnerInTable(
        metadata.callSiteRequirements,
        (entry) => entry.callSiteRequirementId,
        request.id,
      );
    case "validation":
      return findOwnerInTable(metadata.validations, (entry) => entry.validationId, request.id);
    case "attempt":
      return findOwnerInTable(metadata.attempts, (entry) => entry.attemptId, request.id);
    case "terminalCall":
      return findOwnerInTable(metadata.terminalCalls, (entry) => entry.terminalCallId, request.id);
    case "privateStateTransition":
      return findOwnerInTable(
        metadata.privateStateTransitions,
        (entry) => entry.transitionId,
        request.id,
      );
    case "factOrigin":
      return findOwnerInTable(metadata.factOrigins, (entry) => entry.factOriginId, request.id);
    case "platformContractEdge":
      return findOwnerInTable(metadata.platformContractEdges, (entry) => entry.edgeId, request.id);
    case "imageOrigin":
      return findOwnerInTable(metadata.imageOrigins, (entry) => entry.imageOriginId, request.id);
  }
}

function findOwnerInTable<Entry extends object>(
  table: { readonly entries: () => readonly Entry[] },
  getId: (entry: Entry) => HirOwnedId<unknown>,
  requested: HirOwnedId<unknown>,
): { readonly owner: HirProofOwner } | undefined {
  let ownerWithMatchingId: HirProofOwner | undefined;
  for (const entry of table.entries()) {
    const id = getId(entry);
    if (id.id === requested.id) {
      if (ownersEqual(id.owner, requested.owner)) return { owner: id.owner };
      ownerWithMatchingId ??= id.owner;
    }
  }
  if (ownerWithMatchingId !== undefined) return { owner: ownerWithMatchingId };
  return undefined;
}

function ownerForRecord(record: { readonly owner: HirProofOwner } | object): HirProofOwner {
  if ("obligationId" in record) {
    return (record as { readonly obligationId: HirOwnedId<unknown> }).obligationId.owner;
  }
  if ("sessionId" in record) {
    return (record as { readonly sessionId: HirOwnedId<unknown> }).sessionId.owner;
  }
  if ("brandId" in record) {
    return (record as { readonly brandId: HirOwnedId<unknown> }).brandId.owner;
  }
  if ("placeId" in record) {
    return (record as { readonly placeId: HirOwnedId<unknown> }).placeId.owner;
  }
  if ("callSiteRequirementId" in record) {
    return (record as { readonly callSiteRequirementId: HirOwnedId<unknown> }).callSiteRequirementId
      .owner;
  }
  if ("validationId" in record) {
    return (record as { readonly validationId: HirOwnedId<unknown> }).validationId.owner;
  }
  if ("attemptId" in record) {
    return (record as { readonly attemptId: HirOwnedId<unknown> }).attemptId.owner;
  }
  if ("terminalCallId" in record) {
    return (record as { readonly terminalCallId: HirOwnedId<unknown> }).terminalCallId.owner;
  }
  if ("transitionId" in record) {
    return (record as { readonly transitionId: HirOwnedId<unknown> }).transitionId.owner;
  }
  if ("factOriginId" in record) {
    return (record as { readonly factOriginId: HirOwnedId<unknown> }).factOriginId.owner;
  }
  if ("edgeId" in record) {
    return (record as { readonly edgeId: HirOwnedId<unknown> }).edgeId.owner;
  }
  if ("imageOriginId" in record) {
    return (record as { readonly imageOriginId: HirOwnedId<unknown> }).imageOriginId.owner;
  }
  throw new Error("Unknown proof metadata record shape.");
}

export interface MonoRemapIndex {
  local(id: HirLocalId): MonoLocalId;
  expression(id: HirExpressionId): MonoExpressionId;
  statement(id: HirStatementId): MonoStatementId;
  proof<IdValue>(hirProofId: HirOwnedId<IdValue>): MonoInstantiatedProofId<IdValue>;
}

export interface CreateMonoRemapIndexInput {
  readonly instanceId: MonoInstanceId;
}

export function createMonoRemapIndex(input: CreateMonoRemapIndexInput): MonoRemapIndex {
  return {
    local: (id) => instantiatedHirId(input.instanceId, id),
    expression: (id) => instantiatedHirId(input.instanceId, id),
    statement: (id) => instantiatedHirId(input.instanceId, id),
    proof: <IdValue>(hirProofId: HirOwnedId<IdValue>) => ({
      owner: monoProofOwnerFor(input.instanceId, hirProofId.owner),
      instanceId: input.instanceId,
      hirId: hirProofId.id,
    }),
  };
}

export interface ImageInstantiationKey {
  readonly imageId: ImageId;
  readonly instanceId: MonoInstanceId;
}

export interface InstantiateImageOwnedRecordInput<Record> {
  readonly record: Record;
  readonly key: ImageInstantiationKey;
}

export type InstantiateImageOwnedRecordResult<Record> =
  | { readonly kind: "ok"; readonly record: Record; readonly instanceId: MonoInstanceId }
  | { readonly kind: "duplicate"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateImageOwnedRecord<Record extends object>(
  input: InstantiateImageOwnedRecordInput<Record>,
  instantiations: Set<string>,
): InstantiateImageOwnedRecordResult<Record> {
  const owner = ownerForRecord(input.record);
  if (owner.kind !== "image") {
    return {
      kind: "ok",
      record: input.record,
      instanceId: input.key.instanceId,
    };
  }
  if (owner.imageId !== input.key.imageId) {
    return {
      kind: "duplicate",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_DANGLING_PROOF_METADATA",
          message: "Image-owned record image id does not match the selected image.",
          ownerKey: ownerKey(owner),
          rootCauseKey: "proof-metadata",
          stableDetail: `image-mismatch:${ownerKey(owner)}`,
        }),
      ],
    };
  }
  const dedupeKey = `${ownerKey(owner)}|${String(input.key.instanceId)}`;
  if (instantiations.has(dedupeKey)) {
    return {
      kind: "duplicate",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_DANGLING_PROOF_METADATA",
          message: "Image-owned proof metadata instantiated more than once.",
          ownerKey: ownerKey(owner),
          rootCauseKey: "proof-metadata",
          stableDetail: `duplicate:${dedupeKey}`,
        }),
      ],
    };
  }
  instantiations.add(dedupeKey);
  return {
    kind: "ok",
    record: input.record,
    instanceId: input.key.instanceId,
  };
}

export function ownerKey(owner: HirProofOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${String(owner.functionId).padStart(12, "0")}`;
    case "image":
      return `image:${String(owner.imageId).padStart(12, "0")}`;
    case "type":
      return `type:${String(owner.typeId).padStart(12, "0")}`;
  }
}

export function monoProofOwnerFor(
  instanceId: MonoInstanceId,
  owner: HirProofOwner,
): MonoProofOwner {
  if (owner.kind === "image") return { kind: "image", instanceId };
  return { kind: owner.kind, instanceId };
}

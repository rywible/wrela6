import type { ValidationId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import { monoInstanceId } from "../../mono/ids";
import type {
  MonoInstantiatedProofId,
  MonoResourcePlace,
  MonoCheckedType,
} from "../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  compareProofMirCanonicalKeys,
  proofMirDeterministicTable,
  proofMirLengthDelimitedField,
} from "../canonicalization/canonical-order";
import { draftPlaceKey, draftPrivateStateGenerationKey, draftScopeKey } from "../draft/draft-keys";
import type { MonoPlaceProjection, MonoPlaceRoot } from "../../mono/mono-hir";
import type { ProofMirPlaceProjection } from "../model/graph";

export type DraftProofMirPlaceRoot =
  | MonoPlaceRoot
  | { readonly kind: "blockParameter"; readonly valueKey: ProofMirCanonicalKey }
  | { readonly kind: "runtimeTemporary"; readonly valueKey: ProofMirCanonicalKey };

export type DraftProofMirPlaceProjection = MonoPlaceProjection | ProofMirPlaceProjection;

export type ProofMirLocalStorageKind = "scalarSsa" | "placeBacked";

export interface ProofMirLocalStoragePreScanFact {
  readonly isCopyScalar: boolean;
  readonly addressTaken: boolean;
  readonly borrowed: boolean;
  readonly projected: boolean;
  readonly consumed: boolean;
  readonly validatedBuffer: boolean;
  readonly sessionBound: boolean;
  readonly privateState: boolean;
  readonly capability: boolean;
  readonly aggregate: boolean;
}

export interface ProofMirDraftScopeTree {
  scopeKey(role: string): ProofMirCanonicalKey;
  parentRole(role: string): string | undefined;
  scopeStack(role: string): readonly string[];
}

export interface DraftProofMirStructuredPlace {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly root: DraftProofMirPlaceRoot;
  readonly projection: readonly DraftProofMirPlaceProjection[];
  readonly monoPlaceCanonicalKey?: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly type?: MonoCheckedType;
  readonly resourceKind?: ConcreteResourceKind;
}

export interface DraftProofMirLoanRecord {
  readonly key: ProofMirCanonicalKey;
  readonly mode: "shared" | "exclusive";
  readonly placeKey: ProofMirCanonicalKey;
  readonly scopeKey: ProofMirCanonicalKey;
  readonly startOriginKey: ProofMirCanonicalKey;
  readonly endOriginKey?: ProofMirCanonicalKey;
}

export interface DraftProofMirObligationReference {
  readonly obligationProofKey: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirSessionMemberReference {
  readonly sessionProofKey: string;
  readonly brandProofKey: string;
  readonly obligationProofKey?: string;
  readonly placeKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirPrivateStateGenerationReference {
  readonly generationKey: ProofMirCanonicalKey;
  readonly placeKey: ProofMirCanonicalKey;
  readonly producedByProofKey?: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirResourceBoundarySet {
  readonly places: readonly ProofMirCanonicalKey[];
  readonly loans: readonly ProofMirCanonicalKey[];
  readonly obligations: readonly DraftProofMirObligationReference[];
  readonly sessionMembers: readonly DraftProofMirSessionMemberReference[];
  readonly privateStateGenerations: readonly DraftProofMirPrivateStateGenerationReference[];
}

export type DraftProofMirEdgeEffect =
  | { readonly kind: "consumePlace"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "introducePlace"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "startLoan"; readonly loanKey: ProofMirCanonicalKey }
  | { readonly kind: "endLoan"; readonly loanKey: ProofMirCanonicalKey }
  | {
      readonly kind: "openObligation";
      readonly obligationProofKey: string;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "dischargeObligation";
      readonly obligationProofKey: string;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "openSessionMember";
      readonly sessionProofKey: string;
      readonly brandProofKey: string;
      readonly obligationProofKey?: string;
      readonly placeKey?: ProofMirCanonicalKey;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "closeSessionMember";
      readonly sessionProofKey: string;
      readonly brandProofKey: string;
      readonly obligationProofKey?: string;
      readonly placeKey?: ProofMirCanonicalKey;
      readonly originKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "advancePrivateState";
      readonly fromGenerationKey: ProofMirCanonicalKey;
      readonly toGenerationKey: ProofMirCanonicalKey;
    };

export interface DraftProofMirPrivateStateTransitionRecord {
  readonly key: ProofMirCanonicalKey;
  readonly transitionProofKey: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface ProofMirEffectsResources {
  placeFromMono(input: {
    readonly monoPlace: MonoResourcePlace;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  placeFromBlockParameter(input: {
    readonly valueKey: ProofMirCanonicalKey;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  placeFromRuntimeTemporary(input: {
    readonly valueKey: ProofMirCanonicalKey;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  placeFromTemporary(input: {
    readonly ordinal: number;
    readonly originKey: ProofMirCanonicalKey;
    readonly type?: MonoCheckedType;
    readonly resourceKind?: ConcreteResourceKind;
  }): ProofMirCanonicalKey;
  placeFromValidationPayload(input: {
    readonly validationId: MonoInstantiatedProofId<ValidationId>;
    readonly originKey: ProofMirCanonicalKey;
    readonly type?: MonoCheckedType;
    readonly resourceKind?: ConcreteResourceKind;
  }): ProofMirCanonicalKey;
  projectPlace(input: {
    readonly basePlaceKey: ProofMirCanonicalKey;
    readonly projection: DraftProofMirPlaceProjection;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  draftPlace(key: ProofMirCanonicalKey): DraftProofMirStructuredPlace;
  placeEntries(): readonly DraftProofMirStructuredPlace[];
  startLoan(input: {
    readonly mode: "shared" | "exclusive";
    readonly placeKey: ProofMirCanonicalKey;
    readonly scopeKey: ProofMirCanonicalKey;
    readonly startOriginKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  endLoan(input: {
    readonly loanKey: ProofMirCanonicalKey;
    readonly endOriginKey: ProofMirCanonicalKey;
  }): void;
  draftLoan(key: ProofMirCanonicalKey): DraftProofMirLoanRecord;
  recordEdgeEffect(effect: DraftProofMirEdgeEffect): ProofMirCanonicalKey;
  edgeEffectEntries(): readonly DraftProofMirEdgeEffect[];
  privateStateGenerationKey(input: {
    readonly placeKey: ProofMirCanonicalKey;
    readonly generationOrdinal: number;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  recordPrivateStateTransition(input: {
    readonly transitionProofKey: string;
    readonly originKey: ProofMirCanonicalKey;
  }): ProofMirCanonicalKey;
  privateStateTransitionEntries(): readonly DraftProofMirPrivateStateTransitionRecord[];
}

interface DraftProofMirPlaceRecordInternal {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly root: DraftProofMirPlaceRoot;
  readonly projection: readonly DraftProofMirPlaceProjection[];
  readonly monoPlaceCanonicalKey?: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly type?: MonoCheckedType;
  readonly resourceKind?: ConcreteResourceKind;
}

function draftEntityKey(
  kind: string,
  fields: readonly { readonly kind: string; readonly payload: string }[],
): ProofMirCanonicalKey {
  const segments = fields.map((field) => proofMirLengthDelimitedField(field.kind, field.payload));
  return proofMirCanonicalKey(`${kind}:${segments.join(":")}`);
}

function stringField(
  kind: string,
  payload: string,
): { readonly kind: string; readonly payload: string } {
  return { kind, payload };
}

function monoInstanceField(
  kind: string,
  functionInstanceId: MonoInstanceId,
): { readonly kind: string; readonly payload: string } {
  return { kind, payload: String(functionInstanceId) };
}

function canonicalReferenceField(
  kind: string,
  key: ProofMirCanonicalKey,
): { readonly kind: string; readonly payload: string } {
  return { kind, payload: String(key) };
}

function normalizePlaceRootKey(root: DraftProofMirPlaceRoot): string {
  switch (root.kind) {
    case "receiver":
      return `receiver:${String(root.parameterId)}`;
    case "parameter":
      return `parameter:${String(root.parameterId)}`;
    case "local":
      return `local:${String(root.localId.instanceId)}/${String(root.localId.hirId)}`;
    case "temporary":
      return `temporary:${String(root.ordinal)}`;
    case "imageDevice":
      return `imageDevice:${String(root.imageId)}/${String(root.fieldId)}`;
    case "validationPayload":
      return `validationPayload:${String(root.validationId.instanceId)}/${String(root.validationId.hirId)}`;
    case "error":
      return "error";
    case "blockParameter":
      return `blockParameter:${String(root.valueKey)}`;
    case "runtimeTemporary":
      return `runtimeTemporary:${String(root.valueKey)}`;
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

function normalizePlaceProjectionKey(projection: DraftProofMirPlaceProjection): string {
  switch (projection.kind) {
    case "field":
      return `field:${String(projection.fieldId)}`;
    case "deref":
      return "deref";
    case "variant":
      return `variant:${projection.name}`;
    case "validatedPacketPayload":
      return `validatedPacketPayload:${String(projection.validationId.instanceId)}/${String(projection.validationId.hirId)}`;
    case "imageDevice":
      return `imageDevice:${String(projection.fieldId)}`;
    default: {
      const unreachable: never = projection;
      return unreachable;
    }
  }
}

function draftStructuredPlaceKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly rootKey: string;
  readonly projectionKeys: readonly string[];
}): ProofMirCanonicalKey {
  const fields = [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("root", input.rootKey),
    stringField("projection", input.projectionKeys.join("/")),
  ];
  return draftEntityKey("placeStructured", fields);
}

function draftLoanKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly mode: "shared" | "exclusive";
  readonly placeKey: ProofMirCanonicalKey;
  readonly scopeKey: ProofMirCanonicalKey;
  readonly startOriginKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  return draftEntityKey("loan", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("mode", input.mode),
    canonicalReferenceField("placeKey", input.placeKey),
    canonicalReferenceField("scopeKey", input.scopeKey),
    canonicalReferenceField("startOriginKey", input.startOriginKey),
  ]);
}

function draftPrivateStateTransitionKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly transitionProofKey: string;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  return draftEntityKey("privateStateTransition", [
    monoInstanceField("functionInstanceId", input.functionInstanceId),
    stringField("transitionProofKey", input.transitionProofKey),
    canonicalReferenceField("originKey", input.originKey),
  ]);
}

function normalizeDraftPlaceRecord(record: DraftProofMirPlaceRecordInternal): string {
  return JSON.stringify({
    root: normalizePlaceRootKey(record.root),
    projection: record.projection.map(normalizePlaceProjectionKey),
    monoPlaceCanonicalKey: record.monoPlaceCanonicalKey ?? null,
  });
}

function normalizeDraftPrivateStateTransitionRecord(
  record: DraftProofMirPrivateStateTransitionRecord,
): string {
  return JSON.stringify({
    transitionProofKey: record.transitionProofKey,
    originKey: String(record.originKey),
  });
}

export function classifyProofMirLocalStorage(
  fact: ProofMirLocalStoragePreScanFact,
): ProofMirLocalStorageKind {
  if (!fact.isCopyScalar) {
    return "placeBacked";
  }
  if (
    fact.addressTaken ||
    fact.borrowed ||
    fact.projected ||
    fact.consumed ||
    fact.validatedBuffer ||
    fact.sessionBound ||
    fact.privateState ||
    fact.capability ||
    fact.aggregate
  ) {
    return "placeBacked";
  }
  return "scalarSsa";
}

export function createProofMirDraftScopeTree(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly entries: readonly { readonly role: string; readonly parentRole?: string }[];
}): ProofMirDraftScopeTree {
  const scopeKeys = new Map<string, ProofMirCanonicalKey>();
  const parentRoles = new Map<string, string>();

  for (const entry of input.entries) {
    const parentScopeKey =
      entry.parentRole === undefined ? undefined : scopeKeys.get(entry.parentRole);
    if (entry.parentRole !== undefined && parentScopeKey === undefined) {
      throw new RangeError(`Unknown parent scope role: ${entry.parentRole}.`);
    }
    const scopeKey = draftScopeKey({
      functionInstanceId: input.functionInstanceId,
      role: entry.role,
      ...(parentScopeKey === undefined ? {} : { parentScopeKey }),
    });
    scopeKeys.set(entry.role, scopeKey);
    if (entry.parentRole !== undefined) {
      parentRoles.set(entry.role, entry.parentRole);
    }
  }

  return {
    scopeKey(role: string): ProofMirCanonicalKey {
      const scopeKey = scopeKeys.get(role);
      if (scopeKey === undefined) {
        throw new RangeError(`Unknown scope role: ${role}.`);
      }
      return scopeKey;
    },
    parentRole(role: string): string | undefined {
      return parentRoles.get(role);
    },
    scopeStack(role: string): readonly string[] {
      const stack: string[] = [];
      let current: string | undefined = role;
      const visited = new Set<string>();
      while (current !== undefined) {
        if (visited.has(current)) {
          throw new RangeError(`Scope cycle detected at role: ${current}.`);
        }
        visited.add(current);
        stack.push(current);
        current = parentRoles.get(current);
      }
      return stack;
    },
  };
}

export function createProofMirDraftScopeTreeFromRoles(
  entries: readonly { readonly key: string; readonly parent?: string }[],
): ProofMirDraftScopeTree {
  return createProofMirDraftScopeTree({
    functionInstanceId: monoInstanceId("fn:scope-tree"),
    entries: entries.map((entry) => ({
      role: entry.key,
      ...(entry.parent === undefined ? {} : { parentRole: entry.parent }),
    })),
  });
}

/** @deprecated Use `createProofMirDraftScopeTreeFromRoles` instead. */
export const proofMirScopeTreeForTest = createProofMirDraftScopeTreeFromRoles;

export function crossedScopesForDraftEdge(
  tree: ProofMirDraftScopeTree,
  edge: { readonly from: string; readonly targetRole: string },
): readonly string[] {
  const sourceStack = tree.scopeStack(edge.from);
  const targetStack = tree.scopeStack(edge.targetRole);

  let sourceIndex = sourceStack.length - 1;
  let targetIndex = targetStack.length - 1;

  while (
    sourceIndex >= 0 &&
    targetIndex >= 0 &&
    sourceStack[sourceIndex] === targetStack[targetIndex]
  ) {
    sourceIndex -= 1;
    targetIndex -= 1;
  }

  return sourceStack.slice(0, sourceIndex + 1);
}

export function normalizeDraftEdgeEffect(effect: DraftProofMirEdgeEffect): DraftProofMirEdgeEffect {
  switch (effect.kind) {
    case "consumePlace":
      return { kind: "consumePlace", placeKey: effect.placeKey };
    case "introducePlace":
      return { kind: "introducePlace", placeKey: effect.placeKey };
    case "startLoan":
      return { kind: "startLoan", loanKey: effect.loanKey };
    case "endLoan":
      return { kind: "endLoan", loanKey: effect.loanKey };
    case "openObligation":
      return {
        kind: "openObligation",
        obligationProofKey: effect.obligationProofKey,
        originKey: effect.originKey,
      };
    case "dischargeObligation":
      return {
        kind: "dischargeObligation",
        obligationProofKey: effect.obligationProofKey,
        originKey: effect.originKey,
      };
    case "openSessionMember":
      return {
        kind: "openSessionMember",
        sessionProofKey: effect.sessionProofKey,
        brandProofKey: effect.brandProofKey,
        ...(effect.obligationProofKey === undefined
          ? {}
          : { obligationProofKey: effect.obligationProofKey }),
        ...(effect.placeKey === undefined ? {} : { placeKey: effect.placeKey }),
        originKey: effect.originKey,
      };
    case "closeSessionMember":
      return {
        kind: "closeSessionMember",
        sessionProofKey: effect.sessionProofKey,
        brandProofKey: effect.brandProofKey,
        ...(effect.obligationProofKey === undefined
          ? {}
          : { obligationProofKey: effect.obligationProofKey }),
        ...(effect.placeKey === undefined ? {} : { placeKey: effect.placeKey }),
        originKey: effect.originKey,
      };
    case "advancePrivateState":
      return {
        kind: "advancePrivateState",
        fromGenerationKey: effect.fromGenerationKey,
        toGenerationKey: effect.toGenerationKey,
      };
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function edgeEffectFields(effect: DraftProofMirEdgeEffect): readonly {
  readonly kind: string;
  readonly payload: string;
}[] {
  switch (effect.kind) {
    case "consumePlace":
      return [
        stringField("kind", "consumePlace"),
        canonicalReferenceField("placeKey", effect.placeKey),
      ];
    case "introducePlace":
      return [
        stringField("kind", "introducePlace"),
        canonicalReferenceField("placeKey", effect.placeKey),
      ];
    case "startLoan":
      return [stringField("kind", "startLoan"), canonicalReferenceField("loanKey", effect.loanKey)];
    case "endLoan":
      return [stringField("kind", "endLoan"), canonicalReferenceField("loanKey", effect.loanKey)];
    case "openObligation":
      return [
        stringField("kind", "openObligation"),
        stringField("obligationProofKey", effect.obligationProofKey),
        canonicalReferenceField("originKey", effect.originKey),
      ];
    case "dischargeObligation":
      return [
        stringField("kind", "dischargeObligation"),
        stringField("obligationProofKey", effect.obligationProofKey),
        canonicalReferenceField("originKey", effect.originKey),
      ];
    case "openSessionMember": {
      const fields: { kind: string; payload: string }[] = [
        stringField("kind", "openSessionMember"),
        stringField("sessionProofKey", effect.sessionProofKey),
        stringField("brandProofKey", effect.brandProofKey),
        canonicalReferenceField("originKey", effect.originKey),
      ];
      if (effect.obligationProofKey !== undefined) {
        fields.push(stringField("obligationProofKey", effect.obligationProofKey));
      }
      if (effect.placeKey !== undefined) {
        fields.push(canonicalReferenceField("placeKey", effect.placeKey));
      }
      return fields;
    }
    case "closeSessionMember": {
      const fields: { kind: string; payload: string }[] = [
        stringField("kind", "closeSessionMember"),
        stringField("sessionProofKey", effect.sessionProofKey),
        stringField("brandProofKey", effect.brandProofKey),
        canonicalReferenceField("originKey", effect.originKey),
      ];
      if (effect.obligationProofKey !== undefined) {
        fields.push(stringField("obligationProofKey", effect.obligationProofKey));
      }
      if (effect.placeKey !== undefined) {
        fields.push(canonicalReferenceField("placeKey", effect.placeKey));
      }
      return fields;
    }
    case "advancePrivateState":
      return [
        stringField("kind", "advancePrivateState"),
        canonicalReferenceField("fromGenerationKey", effect.fromGenerationKey),
        canonicalReferenceField("toGenerationKey", effect.toGenerationKey),
      ];
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

export function draftEdgeEffectKey(effect: DraftProofMirEdgeEffect): ProofMirCanonicalKey {
  return draftEntityKey("edgeEffect", edgeEffectFields(normalizeDraftEdgeEffect(effect)));
}

function obligationReferenceKey(reference: DraftProofMirObligationReference): string {
  return `${reference.obligationProofKey}|${String(reference.originKey)}`;
}

function sessionMemberReferenceKey(reference: DraftProofMirSessionMemberReference): string {
  return JSON.stringify({
    sessionProofKey: reference.sessionProofKey,
    brandProofKey: reference.brandProofKey,
    obligationProofKey: reference.obligationProofKey ?? null,
    placeKey: reference.placeKey === undefined ? null : String(reference.placeKey),
    originKey: String(reference.originKey),
  });
}

function privateStateGenerationReferenceKey(
  reference: DraftProofMirPrivateStateGenerationReference,
): string {
  return JSON.stringify({
    generationKey: String(reference.generationKey),
    placeKey: String(reference.placeKey),
    producedByProofKey: reference.producedByProofKey ?? null,
    originKey: String(reference.originKey),
  });
}

export function sortDraftResourceBoundarySet(input: {
  readonly places: readonly ProofMirCanonicalKey[];
  readonly loans: readonly ProofMirCanonicalKey[];
  readonly obligations: readonly DraftProofMirObligationReference[];
  readonly sessionMembers: readonly DraftProofMirSessionMemberReference[];
  readonly privateStateGenerations: readonly DraftProofMirPrivateStateGenerationReference[];
}): DraftProofMirResourceBoundarySet {
  return {
    places: [...input.places].sort(compareProofMirCanonicalKeys),
    loans: [...input.loans].sort(compareProofMirCanonicalKeys),
    obligations: [...input.obligations].sort((left, right) =>
      compareProofMirCanonicalKeys(
        proofMirCanonicalKey(obligationReferenceKey(left)),
        proofMirCanonicalKey(obligationReferenceKey(right)),
      ),
    ),
    sessionMembers: [...input.sessionMembers].sort((left, right) =>
      compareProofMirCanonicalKeys(
        proofMirCanonicalKey(sessionMemberReferenceKey(left)),
        proofMirCanonicalKey(sessionMemberReferenceKey(right)),
      ),
    ),
    privateStateGenerations: [...input.privateStateGenerations].sort((left, right) =>
      compareProofMirCanonicalKeys(
        proofMirCanonicalKey(privateStateGenerationReferenceKey(left)),
        proofMirCanonicalKey(privateStateGenerationReferenceKey(right)),
      ),
    ),
  };
}

function toStructuredPlace(record: DraftProofMirPlaceRecordInternal): DraftProofMirStructuredPlace {
  return {
    key: record.key,
    functionInstanceId: record.functionInstanceId,
    root: record.root,
    projection: record.projection,
    ...(record.monoPlaceCanonicalKey === undefined
      ? {}
      : { monoPlaceCanonicalKey: record.monoPlaceCanonicalKey }),
    originKey: record.originKey,
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(record.resourceKind === undefined ? {} : { resourceKind: record.resourceKind }),
  };
}

export function createProofMirEffectsResources(input: {
  readonly functionInstanceId: MonoInstanceId;
}): ProofMirEffectsResources {
  const places = new Map<ProofMirCanonicalKey, DraftProofMirPlaceRecordInternal>();
  const loans = new Map<ProofMirCanonicalKey, DraftProofMirLoanRecord>();
  const edgeEffects = new Map<ProofMirCanonicalKey, DraftProofMirEdgeEffect>();
  const privateStateTransitions = new Map<
    ProofMirCanonicalKey,
    DraftProofMirPrivateStateTransitionRecord
  >();

  function internPlace(record: DraftProofMirPlaceRecordInternal): ProofMirCanonicalKey {
    const existing = places.get(record.key);
    if (existing !== undefined) {
      if (normalizeDraftPlaceRecord(existing) !== normalizeDraftPlaceRecord(record)) {
        throw new RangeError(`Incompatible draft place records for key: ${String(record.key)}.`);
      }
      return record.key;
    }
    places.set(record.key, record);
    return record.key;
  }

  function placeRecordForKey(key: ProofMirCanonicalKey): DraftProofMirPlaceRecordInternal {
    const record = places.get(key);
    if (record === undefined) {
      throw new RangeError(`Unknown draft place key: ${String(key)}.`);
    }
    return record;
  }

  function structuredPlaceKeyFor(
    root: DraftProofMirPlaceRoot,
    projection: readonly DraftProofMirPlaceProjection[],
  ): ProofMirCanonicalKey {
    return draftStructuredPlaceKey({
      functionInstanceId: input.functionInstanceId,
      rootKey: normalizePlaceRootKey(root),
      projectionKeys: projection.map(normalizePlaceProjectionKey),
    });
  }

  return {
    placeFromMono(placeInput) {
      const key = draftPlaceKey({
        functionInstanceId: input.functionInstanceId,
        monoPlaceCanonicalKey: placeInput.monoPlace.canonicalKey,
      });
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root: placeInput.monoPlace.root,
        projection: [...placeInput.monoPlace.projection],
        monoPlaceCanonicalKey: placeInput.monoPlace.canonicalKey,
        originKey: placeInput.originKey,
        type: placeInput.monoPlace.type,
        resourceKind: placeInput.monoPlace.resourceKind,
      });
    },

    placeFromBlockParameter(placeInput) {
      const root: DraftProofMirPlaceRoot = {
        kind: "blockParameter",
        valueKey: placeInput.valueKey,
      };
      const key = structuredPlaceKeyFor(root, []);
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root,
        projection: [],
        originKey: placeInput.originKey,
      });
    },

    placeFromRuntimeTemporary(placeInput) {
      const root: DraftProofMirPlaceRoot = {
        kind: "runtimeTemporary",
        valueKey: placeInput.valueKey,
      };
      const key = structuredPlaceKeyFor(root, []);
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root,
        projection: [],
        originKey: placeInput.originKey,
      });
    },

    placeFromTemporary(placeInput) {
      const root: MonoPlaceRoot = {
        kind: "temporary",
        ordinal: placeInput.ordinal,
      };
      const key = structuredPlaceKeyFor(root, []);
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root,
        projection: [],
        originKey: placeInput.originKey,
        type: placeInput.type,
        resourceKind: placeInput.resourceKind,
      });
    },

    placeFromValidationPayload(placeInput) {
      const root: MonoPlaceRoot = {
        kind: "validationPayload",
        validationId: placeInput.validationId,
      };
      const key = structuredPlaceKeyFor(root, []);
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root,
        projection: [],
        originKey: placeInput.originKey,
        type: placeInput.type,
        resourceKind: placeInput.resourceKind,
      });
    },

    projectPlace(projectInput) {
      const base = placeRecordForKey(projectInput.basePlaceKey);
      const projection = [...base.projection, projectInput.projection];
      const root = base.root;
      const key =
        base.monoPlaceCanonicalKey === undefined
          ? structuredPlaceKeyFor(root, projection)
          : draftPlaceKey({
              functionInstanceId: input.functionInstanceId,
              monoPlaceCanonicalKey: `${base.monoPlaceCanonicalKey}/${normalizePlaceProjectionKey(projectInput.projection)}`,
            });
      return internPlace({
        key,
        functionInstanceId: input.functionInstanceId,
        root,
        projection,
        ...(base.monoPlaceCanonicalKey === undefined
          ? {}
          : {
              monoPlaceCanonicalKey: `${base.monoPlaceCanonicalKey}/${normalizePlaceProjectionKey(projectInput.projection)}`,
            }),
        originKey: projectInput.originKey,
      });
    },

    draftPlace(key) {
      return toStructuredPlace(placeRecordForKey(key));
    },

    placeEntries() {
      const table = proofMirDeterministicTable({
        entries: [...places.values()],
        keyOf: (entry) => entry.key,
        lookupKeyOf: (key: ProofMirCanonicalKey) => key,
        normalizePayload: normalizeDraftPlaceRecord,
      });
      if (table.kind === "error") {
        return [];
      }
      return table.table.entries().map(toStructuredPlace);
    },

    startLoan(loanInput) {
      const key = draftLoanKey({
        functionInstanceId: input.functionInstanceId,
        mode: loanInput.mode,
        placeKey: loanInput.placeKey,
        scopeKey: loanInput.scopeKey,
        startOriginKey: loanInput.startOriginKey,
      });
      const existing = loans.get(key);
      if (existing !== undefined) {
        return key;
      }
      loans.set(key, {
        key,
        mode: loanInput.mode,
        placeKey: loanInput.placeKey,
        scopeKey: loanInput.scopeKey,
        startOriginKey: loanInput.startOriginKey,
      });
      return key;
    },

    endLoan(loanInput) {
      const loan = loans.get(loanInput.loanKey);
      if (loan === undefined) {
        throw new RangeError(`Unknown draft loan key: ${String(loanInput.loanKey)}.`);
      }
      loans.set(loanInput.loanKey, {
        ...loan,
        endOriginKey: loanInput.endOriginKey,
      });
    },

    draftLoan(key) {
      const loan = loans.get(key);
      if (loan === undefined) {
        throw new RangeError(`Unknown draft loan key: ${String(key)}.`);
      }
      return loan;
    },

    recordEdgeEffect(effect) {
      const normalized = normalizeDraftEdgeEffect(effect);
      const key = draftEdgeEffectKey(normalized);
      edgeEffects.set(key, normalized);
      return key;
    },

    edgeEffectEntries() {
      const table = proofMirDeterministicTable({
        entries: [...edgeEffects.values()],
        keyOf: (entry) => draftEdgeEffectKey(entry),
        lookupKeyOf: (key: ProofMirCanonicalKey) => key,
        normalizePayload: (entry) => JSON.stringify(normalizeDraftEdgeEffect(entry)),
      });
      if (table.kind === "error") {
        return [];
      }
      return table.table.entries();
    },

    privateStateGenerationKey(generationInput) {
      return draftPrivateStateGenerationKey({
        functionInstanceId: input.functionInstanceId,
        placeKey: generationInput.placeKey,
        generationOrdinal: generationInput.generationOrdinal,
      });
    },

    recordPrivateStateTransition(transitionInput) {
      const key = draftPrivateStateTransitionKey({
        functionInstanceId: input.functionInstanceId,
        transitionProofKey: transitionInput.transitionProofKey,
        originKey: transitionInput.originKey,
      });
      const record: DraftProofMirPrivateStateTransitionRecord = {
        key,
        transitionProofKey: transitionInput.transitionProofKey,
        originKey: transitionInput.originKey,
      };
      const existing = privateStateTransitions.get(key);
      if (
        existing !== undefined &&
        normalizeDraftPrivateStateTransitionRecord(existing) !==
          normalizeDraftPrivateStateTransitionRecord(record)
      ) {
        throw new RangeError(
          `Incompatible private-state transition records for key: ${String(key)}.`,
        );
      }
      privateStateTransitions.set(key, record);
      return key;
    },

    privateStateTransitionEntries() {
      const table = proofMirDeterministicTable({
        entries: [...privateStateTransitions.values()],
        keyOf: (entry) => entry.key,
        lookupKeyOf: (key: ProofMirCanonicalKey) => key,
        normalizePayload: normalizeDraftPrivateStateTransitionRecord,
      });
      if (table.kind === "error") {
        return [];
      }
      return table.table.entries();
    },
  };
}

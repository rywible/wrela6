import type {
  CallSiteRequirementId,
  HirPlatformContractEdgeId,
  PrivateStateTransitionId,
} from "../../hir/ids";
import type { LayoutTermUnit } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoCheckedType, MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { DraftProofMirCallArgument, DraftProofMirCallReceiver } from "./draft-call-operands";
import type { ProofMirDraftOperand } from "../lower/lowering-operands";
import type { DraftGraphEdgeState, DraftGraphTerminator } from "./draft-graph-builder";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type {
  DraftProofMirEdgeEffect,
  ProofMirLocalStorageKind,
} from "../domains/effects-resources";
import type { ProofMirValueRepresentation } from "../model/graph";
import type { PlatformPrimitiveId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirCallId } from "../ids";
import type {
  ProofMirOwnedCallId,
  ProofMirRuntimeCallId,
  ProofMirRuntimeOperationId,
} from "../ids";
import type { ProofMirCallTarget } from "../model/calls";
import type { DraftProofMirRuntimeEffect } from "./draft-runtime-call";
import type { ProofMirFactRole } from "../model/facts";
import type { DraftProofMirFactDependency, DraftProofMirFactKind } from "./draft-fact-operands";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermChild,
  ProofMirLayoutTermRoot,
} from "../model/layout-bindings";
import {
  proofMirDeterministicTable,
  type ProofMirDeterministicTable,
} from "../canonicalization/canonical-order";
import type { ProofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirPlaceProjection,
  DraftProofMirPlaceRoot,
  DraftProofMirResourceBoundarySet,
} from "../domains/effects-resources";
import { stableJson } from "../../shared/stable-json";
import type { ProofMirExitClosurePolicy } from "../model/graph";
import type { DraftProofMirGraphStatementSnapshot } from "./draft-statement";

export type DraftProofMirCanonicalTableAcceptResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface DraftProofMirCanonicalTable<Entry> {
  entries(): readonly Entry[];
  get(key: ProofMirCanonicalKey): Entry | undefined;
  has(key: ProofMirCanonicalKey): boolean;
  keyOf(entry: Entry): ProofMirCanonicalKey;
  accept(entry: Entry): DraftProofMirCanonicalTableAcceptResult;
}

export interface DraftProofMirOriginRecord {
  readonly key: ProofMirCanonicalKey;
  readonly ownerKey: string;
  readonly sourceOrigin?: string;
  readonly note?: string;
}

export type DraftProofMirExitClosurePolicy =
  | Exclude<ProofMirExitClosurePolicy, { readonly kind: "scopeExit" }>
  | {
      readonly kind: "scopeExit";
      readonly checkedScopeKeys: readonly ProofMirCanonicalKey[];
      readonly evaluateAfterEdgeEffects: true;
      readonly allowedTransfers: readonly DraftProofMirEdgeEffect[];
    };

export interface DraftProofMirGraphExitSnapshot {
  readonly key: ProofMirCanonicalKey;
  readonly role: string;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly exitKind: "ordinaryReturn" | "terminalReturn" | "panic" | "scopeBreak";
  readonly closure: DraftProofMirExitClosurePolicy;
  readonly crossedScopeKeys?: readonly ProofMirCanonicalKey[];
  readonly targetScopeKey?: ProofMirCanonicalKey;
}

export interface DraftProofMirGraphBlockParameterSnapshot {
  readonly valueKey: ProofMirCanonicalKey;
  readonly role: string;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirGraphBlockSnapshot {
  readonly key: ProofMirCanonicalKey;
  readonly role: string;
  readonly terminator?: DraftGraphTerminator;
  readonly statements: readonly DraftProofMirGraphStatementSnapshot[];
  readonly parameters?: readonly DraftProofMirGraphBlockParameterSnapshot[];
  readonly stateMerge?: DraftProofMirGraphBlockStateMergeSnapshot;
}

export interface DraftProofMirGraphBlockStateMergeSnapshot {
  readonly kind: "loopHeader";
  readonly loopScopeKey: ProofMirCanonicalKey;
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirGraphSnapshot {
  readonly blocks: readonly DraftProofMirGraphBlockSnapshot[];
  readonly edges: readonly DraftGraphEdgeState[];
  readonly exits: readonly DraftProofMirGraphExitSnapshot[];
}

export interface DraftProofMirBlockRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly sourceOrigin: string;
  readonly scopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly tag?: string;
}

export interface DraftProofMirFunctionDraft {
  readonly functionInstanceId: MonoInstanceId;
  readonly origins: DraftProofMirCanonicalTable<DraftProofMirOriginRecord>;
  readonly scopes: DraftProofMirCanonicalTable<DraftProofMirScopeRecord>;
  readonly blocks: DraftProofMirCanonicalTable<DraftProofMirBlockRecord>;
  readonly statements: DraftProofMirCanonicalTable<DraftProofMirStatementRecord>;
  readonly terminators: DraftProofMirCanonicalTable<DraftProofMirTerminatorRecord>;
  readonly controlEdges: DraftProofMirCanonicalTable<DraftProofMirControlEdgeRecord>;
  readonly exitEdges: DraftProofMirCanonicalTable<DraftProofMirExitEdgeRecord>;
  readonly values: DraftProofMirCanonicalTable<DraftProofMirValueRecord>;
  readonly locals: DraftProofMirCanonicalTable<DraftProofMirLocalRecord>;
  readonly places: DraftProofMirCanonicalTable<DraftProofMirPlaceRecord>;
  readonly calls: DraftProofMirCanonicalTable<DraftProofMirCallRecord>;
  readonly graphSnapshot?: DraftProofMirGraphSnapshot;
}

export interface DraftProofMirProgramDraft {
  readonly origins: DraftProofMirCanonicalTable<DraftProofMirOriginRecord>;
  readonly facts: DraftProofMirCanonicalTable<DraftProofMirFactRecord>;
  readonly layoutTerms: DraftProofMirCanonicalTable<DraftProofMirLayoutTermRecord>;
  readonly runtimeCalls: DraftProofMirCanonicalTable<DraftProofMirRuntimeCallRecord>;
  readonly privateStateGenerations: DraftProofMirCanonicalTable<DraftProofMirPrivateStateGenerationRecord>;
  readonly callGraph: DraftProofMirCanonicalTable<DraftProofMirCallGraphEdgeRecord>;
  readonly platformEdges: DraftProofMirCanonicalTable<DraftProofMirPlatformEdgeRecord>;
}

export interface DraftProofMirScopeRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly parentScopeKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirStatementRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirTerminatorRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirControlEdgeRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirExitEdgeRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirValueRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly role: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly type?: MonoCheckedType;
  readonly resourceKind?: ConcreteResourceKind;
  readonly representation?: ProofMirValueRepresentation;
}

export interface DraftProofMirLocalRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly name: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly scopeKey?: ProofMirCanonicalKey;
  readonly type?: MonoCheckedType;
  readonly resourceKind?: ConcreteResourceKind;
  readonly storage?: ProofMirLocalStorageKind;
  readonly backingPlaceKey?: ProofMirCanonicalKey;
}

export interface DraftProofMirPlaceRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly monoPlaceCanonicalKey: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly root?: DraftProofMirPlaceRoot;
  readonly projection?: readonly DraftProofMirPlaceProjection[];
  readonly type?: MonoCheckedType;
  readonly resourceKind?: ConcreteResourceKind;
}

export interface DraftProofMirCallRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly originKey: ProofMirCanonicalKey;
  readonly callId: ProofMirCallId;
  readonly target: ProofMirCallTarget;
  readonly receiver?: DraftProofMirCallReceiver;
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly requirements: readonly MonoInstantiatedProofId<CallSiteRequirementId>[];
  readonly result?: ProofMirDraftOperand;
}

export interface DraftProofMirFactRecord {
  readonly key: ProofMirCanonicalKey;
  readonly role: ProofMirFactRole | string;
  readonly kind: string;
  readonly authorityKey: string;
  readonly originKey: ProofMirCanonicalKey;
  readonly factKind?: DraftProofMirFactKind;
  readonly dependsOn?: readonly DraftProofMirFactDependency[];
}

export interface DraftProofMirLayoutTermRecord {
  readonly key: ProofMirCanonicalKey;
  readonly layoutReferenceKey: string;
  readonly termPath: string;
  readonly root?: ProofMirLayoutTermRoot;
  readonly childPath?: readonly ProofMirLayoutTermChild[];
  readonly unit?: LayoutTermUnit;
  readonly originKey?: ProofMirCanonicalKey;
}

export interface DraftProofMirRuntimeCallRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly callKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFactKeys: readonly ProofMirCanonicalKey[];
  readonly consumedCapabilityPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly producedCapabilityPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly effects: readonly DraftProofMirRuntimeEffect[];
}

export interface DraftProofMirPrivateStateGenerationRecord {
  readonly key: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly placeKey: ProofMirCanonicalKey;
  readonly generationOrdinal: number;
  readonly originKey: ProofMirCanonicalKey;
  readonly previousGenerationKey?: ProofMirCanonicalKey;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
}

export interface DraftProofMirCallGraphEdgeRecord {
  readonly key: ProofMirCanonicalKey;
  readonly callKey: ProofMirCanonicalKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly callId: ProofMirOwnedCallId;
  readonly target: ProofMirCallTarget;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftProofMirPlatformEdgeRecord {
  readonly key: ProofMirCanonicalKey;
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: PlatformPrimitiveId;
  readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
  readonly originKey: ProofMirCanonicalKey;
}

export function createDraftProofMirCanonicalTable<Entry>(input: {
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly normalizePayload: (entry: Entry) => string;
  readonly duplicateDetail?: (key: ProofMirCanonicalKey) => string;
}): DraftProofMirCanonicalTable<Entry> {
  let entries: Entry[] = [];

  function rebuildTable(nextEntries: readonly Entry[]): DraftProofMirCanonicalTableAcceptResult & {
    readonly table?: ProofMirDeterministicTable<ProofMirCanonicalKey, Entry>;
  } {
    const result = proofMirDeterministicTable({
      entries: nextEntries,
      keyOf: input.keyOf,
      lookupKeyOf: (key: ProofMirCanonicalKey) => key,
      normalizePayload: input.normalizePayload,
      duplicateDetail: input.duplicateDetail,
    });
    if (result.kind === "error") {
      return { kind: "error", diagnostics: result.diagnostics };
    }
    return { kind: "ok", table: result.table };
  }

  return {
    entries(): readonly Entry[] {
      return entries.slice();
    },
    get(key: ProofMirCanonicalKey): Entry | undefined {
      return entries.find((entry) => input.keyOf(entry) === key);
    },
    has(key: ProofMirCanonicalKey): boolean {
      return this.get(key) !== undefined;
    },
    keyOf(entry: Entry): ProofMirCanonicalKey {
      return input.keyOf(entry);
    },
    accept(entry: Entry): DraftProofMirCanonicalTableAcceptResult {
      const rebuild = rebuildTable([...entries, entry]);
      if (rebuild.kind === "error") {
        return rebuild;
      }
      entries = [...rebuild.table!.entries()];
      return { kind: "ok" };
    },
  };
}

function originRecordPayload(record: DraftProofMirOriginRecord): string {
  return [record.ownerKey, record.sourceOrigin ?? "", record.note ?? ""].join("|");
}

function blockRecordPayload(record: DraftProofMirBlockRecord): string {
  return `${record.role}:${record.sourceOrigin}`;
}

function scopeRecordPayload(record: DraftProofMirScopeRecord): string {
  return [record.role, record.parentScopeKey ?? "", String(record.originKey)].join("|");
}

function statementRecordPayload(record: DraftProofMirStatementRecord): string {
  return [String(record.blockKey), String(record.originKey)].join("|");
}

function terminatorRecordPayload(record: DraftProofMirTerminatorRecord): string {
  return [String(record.blockKey), String(record.originKey)].join("|");
}

function controlEdgeRecordPayload(record: DraftProofMirControlEdgeRecord): string {
  return [
    record.role,
    String(record.fromBlockKey),
    String(record.toBlockKey),
    String(record.originKey),
  ].join("|");
}

function exitEdgeRecordPayload(record: DraftProofMirExitEdgeRecord): string {
  return [record.role, String(record.fromBlockKey), String(record.originKey)].join("|");
}

function valueRecordPayload(record: DraftProofMirValueRecord): string {
  return [
    record.role,
    String(record.originKey),
    record.type === undefined ? "" : stableJson(record.type),
    record.resourceKind ?? "",
    record.representation === undefined ? "" : stableJson(record.representation),
  ].join("|");
}

function localRecordPayload(record: DraftProofMirLocalRecord): string {
  return [
    record.name,
    String(record.originKey),
    record.scopeKey === undefined ? "" : String(record.scopeKey),
    record.type === undefined ? "" : stableJson(record.type),
    record.resourceKind ?? "",
    record.storage ?? "",
    record.backingPlaceKey === undefined ? "" : String(record.backingPlaceKey),
  ].join("|");
}

function placeRecordPayload(record: DraftProofMirPlaceRecord): string {
  return [
    record.monoPlaceCanonicalKey,
    record.root === undefined ? "" : stableJson(record.root),
    record.projection === undefined ? "" : stableJson(record.projection),
    record.type === undefined ? "" : stableJson(record.type),
    record.resourceKind ?? "",
  ].join("|");
}

function draftOperandPayload(operand: ProofMirDraftOperand): string {
  switch (operand.kind) {
    case "value":
      return `value:${String(operand.value)}`;
    case "place":
      return `place:${String(operand.place)}`;
    case "valueAndPlace":
      return `valueAndPlace:${String(operand.value)}:${String(operand.place)}`;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function draftCallArgumentPayload(argument: DraftProofMirCallArgument): string {
  return [
    argument.mode,
    argument.parameterId === undefined ? "" : String(argument.parameterId),
    draftOperandPayload(argument.operand),
    String(argument.originKey),
  ].join(":");
}

function callRecordPayload(record: DraftProofMirCallRecord): string {
  return [
    String(record.originKey),
    stableJson(record.callId),
    stableJson(record.target),
    record.receiver === undefined ? "" : stableJson(record.receiver),
    record.arguments.map(draftCallArgumentPayload).join(","),
    record.requirements.map((requirement) => String(requirement)).join(","),
    record.result === undefined ? "" : draftOperandPayload(record.result),
  ].join("|");
}

function factRecordPayload(record: DraftProofMirFactRecord): string {
  return [record.role, record.kind, record.authorityKey, String(record.originKey)].join("|");
}

function layoutTermRecordPayload(record: DraftProofMirLayoutTermRecord): string {
  return [record.layoutReferenceKey, record.termPath].join("|");
}

function runtimeCallRecordPayload(record: DraftProofMirRuntimeCallRecord): string {
  return [
    String(record.callKey),
    String(record.originKey),
    String(record.runtimeCallId),
    String(record.runtimeId),
    String(record.callId.functionInstanceId),
    String(record.callId.callId),
    record.requiredFactKeys.map((factKey) => String(factKey)).join(","),
  ].join("|");
}

function privateStateGenerationRecordPayload(
  record: DraftProofMirPrivateStateGenerationRecord,
): string {
  return [String(record.placeKey), String(record.generationOrdinal), String(record.originKey)].join(
    "|",
  );
}

function callGraphEdgeRecordPayload(record: DraftProofMirCallGraphEdgeRecord): string {
  return [String(record.callKey), String(record.originKey), stableJson(record.target)].join("|");
}

function platformEdgeRecordPayload(record: DraftProofMirPlatformEdgeRecord): string {
  return [
    String(record.edgeId.instanceId),
    String(record.edgeId.hirId),
    String(record.originKey),
  ].join("|");
}

export function createEmptyDraftProofMirProgramDraft(): DraftProofMirProgramDraft {
  return {
    origins: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: originRecordPayload,
    }),
    facts: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: factRecordPayload,
    }),
    layoutTerms: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: layoutTermRecordPayload,
    }),
    runtimeCalls: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: runtimeCallRecordPayload,
    }),
    privateStateGenerations: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: privateStateGenerationRecordPayload,
    }),
    callGraph: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: callGraphEdgeRecordPayload,
    }),
    platformEdges: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: platformEdgeRecordPayload,
    }),
  };
}

export function createEmptyDraftProofMirFunctionDraft(
  functionInstanceId: MonoInstanceId,
): DraftProofMirFunctionDraft {
  return {
    functionInstanceId,
    origins: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: originRecordPayload,
    }),
    scopes: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: scopeRecordPayload,
    }),
    blocks: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: blockRecordPayload,
    }),
    statements: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: statementRecordPayload,
    }),
    terminators: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: terminatorRecordPayload,
    }),
    controlEdges: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: controlEdgeRecordPayload,
    }),
    exitEdges: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: exitEdgeRecordPayload,
    }),
    values: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: valueRecordPayload,
    }),
    locals: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: localRecordPayload,
    }),
    places: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: placeRecordPayload,
    }),
    calls: createDraftProofMirCanonicalTable({
      keyOf: (entry) => entry.key,
      normalizePayload: callRecordPayload,
    }),
  };
}

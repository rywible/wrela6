import type { CallSiteRequirementId, HirPlatformContractEdgeId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import { platformPrimitiveId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { type DraftProofMirFact } from "../domains/fact-recording";
import type {
  DraftProofMirCallArgument,
  DraftProofMirCallReceiver,
} from "../draft/draft-call-operands";
import {
  proofMirOwnedCallId,
  type ProofMirOwnedCallId,
  type ProofMirRuntimeCallId,
  type ProofMirRuntimeOperationId,
} from "../ids";
import type { DraftProofMirRuntimeEffect } from "../draft/draft-runtime-call";
import type { ProofMirCallTarget } from "../model/calls";
import type { ProofMirDraftOperand } from "./lowering-operands";
import type { ProofMirPlatformEdge } from "../model/program";
import type { ProofMirLoweringContext } from "./lowering-context";

export interface DraftRecordedProofMirCall {
  readonly callKey: ProofMirCanonicalKey;
  readonly callId: ProofMirOwnedCallId;
  readonly target: ProofMirCallTarget;
  readonly receiver?: DraftProofMirCallReceiver;
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly requirements: readonly MonoInstantiatedProofId<CallSiteRequirementId>[];
  readonly result?: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
  readonly statementKey: ProofMirCanonicalKey;
}

export interface DraftRecordedProofMirCallGraphEdge {
  readonly callId: ProofMirOwnedCallId;
  readonly target: ProofMirCallTarget;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftRecordedProofMirPlatformEdge {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: ReturnType<typeof platformPrimitiveId>;
  readonly abi: ProofMirPlatformEdge["abi"];
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftRecordedProofMirRuntimeCallContract {
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFactKeys: readonly ProofMirCanonicalKey[];
  readonly consumedCapabilityPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly producedCapabilityPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly effects: readonly DraftProofMirRuntimeEffect[];
}

export interface ProofMirCallLoweringRecorder {
  readonly callGraphEdges: readonly DraftRecordedProofMirCallGraphEdge[];
  readonly platformEdges: readonly DraftRecordedProofMirPlatformEdge[];
  readonly runtimeCalls: readonly DraftRecordedProofMirRuntimeCallContract[];
  readonly ensuredFacts: readonly DraftProofMirFact[];
  recordCallGraphEdge(entry: DraftRecordedProofMirCallGraphEdge): void;
  recordPlatformEdge(entry: DraftRecordedProofMirPlatformEdge): void;
  recordRuntimeCall(entry: DraftRecordedProofMirRuntimeCallContract): void;
  recordEnsuredFact(entry: DraftProofMirFact): void;
}

export function createCallLoweringRecorder(): ProofMirCallLoweringRecorder {
  const callGraphEdges: DraftRecordedProofMirCallGraphEdge[] = [];
  const platformEdges: DraftRecordedProofMirPlatformEdge[] = [];
  const runtimeCalls: DraftRecordedProofMirRuntimeCallContract[] = [];
  const ensuredFacts: DraftProofMirFact[] = [];

  return {
    get callGraphEdges() {
      return callGraphEdges.slice();
    },
    get platformEdges() {
      return platformEdges.slice();
    },
    get runtimeCalls() {
      return runtimeCalls.slice();
    },
    get ensuredFacts() {
      return ensuredFacts.slice();
    },
    recordCallGraphEdge(entry) {
      callGraphEdges.push(entry);
    },
    recordPlatformEdge(entry) {
      platformEdges.push(entry);
    },
    recordRuntimeCall(entry) {
      runtimeCalls.push(entry);
    },
    recordEnsuredFact(entry) {
      ensuredFacts.push(entry);
    },
  };
}

export function recordedCallFromFunctionDraft(input: {
  readonly context: ProofMirLoweringContext;
  readonly callKey?: ProofMirCanonicalKey;
  readonly blockKey?: ProofMirCanonicalKey;
}): DraftRecordedProofMirCall | undefined {
  const callEntries = input.context.graph.functionDraft().calls.entries();
  const callRecord =
    input.callKey === undefined
      ? callEntries[callEntries.length - 1]
      : callEntries.find((entry) => entry.key === input.callKey);
  if (callRecord === undefined) {
    return undefined;
  }

  let statementKey = callRecord.key;
  if (input.blockKey !== undefined) {
    const snapshot = input.context.graph.exportGraphSnapshot();
    const block = snapshot.blocks.find((candidate) => candidate.key === input.blockKey);
    const matchedStatement = block?.statements.find(
      (statement) => statement.kind.kind === "call" && statement.kind.callKey === callRecord.key,
    );
    if (matchedStatement !== undefined) {
      statementKey = matchedStatement.statementKey;
    }
  }

  return {
    callKey: callRecord.key,
    callId: proofMirOwnedCallId(callRecord.functionInstanceId, callRecord.callId),
    target: callRecord.target,
    ...(callRecord.receiver === undefined ? {} : { receiver: callRecord.receiver }),
    arguments: callRecord.arguments,
    requirements: callRecord.requirements,
    ...(callRecord.result === undefined ? {} : { result: callRecord.result }),
    originKey: callRecord.originKey,
    statementKey,
  };
}

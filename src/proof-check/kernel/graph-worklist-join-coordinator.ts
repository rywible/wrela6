import type { ProofMirBlockId, ProofMirControlEdgeId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckTransitionId } from "../ids";
import {
  attachCounterexampleToDiagnostic,
  proofCheckBlockKey,
  proofCheckPathFrameKey,
  type ProofCheckTransitionWitness,
} from "./counterexample-builder";
import { DEFAULT_VARIANT_KEY, type GraphWorklistItem } from "./graph-worklist-cfg";
import { computeProofCheckCoreMeet } from "./graph-worklist-meet";
import { enqueueFirstBlockProgramPoint } from "./graph-worklist-program-point-advance";
import type { ProofCheckFunctionRegistryArtifactsMutable } from "./registry/registry-effects";
import {
  applyTransitionRegistryEffects,
  blockLabelFor,
  divergentJoinDiagnostic,
  joinOwnerKey,
  joinRootCauseKey,
  originKeyFor,
  sortIncomingEdgeIds,
} from "./graph-worklist-helpers";
import type {
  ProofCheckGraphWorklistInput,
  ProofCheckJoinPolicyHooks,
  ProofCheckSuppressionCandidate,
} from "./graph-worklist-types";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckState } from "./state";
import {
  applyProofCheckTransitionResult,
  createProofCheckPacketStage,
  discardStagedPacketEntriesForStateKey,
  type ProofCheckProgramPoint,
  type ProofCheckTransition,
} from "./transition-api";

export interface JoinPredecessorCandidate {
  readonly edgeId: ProofMirControlEdgeId;
  readonly state: ProofCheckState;
  readonly stateKey: string;
  readonly pathFrameKey: string;
}

export function createJoinCoordinator(context: {
  readonly input: ProofCheckGraphWorklistInput;
  readonly registryArtifacts: ProofCheckFunctionRegistryArtifactsMutable;
  readonly functionGraph: ProofMirFunction;
  readonly joinPolicyHooks: ProofCheckJoinPolicyHooks;
  readonly staged: ReturnType<typeof createProofCheckPacketStage>;
  readonly witnesses: Map<string, ProofCheckTransitionWitness>;
  readonly acceptedEntryStates: Map<string, string>;
  readonly joinSlots: Map<string, Map<string, JoinPredecessorCandidate>>;
  readonly diagnostics: ProofCheckDiagnostic[];
  readonly suppressionCandidates: ProofCheckSuppressionCandidate[];
  readonly failedJoinBlocks: Set<string>;
  readonly worklist: GraphWorklistItem[];
  readonly queuedKeys: Set<string>;
  readonly allocateTransitionId: () => ProofCheckTransitionId;
  readonly acceptBlockState: (blockId: ProofMirBlockId, state: ProofCheckState) => boolean;
}): {
  readonly processMerge: (blockId: ProofMirBlockId) => boolean;
  readonly recordJoinPredecessor: (input: {
    readonly toBlockId: ProofMirBlockId;
    readonly edgeId: ProofMirControlEdgeId;
    readonly state: ProofCheckState;
    readonly pathFrameKey: string;
  }) => void;
} {
  const {
    input,
    registryArtifacts,
    functionGraph,
    joinPolicyHooks,
    staged,
    witnesses,
    acceptedEntryStates,
    joinSlots,
    diagnostics,
    suppressionCandidates,
    failedJoinBlocks,
    worklist,
    queuedKeys,
    allocateTransitionId,
    acceptBlockState,
  } = context;

  const processMerge = (blockId: ProofMirBlockId): boolean => {
    const joinKey = `${String(blockId)}:${DEFAULT_VARIANT_KEY}`;
    if (failedJoinBlocks.has(joinKey)) {
      return false;
    }

    const block = functionGraph.blocks.get(blockId);
    if (block === undefined) {
      return false;
    }

    const incomingEdgeIds = sortIncomingEdgeIds(block.incomingEdges).filter((edgeId) => {
      const edge = functionGraph.edges.get(edgeId);
      return edge !== undefined && edge.exit === undefined;
    });
    if (incomingEdgeIds.length <= 1) {
      return false;
    }

    const slot = joinSlots.get(joinKey) ?? new Map<string, JoinPredecessorCandidate>();
    joinSlots.set(joinKey, slot);

    for (const edgeId of incomingEdgeIds) {
      const edgeKey = String(edgeId);
      if (!slot.has(edgeKey)) {
        return false;
      }
    }

    const candidates = incomingEdgeIds.map((edgeId) => slot.get(String(edgeId))!);
    const incomingStates = candidates.map((candidate) => candidate.state);
    const meet = computeProofCheckCoreMeet(incomingStates);
    if (meet === undefined) {
      return false;
    }

    if (meet.kind === "failed") {
      const rootCauseKey = joinRootCauseKey({
        functionInstanceId: input.functionInstanceId,
        blockId,
        blockLabels: input.blockLabels,
      });
      failedJoinBlocks.add(joinKey);
      const stableDetail = `divergent-components:${meet.failedComponentKeys.join(",")}`;
      const joinDiagnostic = divergentJoinDiagnostic({
        functionInstanceId: input.functionInstanceId,
        blockId,
        blockLabels: input.blockLabels,
        failedComponentKeys: meet.failedComponentKeys,
        stableDetail,
      });
      const joinPathFrameKey = proofCheckPathFrameKey({
        functionInstanceId: input.functionInstanceId,
        programPointKey: joinOwnerKey({ functionInstanceId: input.functionInstanceId, blockId }),
        stateKey: proofCheckStateKey(incomingStates[0]!),
      });
      const witness: ProofCheckTransitionWitness = {
        pathFrameKey: joinPathFrameKey,
        functionInstanceId: input.functionInstanceId,
        blockId,
        blockKey: proofCheckBlockKey({
          functionInstanceId: input.functionInstanceId,
          blockId,
          blockLabel: blockLabelFor(input.blockLabels, blockId),
        }),
        location: {
          kind: block.stateMerge?.kind === "loopHeader" ? "loopHeader" : "join",
          functionInstanceId: input.functionInstanceId,
          blockId,
        },
        originKey: originKeyFor(block.origin),
        inputState: incomingStates[0]!,
        outputState: incomingStates[0]!,
        failedComponentKeys: [...meet.failedComponentKeys],
        predecessorPathFrameKey: candidates[0]?.pathFrameKey,
      };
      witnesses.set(joinPathFrameKey, witness);
      diagnostics.push(
        attachCounterexampleToDiagnostic({
          diagnostic: joinDiagnostic,
          witnesses,
          terminalPathFrameKey: joinPathFrameKey,
        }),
      );
      suppressionCandidates.push({
        rootCauseKey,
        suppressedRootCauseKey: rootCauseKey,
      });
      return false;
    }

    let acceptedState = meet.state;
    const mergeKind = block.stateMerge?.kind === "loopHeader" ? "loopHeader" : "join";
    const mergeTransitionId = allocateTransitionId();
    if (meet.kind === "coreMeet") {
      const policyResult = joinPolicyHooks.resolveNonExactJoin?.({
        functionInstanceId: input.functionInstanceId,
        blockId,
        incomingStates,
        coreMeetState: meet.state,
        transitionId: mergeTransitionId,
      });
      if (policyResult?.kind === "reject") {
        failedJoinBlocks.add(joinKey);
        diagnostics.push(...policyResult.diagnostics);
        return false;
      }
      if (policyResult?.kind === "accept") {
        acceptedState = policyResult.state;
      }
    }

    const mergeLocation: ProofCheckProgramPoint = {
      kind: mergeKind,
      functionInstanceId: input.functionInstanceId,
      blockId,
    };

    let mergeTransfer: ReturnType<NonNullable<typeof input.registry.join>> | undefined;
    const mergeOperation =
      mergeKind === "loopHeader"
        ? ({ kind: "loopHeader", blockId } as const)
        : ({ kind: "join", blockId } as const);
    const mergeTransition: ProofCheckTransition = {
      transitionId: mergeTransitionId,
      functionInstanceId: input.functionInstanceId,
      location: mergeLocation,
      inputState: acceptedState,
      operation: mergeOperation,
    };
    if (mergeKind === "loopHeader") {
      mergeTransfer = input.registry.loopHeader?.({
        transition: mergeTransition,
        operation: { kind: "loopHeader", blockId },
      });
    } else {
      mergeTransfer = input.registry.join?.({
        transition: mergeTransition,
        operation: { kind: "join", blockId },
      });
    }

    let mergeOutputState = acceptedState;
    if (mergeTransfer !== undefined) {
      if (mergeTransfer.kind === "error") {
        failedJoinBlocks.add(joinKey);
        diagnostics.push(...mergeTransfer.diagnostics);
        return false;
      }
      const mergeApplication = applyProofCheckTransitionResult({
        state: acceptedState,
        staged,
        transition: mergeTransition,
        transfer: mergeTransfer,
      });
      if (mergeApplication.kind === "error") {
        failedJoinBlocks.add(joinKey);
        diagnostics.push(...mergeApplication.diagnostics);
        return false;
      }
      applyTransitionRegistryEffects({
        registryAccumulator: input.registryAccumulator,
        registryArtifacts,
        functionInstanceId: input.functionInstanceId,
        transfer: mergeTransfer,
      });
      mergeOutputState = mergeApplication.state;
    }

    const acceptedStateKey = proofCheckStateKey(mergeOutputState);
    const previousStateKey = acceptedEntryStates.get(joinKey);
    if (previousStateKey !== undefined && previousStateKey !== acceptedStateKey) {
      discardStagedPacketEntriesForStateKey({
        staged,
        stateKey: previousStateKey,
      });
    }
    if (previousStateKey === acceptedStateKey) {
      return true;
    }
    acceptedEntryStates.set(joinKey, acceptedStateKey);
    if (!acceptBlockState(blockId, mergeOutputState)) {
      return false;
    }

    enqueueFirstBlockProgramPoint(
      worklist,
      queuedKeys,
      input.functionInstanceId,
      blockId,
      block,
      mergeOutputState,
    );

    return true;
  };

  const recordJoinPredecessor = (recordInput: {
    readonly toBlockId: ProofMirBlockId;
    readonly edgeId: ProofMirControlEdgeId;
    readonly state: ProofCheckState;
    readonly pathFrameKey: string;
  }): void => {
    const joinKey = `${String(recordInput.toBlockId)}:${DEFAULT_VARIANT_KEY}`;
    const slot = joinSlots.get(joinKey) ?? new Map<string, JoinPredecessorCandidate>();
    slot.set(String(recordInput.edgeId), {
      edgeId: recordInput.edgeId,
      state: recordInput.state,
      stateKey: proofCheckStateKey(recordInput.state),
      pathFrameKey: recordInput.pathFrameKey,
    });
    joinSlots.set(joinKey, slot);
    processMerge(recordInput.toBlockId);
  };

  return { processMerge, recordJoinPredecessor };
}

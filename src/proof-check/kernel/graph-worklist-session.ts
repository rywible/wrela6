import type { ProofMirBlockId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import { sortProofCheckDiagnostics, type ProofCheckDiagnostic } from "../diagnostics";
import { proofCheckTransitionId } from "../ids";
import type { CheckedBlockStateCertificate } from "../model/certificates";
import { createProofCheckCertificateRegistry } from "./certificate-registry";
import {
  createProofCheckFunctionRegistryArtifacts,
  finalizeProofCheckFunctionRegistryArtifacts,
} from "./registry/registry-effects";
import type { ProofCheckTransitionWitness } from "./counterexample-builder";
import { recordAcceptedBlockState } from "./graph-worklist-accept";
import {
  DEFAULT_VARIANT_KEY,
  enqueueGraphWorklistItem,
  graphWorklistSortKey,
  sortGraphWorklist,
  type GraphWorklistItem,
} from "./graph-worklist-cfg";
import { joinRootCauseKey, sortOutgoingEdgeIds } from "./graph-worklist-helpers";
import {
  createJoinCoordinator,
  type JoinPredecessorCandidate,
} from "./graph-worklist-join-coordinator";
import { enqueueFirstBlockProgramPoint } from "./graph-worklist-program-point-advance";
import { runTransition } from "./graph-worklist-transition";
import type {
  ProofCheckDiagnosticSuppressionHooks,
  ProofCheckGraphWorklistInput,
  ProofCheckGraphWorklistResult,
  ProofCheckJoinPolicyHooks,
  ProofCheckSuppressionCandidate,
} from "./graph-worklist-types";
import type { ProofCheckResourceLimitHooks } from "./resource-limits";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckState } from "./state";
import {
  acceptProofCheckBlockEntryState,
  createProofCheckPacketStage,
  proofCheckProgramPointKey,
} from "./transition-api";

export function runProofCheckGraphWorklistBody(context: {
  readonly input: ProofCheckGraphWorklistInput;
  readonly functionGraph: ProofMirFunction;
  readonly resourceLimitHooks: ProofCheckResourceLimitHooks;
  readonly joinPolicyHooks: ProofCheckJoinPolicyHooks;
  readonly suppressionHooks: ProofCheckDiagnosticSuppressionHooks;
}): ProofCheckGraphWorklistResult {
  const { input, functionGraph, resourceLimitHooks, joinPolicyHooks, suppressionHooks } = context;

  const certificateRegistry = input.certificateRegistry ?? createProofCheckCertificateRegistry();
  const coreCertificates = input.coreCertificates ?? [];
  const coreCertificatesBaselineCount = coreCertificates.length;
  const registryArtifacts = input.registryArtifacts ?? createProofCheckFunctionRegistryArtifacts();

  const staged = createProofCheckPacketStage();
  const witnesses = new Map<string, ProofCheckTransitionWitness>();
  const acceptedEntryStates = new Map<string, string>();
  const joinSlots = new Map<string, Map<string, JoinPredecessorCandidate>>();
  const diagnostics: ProofCheckDiagnostic[] = [];
  const suppressionCandidates: ProofCheckSuppressionCandidate[] = [];
  const acceptedBlockStates: CheckedBlockStateCertificate[] = [];
  const failedJoinBlocks = new Set<string>();

  const worklist: GraphWorklistItem[] = [];
  const queuedKeys = new Set<string>();

  let nextTransitionId = 1;
  const allocateTransitionId = (): ReturnType<typeof proofCheckTransitionId> => {
    const transitionId = proofCheckTransitionId(nextTransitionId);
    nextTransitionId += 1;
    return transitionId;
  };

  enqueueGraphWorklistItem(worklist, queuedKeys, {
    sortKey: graphWorklistSortKey({
      kind: "functionEntry",
      functionInstanceId: input.functionInstanceId,
    }),
    location: {
      kind: "functionEntry",
      functionInstanceId: input.functionInstanceId,
    },
    inputState: input.entryState,
  });

  const acceptBlockState = (blockId: ProofMirBlockId, state: ProofCheckState): boolean =>
    recordAcceptedBlockState({
      staged,
      acceptedBlockStates,
      coreCertificates,
      certificateRegistry,
      resourceLimitHooks,
      diagnostics,
      functionInstanceId: input.functionInstanceId,
      blockId,
      state,
      stagedPacketEntryCount: staged.stagedEntries().length,
      counterexampleFrameCount: witnesses.size,
    });

  const { processMerge, recordJoinPredecessor } = createJoinCoordinator({
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
  });

  while (worklist.length > 0) {
    const batch = sortGraphWorklist(worklist);
    worklist.length = 0;
    queuedKeys.clear();

    for (const item of batch) {
      const location = item.location;

      if (location.kind === "join" || location.kind === "loopHeader") {
        processMerge(location.blockId);
        continue;
      }

      if (location.kind === "functionEntry") {
        const entryResult = runTransition({
          mir: input.mir,
          functionGraph,
          functionInstanceId: input.functionInstanceId,
          blockLabels: input.blockLabels,
          registry: input.registry,
          resourceLimitHooks,
          location,
          inputState: item.inputState,
          witnesses,
          staged,
          allocateTransitionId,
          registryAccumulator: input.registryAccumulator,
          registryArtifacts,
          ...(item.predecessorPathFrameKey !== undefined
            ? { predecessorPathFrameKey: item.predecessorPathFrameKey }
            : {}),
        });
        if (entryResult.kind === "error") {
          diagnostics.push(...entryResult.diagnostics);
          continue;
        }

        const entryBlockId = functionGraph.entryBlockId;
        const entryBlock = functionGraph.blocks.get(entryBlockId);
        if (entryBlock === undefined) {
          continue;
        }

        const entryKey = `${String(entryBlockId)}:${DEFAULT_VARIANT_KEY}`;
        acceptedEntryStates.set(entryKey, proofCheckStateKey(entryResult.outputState));
        if (!acceptBlockState(entryBlockId, entryResult.outputState)) {
          continue;
        }

        enqueueFirstBlockProgramPoint(
          worklist,
          queuedKeys,
          input.functionInstanceId,
          entryBlockId,
          entryBlock,
          entryResult.outputState,
          entryResult.pathFrameKey,
        );
        continue;
      }

      if (location.kind === "statement") {
        const block = functionGraph.blocks.get(location.blockId);
        if (block === undefined) {
          continue;
        }

        const statementIndex = block.statements.findIndex(
          (statement) => statement.statementId === location.statementId,
        );
        if (statementIndex < 0) {
          continue;
        }

        const statementResult = runTransition({
          mir: input.mir,
          functionGraph,
          functionInstanceId: input.functionInstanceId,
          blockLabels: input.blockLabels,
          registry: input.registry,
          resourceLimitHooks,
          location,
          inputState: item.inputState,
          witnesses,
          staged,
          allocateTransitionId,
          registryAccumulator: input.registryAccumulator,
          registryArtifacts,
          ...(item.predecessorPathFrameKey !== undefined
            ? { predecessorPathFrameKey: item.predecessorPathFrameKey }
            : {}),
        });
        if (statementResult.kind === "error") {
          diagnostics.push(...statementResult.diagnostics);
          continue;
        }

        const nextStatement = block.statements[statementIndex + 1];
        if (nextStatement !== undefined) {
          enqueueGraphWorklistItem(worklist, queuedKeys, {
            sortKey: graphWorklistSortKey({
              kind: "statement",
              functionInstanceId: input.functionInstanceId,
              blockId: location.blockId,
              statementId: nextStatement.statementId,
            }),
            location: {
              kind: "statement",
              functionInstanceId: input.functionInstanceId,
              blockId: location.blockId,
              statementId: nextStatement.statementId,
            },
            inputState: statementResult.outputState,
            predecessorPathFrameKey: statementResult.pathFrameKey,
          });
        } else {
          enqueueGraphWorklistItem(worklist, queuedKeys, {
            sortKey: graphWorklistSortKey({
              kind: "terminator",
              functionInstanceId: input.functionInstanceId,
              blockId: location.blockId,
              terminatorId: block.terminator.terminatorId,
            }),
            location: {
              kind: "terminator",
              functionInstanceId: input.functionInstanceId,
              blockId: location.blockId,
              terminatorId: block.terminator.terminatorId,
            },
            inputState: statementResult.outputState,
            predecessorPathFrameKey: statementResult.pathFrameKey,
          });
        }
        continue;
      }

      if (location.kind === "terminator") {
        const block = functionGraph.blocks.get(location.blockId);
        if (block === undefined) {
          continue;
        }

        const terminatorResult = runTransition({
          mir: input.mir,
          functionGraph,
          functionInstanceId: input.functionInstanceId,
          blockLabels: input.blockLabels,
          registry: input.registry,
          resourceLimitHooks,
          location,
          inputState: item.inputState,
          witnesses,
          staged,
          allocateTransitionId,
          registryAccumulator: input.registryAccumulator,
          registryArtifacts,
          ...(item.predecessorPathFrameKey !== undefined
            ? { predecessorPathFrameKey: item.predecessorPathFrameKey }
            : {}),
        });
        if (terminatorResult.kind === "error") {
          diagnostics.push(...terminatorResult.diagnostics);
          continue;
        }

        if (block.terminator.outgoingEdges.length === 0) {
          acceptProofCheckBlockEntryState({ staged, blockId: location.blockId });
        }

        for (const edgeId of sortOutgoingEdgeIds(block.terminator.outgoingEdges)) {
          enqueueGraphWorklistItem(worklist, queuedKeys, {
            sortKey: graphWorklistSortKey({
              kind: "edge",
              functionInstanceId: input.functionInstanceId,
              edgeId,
            }),
            location: {
              kind: "edge",
              functionInstanceId: input.functionInstanceId,
              edgeId,
            },
            inputState: terminatorResult.outputState,
            predecessorPathFrameKey: terminatorResult.pathFrameKey,
          });
        }
        continue;
      }

      if (location.kind === "edge") {
        const edge = functionGraph.edges.get(location.edgeId);
        if (edge === undefined || edge.toBlockId === undefined) {
          continue;
        }

        const edgeResult = runTransition({
          mir: input.mir,
          functionGraph,
          functionInstanceId: input.functionInstanceId,
          blockLabels: input.blockLabels,
          registry: input.registry,
          resourceLimitHooks,
          location,
          inputState: item.inputState,
          witnesses,
          staged,
          allocateTransitionId,
          registryAccumulator: input.registryAccumulator,
          registryArtifacts,
          ...(item.predecessorPathFrameKey !== undefined
            ? { predecessorPathFrameKey: item.predecessorPathFrameKey }
            : {}),
        });
        if (edgeResult.kind === "error") {
          diagnostics.push(...edgeResult.diagnostics);
          continue;
        }

        acceptProofCheckBlockEntryState({ staged, blockId: edge.fromBlockId });

        if (edge.exit !== undefined) {
          continue;
        }

        const targetBlock = functionGraph.blocks.get(edge.toBlockId);
        if (targetBlock === undefined) {
          continue;
        }

        const joinKey = `${String(edge.toBlockId)}:${DEFAULT_VARIANT_KEY}`;
        if (failedJoinBlocks.has(joinKey)) {
          suppressionCandidates.push({
            rootCauseKey: joinRootCauseKey({
              functionInstanceId: input.functionInstanceId,
              blockId: edge.toBlockId,
              blockLabels: input.blockLabels,
            }),
            suppressedRootCauseKey: proofCheckProgramPointKey(location),
          });
          continue;
        }

        if (targetBlock.incomingEdges.length > 1) {
          recordJoinPredecessor({
            toBlockId: edge.toBlockId,
            edgeId: location.edgeId,
            state: edgeResult.outputState,
            pathFrameKey: edgeResult.pathFrameKey,
          });
          continue;
        }

        const acceptedKey = proofCheckStateKey(edgeResult.outputState);
        const previousAcceptedKey = acceptedEntryStates.get(joinKey);
        if (previousAcceptedKey === acceptedKey) {
          continue;
        }
        acceptedEntryStates.set(joinKey, acceptedKey);
        if (!acceptBlockState(edge.toBlockId, edgeResult.outputState)) {
          continue;
        }

        enqueueFirstBlockProgramPoint(
          worklist,
          queuedKeys,
          input.functionInstanceId,
          edge.toBlockId,
          targetBlock,
          edgeResult.outputState,
          edgeResult.pathFrameKey,
        );
      }
    }
  }

  const sortedDiagnostics = sortProofCheckDiagnostics(diagnostics);
  const publicDiagnostics =
    suppressionHooks.filterPublicDiagnostics?.({
      diagnostics: sortedDiagnostics,
      suppressionCandidates,
    }) ?? sortedDiagnostics;

  const kind = publicDiagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "error"
    : "ok";

  for (const certificate of coreCertificates.slice(coreCertificatesBaselineCount)) {
    const duplicate = registryArtifacts.coreCertificates.some(
      (entry) => String(entry.certificateId) === String(certificate.certificateId),
    );
    if (!duplicate) {
      registryArtifacts.coreCertificates.push(certificate);
    }
  }

  return {
    kind,
    acceptedBlockStates,
    summaries: [],
    packetEntries: staged.entries(),
    explicitOrigins: staged.explicitOrigins(),
    diagnostics: publicDiagnostics,
    registryArtifacts: finalizeProofCheckFunctionRegistryArtifacts(registryArtifacts),
    debug: { suppressionCandidates },
  };
}

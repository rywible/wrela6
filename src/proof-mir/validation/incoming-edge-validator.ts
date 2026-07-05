import type { MonoInstanceId } from "../../mono/ids";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type { ProofMirBlock, ProofMirControlEdge, ProofMirFunction } from "../model/graph";
import type { ProofMirControlEdgeId } from "../ids";

export function deriveProofMirPredecessorSets(
  functionGraph: ProofMirFunction,
): Map<ProofMirBlock["blockId"], Set<ProofMirControlEdgeId>> {
  const result = new Map<ProofMirBlock["blockId"], Set<ProofMirControlEdgeId>>();
  for (const block of functionGraph.blocks.entries()) {
    result.set(block.blockId, new Set());
  }

  for (const block of functionGraph.blocks.entries()) {
    for (const edgeId of block.terminator.outgoingEdges) {
      const edge = functionGraph.edges.get(edgeId);
      if (edge === undefined || edge.toBlockId === undefined) {
        continue;
      }
      const targetEdges = result.get(edge.toBlockId);
      if (targetEdges === undefined) {
        continue;
      }
      targetEdges.add(edgeId);
    }
  }

  return result;
}

export function validateStoredIncomingEdges(
  functionGraph: ProofMirFunction,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const derivedPredecessors = deriveProofMirPredecessorSets(functionGraph);
  for (const block of functionGraph.blocks.entries()) {
    const mismatch = incomingEdgeMismatchDetail(block, derivedPredecessors);
    if (mismatch === undefined) {
      continue;
    }
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INCOMING_EDGES_MISMATCH",
      message:
        "Proof MIR block stored incoming edges do not match predecessors derived from control edges.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: mismatch,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(block.blockId),
    });
  }
}

export function validateControlEdgeOutgoingReference(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  const fromBlock = functionGraph.blocks.get(edge.fromBlockId);
  if (fromBlock === undefined) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_CFG",
      message: "Proof MIR control edge references a missing source block.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `missing-source-block:${String(edge.fromBlockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(edge.edgeId),
    });
    return;
  }
  if (fromBlock.terminator.outgoingEdges.includes(edge.edgeId)) {
    return;
  }
  recordDiagnostic(diagnostics, {
    code: "PROOF_MIR_DISCONNECTED_CONTROL_EDGE",
    message: "Proof MIR control edge is not listed in its source block terminator outgoing edges.",
    ownerKey,
    rootCauseKey: "cfg",
    stableDetail: `orphan-edge:${String(edge.edgeId)}:${String(edge.fromBlockId)}`,
    functionInstanceId: functionGraph.functionInstanceId,
    nodeDetail: String(edge.edgeId),
  });
}

export function validateControlEdgeTarget(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
  ownerKey: string,
  diagnostics: ProofMirDiagnostic[],
): void {
  if (edge.toBlockId !== undefined && !functionGraph.blocks.has(edge.toBlockId)) {
    recordDiagnostic(diagnostics, {
      code: "PROOF_MIR_INVALID_CFG",
      message: "Proof MIR control edge references a missing destination block.",
      ownerKey,
      rootCauseKey: "cfg",
      stableDetail: `missing-edge-target:${String(edge.edgeId)}:${String(edge.toBlockId)}`,
      functionInstanceId: functionGraph.functionInstanceId,
      nodeDetail: String(edge.edgeId),
    });
  }
}

function incomingEdgeMismatchDetail(
  block: ProofMirBlock,
  derivedPredecessors: ReadonlyMap<ProofMirBlock["blockId"], ReadonlySet<ProofMirControlEdgeId>>,
): string | undefined {
  const derived = sortControlEdgeIds([...(derivedPredecessors.get(block.blockId) ?? [])]);
  const storedUnique = sortControlEdgeIds([...new Set(block.incomingEdges)]);
  const duplicateStored = sortControlEdgeIds(duplicateControlEdgeIds(block.incomingEdges));
  const missing = derived.filter((edgeId) => !storedUnique.includes(edgeId));
  const extra = storedUnique.filter((edgeId) => !derived.includes(edgeId));

  if (missing.length === 0 && extra.length === 0 && duplicateStored.length === 0) {
    return undefined;
  }

  return `incoming-edges:${String(block.blockId)}:missing:${missing
    .map(String)
    .join(",")}:extra:${extra.map(String).join(",")}:duplicate:${duplicateStored
    .map(String)
    .join(",")}`;
}

function duplicateControlEdgeIds(
  edgeIds: readonly ProofMirControlEdgeId[],
): ProofMirControlEdgeId[] {
  const seen = new Set<ProofMirControlEdgeId>();
  const duplicates = new Set<ProofMirControlEdgeId>();
  for (const edgeId of edgeIds) {
    if (seen.has(edgeId)) {
      duplicates.add(edgeId);
      continue;
    }
    seen.add(edgeId);
  }
  return [...duplicates];
}

function sortControlEdgeIds(edgeIds: readonly ProofMirControlEdgeId[]): ProofMirControlEdgeId[] {
  return [...edgeIds].sort((left, right) => left - right);
}

function recordDiagnostic(
  diagnostics: ProofMirDiagnostic[],
  input: {
    readonly code: string;
    readonly message: string;
    readonly ownerKey: string;
    readonly rootCauseKey: string;
    readonly stableDetail: string;
    readonly functionInstanceId: MonoInstanceId;
    readonly nodeDetail?: string;
  },
): void {
  diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: input.code,
      message: input.message,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
      functionInstanceId: input.functionInstanceId,
      ...(input.nodeDetail === undefined ? {} : { nodeDetail: input.nodeDetail }),
    }),
  );
}

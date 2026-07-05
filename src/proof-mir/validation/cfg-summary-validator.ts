import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type { ProofMirBlock, ProofMirFunction } from "../model/graph";

export function countCriticalEdges(functionGraph: ProofMirFunction): number {
  let count = 0;
  for (const edge of functionGraph.edges.entries()) {
    if (edge.toBlockId === undefined) continue;
    const source = functionGraph.blocks.get(edge.fromBlockId);
    const target = functionGraph.blocks.get(edge.toBlockId);
    if (
      source !== undefined &&
      target !== undefined &&
      source.terminator.outgoingEdges.length > 1 &&
      target.incomingEdges.length > 1
    ) {
      count += 1;
    }
  }
  return count;
}

export function validateReducibility(input: {
  readonly functionGraph: ProofMirFunction;
  readonly ownerKey: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const intervals = depthFirstIntervals(input.functionGraph);
  const dominators = computeDominators(input.functionGraph);
  for (const edge of input.functionGraph.edges.entries()) {
    if (edge.toBlockId === undefined) continue;
    if (!isAncestorInterval(intervals, edge.toBlockId, edge.fromBlockId)) continue;
    if (dominators.get(edge.fromBlockId)?.has(edge.toBlockId)) continue;
    input.diagnostics.push(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_IRREDUCIBLE_CFG",
        message: "Proof MIR control-flow graph contains an irreducible retreating edge.",
        ownerKey: input.ownerKey,
        rootCauseKey: "cfg",
        stableDetail: `irreducible-edge:${String(edge.edgeId)}:${String(edge.fromBlockId)}:${String(edge.toBlockId)}`,
        functionInstanceId: input.functionGraph.functionInstanceId,
        nodeDetail: String(edge.edgeId),
      }),
    );
  }
}

type DepthFirstInterval = {
  readonly enter: number;
  readonly exit: number;
};

function depthFirstIntervals(
  functionGraph: ProofMirFunction,
): Map<ProofMirBlock["blockId"], DepthFirstInterval> {
  const intervals = new Map<ProofMirBlock["blockId"], { enter: number; exit?: number }>();
  let nextTick = 0;
  const visit = (blockId: ProofMirBlock["blockId"]): void => {
    if (intervals.has(blockId)) return;
    intervals.set(blockId, { enter: nextTick++ });
    const block = functionGraph.blocks.get(blockId);
    if (block !== undefined) {
      for (const edgeId of block.terminator.outgoingEdges) {
        const edge = functionGraph.edges.get(edgeId);
        if (edge?.toBlockId !== undefined) visit(edge.toBlockId);
      }
    }
    intervals.get(blockId)!.exit = nextTick++;
  };
  visit(functionGraph.entryBlockId);
  const completeIntervals = new Map<ProofMirBlock["blockId"], DepthFirstInterval>();
  for (const [blockId, interval] of intervals) {
    if (interval.exit !== undefined) {
      completeIntervals.set(blockId, { enter: interval.enter, exit: interval.exit });
    }
  }
  return completeIntervals;
}

function isAncestorInterval(
  intervals: ReadonlyMap<ProofMirBlock["blockId"], DepthFirstInterval>,
  possibleAncestor: ProofMirBlock["blockId"],
  possibleDescendant: ProofMirBlock["blockId"],
): boolean {
  const ancestor = intervals.get(possibleAncestor);
  const descendant = intervals.get(possibleDescendant);
  return (
    ancestor !== undefined &&
    descendant !== undefined &&
    ancestor.enter <= descendant.enter &&
    ancestor.exit >= descendant.exit
  );
}

function computeDominators(
  functionGraph: ProofMirFunction,
): Map<ProofMirBlock["blockId"], Set<ProofMirBlock["blockId"]>> {
  const blockIds = functionGraph.blocks.entries().map((block) => block.blockId);
  const allBlocks = new Set(blockIds);
  const dominators = new Map<ProofMirBlock["blockId"], Set<ProofMirBlock["blockId"]>>();
  for (const blockId of blockIds) {
    dominators.set(
      blockId,
      blockId === functionGraph.entryBlockId ? new Set([blockId]) : new Set(allBlocks),
    );
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of functionGraph.blocks.entries()) {
      if (block.blockId === functionGraph.entryBlockId) continue;
      const predecessors = block.incomingEdges
        .map((edgeId) => functionGraph.edges.get(edgeId)?.fromBlockId)
        .filter((blockId): blockId is ProofMirBlock["blockId"] => blockId !== undefined);
      const next = intersectDominators(
        predecessors.map((blockId) => dominators.get(blockId) ?? new Set()),
      );
      next.add(block.blockId);
      if (!setsEqual(dominators.get(block.blockId) ?? new Set(), next)) {
        dominators.set(block.blockId, next);
        changed = true;
      }
    }
  }
  return dominators;
}

function intersectDominators(
  sets: readonly Set<ProofMirBlock["blockId"]>[],
): Set<ProofMirBlock["blockId"]> {
  if (sets.length === 0) return new Set();
  const first = sets[0]!;
  const rest = sets.slice(1);
  const result = new Set(first);
  for (const value of first) {
    if (rest.some((set) => !set.has(value))) result.delete(value);
  }
  return result;
}

function setsEqual<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

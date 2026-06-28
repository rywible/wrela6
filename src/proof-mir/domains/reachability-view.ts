import type { MonoInstanceId } from "../../mono/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofMirOwnedCallId } from "../ids";
import type { ProofMirProgram } from "../model/program";

export interface ProofMirSourceCallEdge {
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly calleeFunctionInstanceId: MonoInstanceId;
  readonly callId: ProofMirOwnedCallId;
}

export interface ProofMirSourceCallGraph {
  readonly edges: readonly ProofMirSourceCallEdge[];
  readonly successors: ReadonlyMap<string, readonly MonoInstanceId[]>;
}

export interface ProofMirReachabilityView {
  readonly reachableFunctionIds: readonly MonoInstanceId[];
  readonly deadFunctionIds: readonly MonoInstanceId[];
  readonly sourceCallGraph: ProofMirSourceCallGraph;
  readonly sourceCallCycles: readonly (readonly MonoInstanceId[])[];
  readonly reachableFunctionOrder: readonly MonoInstanceId[];
  readonly reachablePlatformEdgeIds: ReadonlySet<string>;
}

function compareMonoInstanceIds(left: MonoInstanceId, right: MonoInstanceId): number {
  return compareCodeUnitStrings(String(left), String(right));
}

function sortMonoInstanceIds(values: Iterable<MonoInstanceId>): MonoInstanceId[] {
  return [...values].sort(compareMonoInstanceIds);
}

function reachableFunctionIds(mir: ProofMirProgram): MonoInstanceId[] {
  return sortMonoInstanceIds(
    mir.reachableFunctions.entries().map((entry) => entry.functionInstanceId),
  );
}

function deadFunctionIds(
  mir: ProofMirProgram,
  reachableFunctionInstanceIds: readonly MonoInstanceId[],
): MonoInstanceId[] {
  const reachable = new Set(reachableFunctionInstanceIds.map(String));
  return sortMonoInstanceIds(
    mir.functions
      .entries()
      .flatMap((functionGraph) =>
        reachable.has(String(functionGraph.functionInstanceId))
          ? []
          : [functionGraph.functionInstanceId],
      ),
  );
}

function sourceCallEdgesFromCallGraph(
  mir: ProofMirProgram,
  reachableFunctionInstanceIds: readonly MonoInstanceId[],
): ProofMirSourceCallEdge[] {
  const reachable = new Set(reachableFunctionInstanceIds.map(String));
  const edges: ProofMirSourceCallEdge[] = [];

  for (const callGraphEdge of mir.callGraph.entries()) {
    if (callGraphEdge.target.kind !== "sourceFunction") {
      continue;
    }
    const callerFunctionInstanceId = callGraphEdge.callId.functionInstanceId;
    const calleeFunctionInstanceId = callGraphEdge.target.functionInstanceId;
    if (!reachable.has(String(callerFunctionInstanceId))) {
      continue;
    }
    if (!reachable.has(String(calleeFunctionInstanceId))) {
      continue;
    }
    edges.push({
      callerFunctionInstanceId,
      calleeFunctionInstanceId,
      callId: callGraphEdge.callId,
    });
  }

  edges.sort((left, right) => {
    const callerCmp = compareMonoInstanceIds(
      left.callerFunctionInstanceId,
      right.callerFunctionInstanceId,
    );
    if (callerCmp !== 0) {
      return callerCmp;
    }
    const calleeCmp = compareMonoInstanceIds(
      left.calleeFunctionInstanceId,
      right.calleeFunctionInstanceId,
    );
    if (calleeCmp !== 0) {
      return calleeCmp;
    }
    return compareCodeUnitStrings(String(left.callId.callId), String(right.callId.callId));
  });

  return edges;
}

function buildSourceCallSuccessors(
  edges: readonly ProofMirSourceCallEdge[],
): Map<string, MonoInstanceId[]> {
  const successors = new Map<string, MonoInstanceId[]>();
  for (const edge of edges) {
    const callerKey = String(edge.callerFunctionInstanceId);
    const existing = successors.get(callerKey) ?? [];
    if (!existing.some((value) => String(value) === String(edge.calleeFunctionInstanceId))) {
      existing.push(edge.calleeFunctionInstanceId);
      existing.sort(compareMonoInstanceIds);
      successors.set(callerKey, existing);
    }
  }
  return successors;
}

function detectSourceCallCycles(
  functionInstanceIds: readonly MonoInstanceId[],
  successors: ReadonlyMap<string, readonly MonoInstanceId[]>,
): readonly (readonly MonoInstanceId[])[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: MonoInstanceId[][] = [];

  function visit(functionInstanceId: MonoInstanceId, path: MonoInstanceId[]): void {
    const key = String(functionInstanceId);
    if (visited.has(key)) {
      return;
    }
    if (visiting.has(key)) {
      const cycleStart = path.findIndex((entry) => String(entry) === key);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }

    visiting.add(key);
    const nextPath = [...path, functionInstanceId];
    for (const successor of successors.get(key) ?? []) {
      visit(successor, nextPath);
    }
    visiting.delete(key);
    visited.add(key);
  }

  for (const functionInstanceId of functionInstanceIds) {
    visit(functionInstanceId, []);
  }

  cycles.sort((left, right) =>
    compareCodeUnitStrings(left.map(String).join("->"), right.map(String).join("->")),
  );
  return cycles;
}

function topologicalReachableFunctionOrder(
  reachableFunctionInstanceIds: readonly MonoInstanceId[],
  successors: ReadonlyMap<string, readonly MonoInstanceId[]>,
): MonoInstanceId[] {
  const reachableSet = new Set(reachableFunctionInstanceIds.map(String));
  const indegree = new Map<string, number>();
  for (const functionInstanceId of reachableFunctionInstanceIds) {
    indegree.set(String(functionInstanceId), 0);
  }
  for (const functionInstanceId of reachableFunctionInstanceIds) {
    for (const successor of successors.get(String(functionInstanceId)) ?? []) {
      if (!reachableSet.has(String(successor))) {
        continue;
      }
      const successorKey = String(successor);
      indegree.set(successorKey, (indegree.get(successorKey) ?? 0) + 1);
    }
  }

  const ready = sortMonoInstanceIds(
    reachableFunctionInstanceIds.filter(
      (functionInstanceId) => indegree.get(String(functionInstanceId)) === 0,
    ),
  );
  const order: MonoInstanceId[] = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) {
      break;
    }
    order.push(next);
    for (const successor of successors.get(String(next)) ?? []) {
      if (!reachableSet.has(String(successor))) {
        continue;
      }
      const successorKey = String(successor);
      const nextIndegree = (indegree.get(successorKey) ?? 0) - 1;
      indegree.set(successorKey, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(successor);
        ready.sort(compareMonoInstanceIds);
      }
    }
  }

  const callerFirstTopologicalOrder =
    order.length === reachableFunctionInstanceIds.length
      ? order
      : (() => {
          const orderedKeys = new Set(order.map(String));
          const remaining = sortMonoInstanceIds(
            reachableFunctionInstanceIds.filter(
              (functionInstanceId) => !orderedKeys.has(String(functionInstanceId)),
            ),
          );
          return [...order, ...remaining];
        })();

  return [...callerFirstTopologicalOrder].reverse();
}

function reachablePlatformEdgeIds(mir: ProofMirProgram): ReadonlySet<string> {
  const edgeIds = new Set<string>();
  for (const callEdge of mir.callGraph.entries()) {
    if (callEdge.target.kind !== "certifiedPlatform") {
      continue;
    }
    if (!mir.reachableFunctions.has(callEdge.callId.functionInstanceId)) {
      continue;
    }
    edgeIds.add(String(callEdge.target.edgeId));
  }
  return edgeIds;
}

export function buildProofMirReachabilityView(mir: ProofMirProgram): ProofMirReachabilityView {
  const reachableFunctionInstanceIds = reachableFunctionIds(mir);
  const edges = sourceCallEdgesFromCallGraph(mir, reachableFunctionInstanceIds);
  const successors = buildSourceCallSuccessors(edges);
  const sourceCallCycles = detectSourceCallCycles(reachableFunctionInstanceIds, successors);
  const reachableFunctionOrder =
    sourceCallCycles.length === 0
      ? topologicalReachableFunctionOrder(reachableFunctionInstanceIds, successors)
      : [];

  return {
    reachableFunctionIds: reachableFunctionInstanceIds,
    deadFunctionIds: deadFunctionIds(mir, reachableFunctionInstanceIds),
    sourceCallGraph: { edges, successors },
    sourceCallCycles,
    reachableFunctionOrder,
    reachablePlatformEdgeIds: reachablePlatformEdgeIds(mir),
  };
}

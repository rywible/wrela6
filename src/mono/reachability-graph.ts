import { monoDiagnostic } from "./diagnostics";
import type { ReachabilityState } from "./reachability-shared";

export function validateInstantiationGraphForCycles(state: ReachabilityState): void {
  const functionAdjacency = buildFunctionAdjacency(state);
  validateAdjacencyForCycles({
    adjacency: functionAdjacency,
    nodeOwnerKey: (canonicalKey) => {
      const instance = state.functionTableLookup.get(canonicalKey);
      if (instance !== undefined) {
        return `function:${instance.sourceFunctionId}`;
      }
      return `function:${canonicalKey}`;
    },
    state,
    cycleCode: "MONO_RECURSIVE_FUNCTION_CYCLE",
    rootCause: "recursion",
    kindLabel: "function",
  });
  const typeAdjacency = buildTypeAdjacency(state);
  validateAdjacencyForCycles({
    adjacency: typeAdjacency,
    nodeOwnerKey: (canonicalKey) => {
      const instance = state.typeTableLookup.get(canonicalKey);
      if (instance !== undefined) {
        return `type:${instance.sourceTypeId}`;
      }
      return `type:${canonicalKey}`;
    },
    state,
    cycleCode: "MONO_RECURSIVE_TYPE_CYCLE",
    rootCause: "recursion",
    kindLabel: "type",
  });
}

function buildFunctionAdjacency(state: ReachabilityState): Map<string, readonly string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of state.graphEdges) {
    if (edge.targetKind !== "function") continue;
    if (edge.source.kind !== "function") continue;
    const fromKey = String(edge.source.instanceId);
    const toKey = String(edge.targetInstanceId);
    let successors = adjacency.get(fromKey);
    if (successors === undefined) {
      successors = new Set<string>();
      adjacency.set(fromKey, successors);
    }
    successors.add(toKey);
  }
  const result = new Map<string, readonly string[]>();
  for (const [key, value] of adjacency) {
    result.set(key, [...value].sort());
  }
  return result;
}

function buildTypeAdjacency(state: ReachabilityState): Map<string, readonly string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of state.graphEdges) {
    if (edge.targetKind !== "type") continue;
    if (edge.source.kind !== "type") continue;
    const fromKey = String(edge.source.instanceId);
    const toKey = String(edge.targetInstanceId);
    let successors = adjacency.get(fromKey);
    if (successors === undefined) {
      successors = new Set<string>();
      adjacency.set(fromKey, successors);
    }
    successors.add(toKey);
  }
  const result = new Map<string, readonly string[]>();
  for (const [key, value] of adjacency) {
    result.set(key, [...value].sort());
  }
  return result;
}

interface ValidateAdjacencyForCyclesInput {
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly nodeOwnerKey: (canonicalKey: string) => string;
  readonly state: ReachabilityState;
  readonly cycleCode: "MONO_RECURSIVE_FUNCTION_CYCLE" | "MONO_RECURSIVE_TYPE_CYCLE";
  readonly rootCause: string;
  readonly kindLabel: string;
}

function validateAdjacencyForCycles(input: ValidateAdjacencyForCyclesInput): void {
  if (input.adjacency.size === 0) return;
  const seenCycles = new Set<string>();
  const sccs = findStronglyConnectedComponents(input.adjacency);
  for (const component of sccs) {
    if (component.length === 1) {
      const onlyNode = component[0]!;
      const successors = input.adjacency.get(onlyNode) ?? [];
      if (!successors.includes(onlyNode)) continue;
    }
    const sortedKey = [...component].sort().join("|");
    if (seenCycles.has(sortedKey)) continue;
    seenCycles.add(sortedKey);
    for (const node of [...component].sort()) {
      input.state.diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: input.cycleCode,
          message: `${input.kindLabel} instantiation graph contains a cycle.`,
          ownerKey: input.nodeOwnerKey(node),
          rootCauseKey: input.rootCause,
          stableDetail: `scc:${sortedKey}`,
        }),
      );
    }
  }
}

function findStronglyConnectedComponents(
  adjacency: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  const indexByNode = new Map<string, number>();
  const lowlinkByNode = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const components: string[][] = [];
  let currentIndex = 0;

  const allNodes = new Set<string>();
  for (const [node, successors] of adjacency) {
    allNodes.add(node);
    for (const successor of successors) {
      allNodes.add(successor);
    }
  }

  const sortedNodes = [...allNodes].sort();

  const strongConnect = (node: string): void => {
    indexByNode.set(node, currentIndex);
    lowlinkByNode.set(node, currentIndex);
    currentIndex++;
    tarjanStack.push(node);
    onStack.add(node);

    const successors = adjacency.get(node) ?? [];
    for (const successor of successors) {
      if (!indexByNode.has(successor)) {
        strongConnect(successor);
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node)!, lowlinkByNode.get(successor)!));
      } else if (onStack.has(successor)) {
        lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node)!, indexByNode.get(successor)!));
      }
    }

    if (lowlinkByNode.get(node) === indexByNode.get(node)) {
      const component: string[] = [];
      let popped: string | undefined;
      do {
        popped = tarjanStack.pop();
        if (popped === undefined) break;
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      if (component.length > 0) {
        components.push(component);
      }
    }
  };

  for (const node of sortedNodes) {
    if (!indexByNode.has(node)) {
      strongConnect(node);
    }
  }

  return components;
}

import type { OptIrFunctionId } from "../ids";
import type { OptIrCallGraphEdge } from "./call-graph";

export interface OptIrCallGraphSccInput {
  readonly functions: readonly OptIrFunctionId[];
  readonly edges: readonly OptIrCallGraphEdge[];
}

export interface OptIrCallGraphScc {
  readonly kind: "acyclic" | "recursive" | "maybeRecursive";
  readonly functions: readonly OptIrFunctionId[];
  readonly reason: "none" | "cycle" | "callback-or-unknown-call";
  readonly allowInlining: boolean;
  readonly allowSpecialization: boolean;
}

export interface OptIrCallGraphSccs {
  readonly entries: () => readonly OptIrCallGraphScc[];
}

export function computeOptIrCallGraphSccs(input: OptIrCallGraphSccInput): OptIrCallGraphSccs {
  const recursiveGroups = stronglyConnectedComponents(input);
  const sccs = recursiveGroups
    .filter(
      (group) =>
        group.length > 1 ||
        hasSelfEdge(input.edges, group[0]) ||
        hasMaybeRecursiveEdge(input.edges, group),
    )
    .map((functions): OptIrCallGraphScc => {
      const maybeRecursive = hasMaybeRecursiveEdge(input.edges, functions);
      return Object.freeze({
        kind: maybeRecursive ? "maybeRecursive" : "recursive",
        functions: Object.freeze([...functions]),
        reason: maybeRecursive ? "callback-or-unknown-call" : "cycle",
        allowInlining: false,
        allowSpecialization: false,
      });
    })
    .sort((left, right) => Number(left.functions[0]) - Number(right.functions[0]));

  return Object.freeze({
    entries() {
      return sccs.slice();
    },
  });
}

function stronglyConnectedComponents(input: OptIrCallGraphSccInput): readonly OptIrFunctionId[][] {
  const adjacency = new Map<OptIrFunctionId, OptIrFunctionId[]>();
  for (const functionId of input.functions) {
    adjacency.set(functionId, []);
  }
  for (const edge of input.edges) {
    if (edge.caller !== undefined && edge.callee !== undefined) {
      adjacency.get(edge.caller)?.push(edge.callee);
    }
  }
  for (const callees of adjacency.values()) {
    callees.sort((left, right) => Number(left) - Number(right));
  }

  let nextIndex = 0;
  const stack: OptIrFunctionId[] = [];
  const onStack = new Set<OptIrFunctionId>();
  const indexByFunction = new Map<OptIrFunctionId, number>();
  const lowlinkByFunction = new Map<OptIrFunctionId, number>();
  const groups: OptIrFunctionId[][] = [];

  function visit(functionId: OptIrFunctionId): void {
    indexByFunction.set(functionId, nextIndex);
    lowlinkByFunction.set(functionId, nextIndex);
    nextIndex += 1;
    stack.push(functionId);
    onStack.add(functionId);

    for (const callee of adjacency.get(functionId) ?? []) {
      if (!indexByFunction.has(callee)) {
        visit(callee);
        lowlinkByFunction.set(
          functionId,
          Math.min(lowlinkByFunction.get(functionId) ?? 0, lowlinkByFunction.get(callee) ?? 0),
        );
      } else if (onStack.has(callee)) {
        lowlinkByFunction.set(
          functionId,
          Math.min(lowlinkByFunction.get(functionId) ?? 0, indexByFunction.get(callee) ?? 0),
        );
      }
    }

    if (lowlinkByFunction.get(functionId) !== indexByFunction.get(functionId)) {
      return;
    }
    const group: OptIrFunctionId[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) {
        break;
      }
      onStack.delete(member);
      group.push(member);
      if (member === functionId) {
        break;
      }
    }
    groups.push(group.sort((left, right) => Number(left) - Number(right)));
  }

  for (const functionId of [...input.functions].sort(
    (left, right) => Number(left) - Number(right),
  )) {
    if (!indexByFunction.has(functionId)) {
      visit(functionId);
    }
  }
  return groups;
}

function hasSelfEdge(
  edges: readonly OptIrCallGraphEdge[],
  functionId: OptIrFunctionId | undefined,
): boolean {
  return (
    functionId !== undefined &&
    edges.some((edge) => edge.caller === functionId && edge.callee === functionId)
  );
}

function hasMaybeRecursiveEdge(
  edges: readonly OptIrCallGraphEdge[],
  functions: readonly OptIrFunctionId[],
): boolean {
  return edges.some(
    (edge) =>
      (edge.kind === "callback" || edge.kind === "unknownCall") &&
      edge.caller !== undefined &&
      functions.includes(edge.caller),
  );
}

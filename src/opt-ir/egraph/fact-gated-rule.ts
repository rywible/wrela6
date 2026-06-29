import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { OptIrFactId } from "../ids";
import type { PassDerivedFactKind } from "../passes/pass-contract";

export type OptIrFactGateKind =
  | "none"
  | "bounds"
  | "alias"
  | "layout"
  | "effect"
  | "abi"
  | "terminal"
  | "capabilityFlow"
  | "privateState"
  | "conjunction";

export type OptIrFactGate =
  | { readonly kind: "none" }
  | OptIrAtomicFactGate
  | { readonly kind: "conjunction"; readonly gates: readonly OptIrFactGate[] };

export type OptIrAtomicFactGate =
  | { readonly kind: "bounds"; readonly subjectRole: string }
  | { readonly kind: "alias"; readonly subjectRole: string }
  | { readonly kind: "layout"; readonly subjectRole: string }
  | { readonly kind: "effect"; readonly subjectRole: string }
  | { readonly kind: "abi"; readonly subjectRole: string }
  | { readonly kind: "terminal"; readonly subjectRole: string }
  | { readonly kind: "capabilityFlow"; readonly subjectRole: string }
  | { readonly kind: "privateState"; readonly subjectRole: string };

export interface OptIrFactGateAnswer {
  readonly kind: "yes" | "unknown";
  readonly factsUsed: readonly OptIrFactId[];
}

export interface OptIrFactGateEvaluationContext {
  readonly answers: {
    readonly bounds: (subjectRole: string) => OptIrFactGateAnswer;
    readonly alias: (subjectRole: string) => OptIrFactGateAnswer;
    readonly layout: (subjectRole: string) => OptIrFactGateAnswer;
    readonly effect: (subjectRole: string) => OptIrFactGateAnswer;
    readonly abi: (subjectRole: string) => OptIrFactGateAnswer;
    readonly terminal: (subjectRole: string) => OptIrFactGateAnswer;
    readonly capabilityFlow: (subjectRole: string) => OptIrFactGateAnswer;
    readonly privateState: (subjectRole: string) => OptIrFactGateAnswer;
  };
}

export type OptIrFactGateEvaluation =
  | {
      readonly kind: "passed";
      readonly factsUsed: readonly OptIrFactId[];
      readonly missingGateKinds: readonly [];
      readonly uncertaintyPenalty: 0;
    }
  | {
      readonly kind: "blocked";
      readonly factsUsed: readonly OptIrFactId[];
      readonly missingGateKinds: readonly OptIrFactGateKind[];
      readonly uncertaintyPenalty: number;
    };

export interface OptIrFactGateFactShape {
  readonly minimumFacts: number;
  readonly acceptedFactKinds: readonly (CheckedPacketFactKind | PassDerivedFactKind)[];
}

export const optIrFactGate = Object.freeze({
  none(): OptIrFactGate {
    return Object.freeze({ kind: "none" });
  },
  bounds(subjectRole: string): OptIrFactGate {
    return atomicGate("bounds", subjectRole);
  },
  alias(subjectRole: string): OptIrFactGate {
    return atomicGate("alias", subjectRole);
  },
  layout(subjectRole: string): OptIrFactGate {
    return atomicGate("layout", subjectRole);
  },
  effect(subjectRole: string): OptIrFactGate {
    return atomicGate("effect", subjectRole);
  },
  abi(subjectRole: string): OptIrFactGate {
    return atomicGate("abi", subjectRole);
  },
  terminal(subjectRole: string): OptIrFactGate {
    return atomicGate("terminal", subjectRole);
  },
  capabilityFlow(subjectRole: string): OptIrFactGate {
    return atomicGate("capabilityFlow", subjectRole);
  },
  privateState(subjectRole: string): OptIrFactGate {
    return atomicGate("privateState", subjectRole);
  },
  conjunction(gates: readonly OptIrFactGate[]): OptIrFactGate {
    return Object.freeze({ kind: "conjunction", gates: Object.freeze(gates.slice()) });
  },
});

export function evaluateOptIrFactGate(
  gate: OptIrFactGate,
  context: OptIrFactGateEvaluationContext,
): OptIrFactGateEvaluation {
  const factsUsed: OptIrFactId[] = [];
  const missingGateKinds: OptIrFactGateKind[] = [];
  evaluateGateInto(gate, context, factsUsed, missingGateKinds);

  if (missingGateKinds.length === 0) {
    return Object.freeze({
      kind: "passed",
      factsUsed: Object.freeze(uniqueSortedFacts(factsUsed)),
      missingGateKinds: [] as const,
      uncertaintyPenalty: 0,
    });
  }

  return Object.freeze({
    kind: "blocked",
    factsUsed: Object.freeze(uniqueSortedFacts(factsUsed)),
    missingGateKinds: Object.freeze(uniqueGateKinds(missingGateKinds)),
    uncertaintyPenalty: uniqueGateKinds(missingGateKinds).length,
  });
}

export function factKindsForGate(
  gate: OptIrFactGate,
): readonly (CheckedPacketFactKind | PassDerivedFactKind)[] {
  switch (gate.kind) {
    case "none":
      return [];
    case "bounds":
      return ["validatedBuffer", "packetSource"];
    case "alias":
      return ["ownership", "noalias", "fieldDisjointness"];
    case "layout":
      return ["layoutAbi"];
    case "effect":
      return ["platformEffect"];
    case "abi":
      return ["layoutAbi"];
    case "terminal":
      return ["terminalClosure", "exitClosure"];
    case "capabilityFlow":
      return ["capabilityFlow"];
    case "privateState":
      return ["privateState", "erasure"];
    case "conjunction":
      return uniqueStrings(gate.gates.flatMap(factKindsForGate));
  }
}

export function minimumFactsForGate(gate: OptIrFactGate): number {
  if (gate.kind === "none") {
    return 0;
  }
  if (gate.kind === "conjunction") {
    return gate.gates.reduce((total, child) => total + minimumFactsForGate(child), 0);
  }
  return 1;
}

function evaluateGateInto(
  gate: OptIrFactGate,
  context: OptIrFactGateEvaluationContext,
  factsUsed: OptIrFactId[],
  missingGateKinds: OptIrFactGateKind[],
): void {
  if (gate.kind === "none") {
    return;
  }
  if (gate.kind === "conjunction") {
    for (const child of gate.gates) {
      evaluateGateInto(child, context, factsUsed, missingGateKinds);
    }
    return;
  }

  const answer = context.answers[gate.kind](gate.subjectRole);
  factsUsed.push(...answer.factsUsed);
  if (answer.kind !== "yes") {
    missingGateKinds.push(gate.kind);
  }
}

function atomicGate(kind: OptIrAtomicFactGate["kind"], subjectRole: string): OptIrFactGate {
  if (subjectRole.length === 0) {
    throw new RangeError("OptIR e-graph fact gate subject role must be non-empty.");
  }
  return Object.freeze({ kind, subjectRole } as OptIrAtomicFactGate);
}

function uniqueSortedFacts(facts: readonly OptIrFactId[]): readonly OptIrFactId[] {
  return [...new Set(facts)].sort((left, right) => Number(left) - Number(right));
}

function uniqueGateKinds(kinds: readonly OptIrFactGateKind[]): readonly OptIrFactGateKind[] {
  return uniqueStrings(kinds) as readonly OptIrFactGateKind[];
}

function uniqueStrings<Value extends string>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckStateKey } from "./state-key";
import type {
  CheckedActiveFact,
  CheckedAttemptState,
  CheckedCapabilityState,
  CheckedDivergenceFact,
  CheckedErasureFact,
  CheckedLoanState,
  CheckedObligationState,
  CheckedPacketSourceFact,
  CheckedPlaceState,
  CheckedPrivateStateFact,
  CheckedSessionState,
  CheckedTerminalClosureFact,
  CheckedValidatedBufferFact,
  CheckedValidationState,
  ProofCheckState,
} from "./state";

export type ProofCheckCoreMeetResult =
  | { readonly kind: "exact"; readonly state: ProofCheckState }
  | { readonly kind: "coreMeet"; readonly state: ProofCheckState }
  | { readonly kind: "failed"; readonly failedComponentKeys: readonly string[] };

function stateMapsEqual<Key extends string, Value>(
  left: ReadonlyMap<Key, Value>,
  right: ReadonlyMap<Key, Value>,
  serialize: (value: Value) => string,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left.keys()) {
    if (!right.has(key)) {
      return false;
    }
    if (serialize(left.get(key)!) !== serialize(right.get(key)!)) {
      return false;
    }
  }
  return true;
}

function serializePlace(
  state: ProofCheckState["places"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.placeKey}:${state.lifecycle}`;
}

function serializeLoan(
  state: ProofCheckState["loans"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.loanKey}:${state.mode}:${state.placeKey}`;
}

function serializeObligation(
  state: ProofCheckState["obligations"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.obligationKey}:${state.status}:${state.sessionKey ?? ""}:${state.memberKey ?? ""}`;
}

function serializeSession(
  state: ProofCheckState["sessions"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.sessionKey}:${state.brandKey ?? ""}`;
}

function serializeValidation(
  state: ProofCheckState["validations"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.validationKey}:${state.status}`;
}

function serializeAttempt(
  state: ProofCheckState["attempts"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.attemptKey}:${state.status}`;
}

function serializePrivateState(
  state: ProofCheckState["privateState"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.placeKey}:${state.generationKey}`;
}

function serializeLayout(
  state: ProofCheckState["layout"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.bufferKey}:${state.layoutKey}`;
}

function serializeCapability(
  state: ProofCheckState["capabilities"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.capabilityKey}:${state.capabilityKind}`;
}

function serializeTerminal(
  state: ProofCheckState["terminal"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return state.terminalKey;
}

function serializeDivergence(
  state: ProofCheckState["divergence"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.divergenceKey}:${state.kind}`;
}

function serializeErasure(
  state: ProofCheckState["erasures"] extends ReadonlyMap<string, infer Value> ? Value : never,
): string {
  return `${state.erasureKey}:${state.subjectKey}`;
}

function collectResourceMismatchKeys(
  left: ProofCheckState,
  right: ProofCheckState,
): readonly string[] {
  const mismatches: string[] = [];
  if (!stateMapsEqual(left.places, right.places, serializePlace)) mismatches.push("places");
  if (!stateMapsEqual(left.loans, right.loans, serializeLoan)) mismatches.push("loans");
  if (!stateMapsEqual(left.obligations, right.obligations, serializeObligation)) {
    mismatches.push("obligations");
  }
  if (!stateMapsEqual(left.sessions, right.sessions, serializeSession)) mismatches.push("sessions");
  if (!stateMapsEqual(left.validations, right.validations, serializeValidation)) {
    mismatches.push("validations");
  }
  if (!stateMapsEqual(left.attempts, right.attempts, serializeAttempt)) mismatches.push("attempts");
  if (!stateMapsEqual(left.privateState, right.privateState, serializePrivateState)) {
    mismatches.push("privateState");
  }
  if (!stateMapsEqual(left.layout, right.layout, serializeLayout)) mismatches.push("layout");
  if (!stateMapsEqual(left.capabilities, right.capabilities, serializeCapability)) {
    mismatches.push("capabilities");
  }
  if (!stateMapsEqual(left.terminal, right.terminal, serializeTerminal))
    mismatches.push("terminal");
  if (!stateMapsEqual(left.divergence, right.divergence, serializeDivergence)) {
    mismatches.push("divergence");
  }
  if (!stateMapsEqual(left.erasures, right.erasures, serializeErasure)) mismatches.push("erasures");
  return mismatches;
}

export function proofCheckResourceMismatchKeys(
  left: ProofCheckState,
  right: ProofCheckState,
): readonly string[] {
  return collectResourceMismatchKeys(left, right);
}

function intersectFacts(states: readonly ProofCheckState[]): ProofCheckState["facts"] {
  if (states.length === 0) {
    return new Map();
  }

  const [first, ...rest] = states;
  const intersection = new Map(first!.facts);
  for (const state of rest) {
    for (const factKey of intersection.keys()) {
      const left = intersection.get(factKey)!;
      const right = state.facts.get(factKey);
      if (right === undefined || left.termKey !== right.termKey) {
        intersection.delete(factKey);
      }
    }
  }
  return intersection;
}

function intersectPacketSources(
  states: readonly ProofCheckState[],
): ProofCheckState["packetSources"] {
  if (states.length === 0) {
    return new Map();
  }

  const [first, ...rest] = states;
  const intersection = new Map(first!.packetSources);
  for (const state of rest) {
    for (const key of intersection.keys()) {
      const left = intersection.get(key)!;
      const right = state.packetSources.get(key);
      if (
        right === undefined ||
        left.packetKey !== right.packetKey ||
        left.sourceKey !== right.sourceKey
      ) {
        intersection.delete(key);
      }
    }
  }
  return intersection;
}

interface MutableProofCheckState {
  places: Map<string, CheckedPlaceState>;
  loans: Map<string, CheckedLoanState>;
  obligations: Map<string, CheckedObligationState>;
  sessions: Map<string, CheckedSessionState>;
  validations: Map<string, CheckedValidationState>;
  attempts: Map<string, CheckedAttemptState>;
  facts: Map<string, CheckedActiveFact>;
  privateState: Map<string, CheckedPrivateStateFact>;
  layout: Map<string, CheckedValidatedBufferFact>;
  packetSources: Map<string, CheckedPacketSourceFact>;
  capabilities: Map<string, CheckedCapabilityState>;
  terminal: Map<string, CheckedTerminalClosureFact>;
  divergence: Map<string, CheckedDivergenceFact>;
  erasures: Map<string, CheckedErasureFact>;
}

function cloneStateMaps(state: ProofCheckState): MutableProofCheckState {
  return {
    places: new Map(state.places),
    loans: new Map(state.loans),
    obligations: new Map(state.obligations),
    sessions: new Map(state.sessions),
    validations: new Map(state.validations),
    attempts: new Map(state.attempts),
    facts: new Map(state.facts),
    privateState: new Map(state.privateState),
    layout: new Map(state.layout),
    packetSources: new Map(state.packetSources),
    capabilities: new Map(state.capabilities),
    terminal: new Map(state.terminal),
    divergence: new Map(state.divergence),
    erasures: new Map(state.erasures),
  };
}

export function computeProofCheckCoreMeet(
  states: readonly ProofCheckState[],
): ProofCheckCoreMeetResult | undefined {
  if (states.length === 0) {
    return undefined;
  }

  const firstKey = proofCheckStateKey(states[0]!);
  if (states.every((state) => proofCheckStateKey(state) === firstKey)) {
    return {
      kind: "exact",
      state: states[0]!,
    };
  }

  const failedComponentKeys: string[] = [];
  for (let index = 1; index < states.length; index += 1) {
    failedComponentKeys.push(...collectResourceMismatchKeys(states[0]!, states[index]!));
  }
  const uniqueFailed = [...new Set(failedComponentKeys)].sort(compareCodeUnitStrings);
  if (uniqueFailed.length > 0) {
    return {
      kind: "failed",
      failedComponentKeys: uniqueFailed,
    };
  }

  const meetState = cloneStateMaps(states[0]!);
  meetState.facts = new Map(intersectFacts(states));
  meetState.packetSources = new Map(intersectPacketSources(states));

  return {
    kind: "coreMeet",
    state: meetState as ProofCheckState,
  };
}

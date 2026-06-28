import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckStateSnapshot } from "../diagnostics";
import {
  checkedActiveFactKey,
  checkedAttemptStateKey,
  checkedCapabilityStateKey,
  checkedDivergenceFactKey,
  checkedErasureFactKey,
  checkedLoanStateKey,
  checkedObligationStateKey,
  checkedPacketSourceFactKey,
  checkedPlaceStateKey,
  checkedPrivateStateFactKey,
  checkedSessionStateKey,
  checkedTerminalClosureFactKey,
  checkedValidatedBufferFactKey,
  checkedValidationStateKey,
  type CheckedActiveFact,
  type CheckedAttemptState,
  type CheckedCapabilityState,
  type CheckedDivergenceFact,
  type CheckedErasureFact,
  type CheckedLoanState,
  type CheckedObligationState,
  type CheckedPacketSourceFact,
  type CheckedPlaceLifecycle,
  type CheckedPlaceState,
  type CheckedPrivateStateFact,
  type CheckedSessionState,
  type CheckedTerminalClosureFact,
  type CheckedValidatedBufferFact,
  type CheckedValidationState,
  type ProofCheckState,
} from "./state";

function lengthDelimitedField(kind: string, payload: string): string {
  return `${kind}:len(${payload.length}):${payload}`;
}

function sortMapKeys<Key extends string>(keys: Iterable<Key>): readonly Key[] {
  return [...keys].sort(compareCodeUnitStrings);
}

function serializePlaceState(state: CheckedPlaceState): string {
  return lengthDelimitedField("place", `${state.placeKey}:${state.lifecycle}`);
}

function serializeLoanState(state: CheckedLoanState): string {
  return lengthDelimitedField("loan", `${state.loanKey}:${state.mode}:${state.placeKey}`);
}

function serializeObligationState(state: CheckedObligationState): string {
  const sessionKey = state.sessionKey ?? "";
  const memberKey = state.memberKey ?? "";
  return lengthDelimitedField(
    "obligation",
    `${state.obligationKey}:${state.status}:${sessionKey}:${memberKey}`,
  );
}

function serializeSessionState(state: CheckedSessionState): string {
  return lengthDelimitedField("session", `${state.sessionKey}:${state.brandKey ?? ""}`);
}

function serializeValidationState(state: CheckedValidationState): string {
  return lengthDelimitedField("validation", `${state.validationKey}:${state.status}`);
}

function serializeAttemptState(state: CheckedAttemptState): string {
  return lengthDelimitedField("attempt", `${state.attemptKey}:${state.status}`);
}

function serializeActiveFact(fact: CheckedActiveFact): string {
  return lengthDelimitedField("fact", `${fact.factKey}:${fact.termKey}`);
}

function serializePrivateStateFact(fact: CheckedPrivateStateFact): string {
  return lengthDelimitedField("privateState", `${fact.placeKey}:${fact.generationKey}`);
}

function serializeValidatedBufferFact(fact: CheckedValidatedBufferFact): string {
  return lengthDelimitedField("layout", `${fact.bufferKey}:${fact.layoutKey}`);
}

function serializePacketSourceFact(fact: CheckedPacketSourceFact): string {
  return lengthDelimitedField("packetSource", `${fact.packetKey}:${fact.sourceKey}`);
}

function serializeCapabilityState(state: CheckedCapabilityState): string {
  return lengthDelimitedField("capability", `${state.capabilityKey}:${state.capabilityKind}`);
}

function serializeTerminalClosureFact(fact: CheckedTerminalClosureFact): string {
  return lengthDelimitedField("terminal", fact.terminalKey);
}

function serializeDivergenceFact(fact: CheckedDivergenceFact): string {
  return lengthDelimitedField("divergence", `${fact.divergenceKey}:${fact.kind}`);
}

function serializeErasureFact(fact: CheckedErasureFact): string {
  return lengthDelimitedField("erasure", `${fact.erasureKey}:${fact.subjectKey}`);
}

function serializeMapSection<Entry>(
  sectionKind: string,
  map: ReadonlyMap<string, Entry>,
  serializeEntry: (entry: Entry) => string,
): string {
  const keys = sortMapKeys(map.keys());
  const payload = keys.map((key) => serializeEntry(map.get(key)!)).join("|");
  return lengthDelimitedField(sectionKind, payload);
}

export function proofCheckStateDigest(state: ProofCheckState): string {
  return [
    serializeMapSection("places", state.places, serializePlaceState),
    serializeMapSection("loans", state.loans, serializeLoanState),
    serializeMapSection("obligations", state.obligations, serializeObligationState),
    serializeMapSection("sessions", state.sessions, serializeSessionState),
    serializeMapSection("validations", state.validations, serializeValidationState),
    serializeMapSection("attempts", state.attempts, serializeAttemptState),
    serializeMapSection("facts", state.facts, serializeActiveFact),
    serializeMapSection("privateState", state.privateState, serializePrivateStateFact),
    serializeMapSection("layout", state.layout, serializeValidatedBufferFact),
    serializeMapSection("packetSources", state.packetSources, serializePacketSourceFact),
    serializeMapSection("capabilities", state.capabilities, serializeCapabilityState),
    serializeMapSection("terminal", state.terminal, serializeTerminalClosureFact),
    serializeMapSection("divergence", state.divergence, serializeDivergenceFact),
    serializeMapSection("erasures", state.erasures, serializeErasureFact),
  ].join(";");
}

const stateKeyMemo = new WeakMap<ProofCheckState, string>();

export function proofCheckStateKey(state: ProofCheckState): string {
  const cached = stateKeyMemo.get(state);
  if (cached !== undefined) {
    return cached;
  }
  const key = proofCheckStateDigest(state);
  stateKeyMemo.set(state, key);
  return key;
}

function isMovedOrConsumedLifecycle(lifecycle: CheckedPlaceLifecycle): boolean {
  return lifecycle === "moved" || lifecycle === "consumed";
}

function isLivePlaceLifecycle(lifecycle: CheckedPlaceLifecycle): boolean {
  return lifecycle === "owned" || lifecycle === "uninitialized";
}

export function proofCheckStateSnapshot(state: ProofCheckState): ProofCheckStateSnapshot {
  const livePlaces: string[] = [];
  const movedOrConsumedPlaces: string[] = [];

  for (const placeKey of sortMapKeys(state.places.keys())) {
    const place = state.places.get(placeKey)!;
    if (isLivePlaceLifecycle(place.lifecycle)) {
      livePlaces.push(placeKey);
      continue;
    }
    if (isMovedOrConsumedLifecycle(place.lifecycle)) {
      movedOrConsumedPlaces.push(placeKey);
    }
  }

  return {
    stateKey: proofCheckStateKey(state),
    livePlaces,
    movedOrConsumedPlaces,
    loans: sortMapKeys(state.loans.keys()).map((key) => checkedLoanStateKey(state.loans.get(key)!)),
    obligations: sortMapKeys(state.obligations.keys()).map((key) =>
      checkedObligationStateKey(state.obligations.get(key)!),
    ),
    sessions: sortMapKeys(state.sessions.keys()).map((key) =>
      checkedSessionStateKey(state.sessions.get(key)!),
    ),
    validations: sortMapKeys(state.validations.keys()).map((key) =>
      checkedValidationStateKey(state.validations.get(key)!),
    ),
    attempts: sortMapKeys(state.attempts.keys()).map((key) =>
      checkedAttemptStateKey(state.attempts.get(key)!),
    ),
    facts: sortMapKeys(state.facts.keys()).map((key) =>
      checkedActiveFactKey(state.facts.get(key)!),
    ),
    privateStateGenerations: sortMapKeys(state.privateState.keys()).map((key) => {
      const entry = state.privateState.get(key)!;
      return `${entry.placeKey}:${entry.generationKey}`;
    }),
    capabilities: sortMapKeys(state.capabilities.keys()).map((key) =>
      checkedCapabilityStateKey(state.capabilities.get(key)!),
    ),
  };
}

export function proofCheckStateComponentKeys(state: ProofCheckState): {
  readonly places: readonly string[];
  readonly loans: readonly string[];
  readonly obligations: readonly string[];
  readonly sessions: readonly string[];
  readonly validations: readonly string[];
  readonly attempts: readonly string[];
  readonly facts: readonly string[];
  readonly privateState: readonly string[];
  readonly layout: readonly string[];
  readonly packetSources: readonly string[];
  readonly capabilities: readonly string[];
  readonly terminal: readonly string[];
  readonly divergence: readonly string[];
  readonly erasures: readonly string[];
} {
  return {
    places: sortMapKeys(state.places.keys()).map((key) =>
      checkedPlaceStateKey(state.places.get(key)!),
    ),
    loans: sortMapKeys(state.loans.keys()).map((key) => checkedLoanStateKey(state.loans.get(key)!)),
    obligations: sortMapKeys(state.obligations.keys()).map((key) =>
      checkedObligationStateKey(state.obligations.get(key)!),
    ),
    sessions: sortMapKeys(state.sessions.keys()).map((key) =>
      checkedSessionStateKey(state.sessions.get(key)!),
    ),
    validations: sortMapKeys(state.validations.keys()).map((key) =>
      checkedValidationStateKey(state.validations.get(key)!),
    ),
    attempts: sortMapKeys(state.attempts.keys()).map((key) =>
      checkedAttemptStateKey(state.attempts.get(key)!),
    ),
    facts: sortMapKeys(state.facts.keys()).map((key) =>
      checkedActiveFactKey(state.facts.get(key)!),
    ),
    privateState: sortMapKeys(state.privateState.keys()).map((key) =>
      checkedPrivateStateFactKey(state.privateState.get(key)!),
    ),
    layout: sortMapKeys(state.layout.keys()).map((key) =>
      checkedValidatedBufferFactKey(state.layout.get(key)!),
    ),
    packetSources: sortMapKeys(state.packetSources.keys()).map((key) =>
      checkedPacketSourceFactKey(state.packetSources.get(key)!),
    ),
    capabilities: sortMapKeys(state.capabilities.keys()).map((key) =>
      checkedCapabilityStateKey(state.capabilities.get(key)!),
    ),
    terminal: sortMapKeys(state.terminal.keys()).map((key) =>
      checkedTerminalClosureFactKey(state.terminal.get(key)!),
    ),
    divergence: sortMapKeys(state.divergence.keys()).map((key) =>
      checkedDivergenceFactKey(state.divergence.get(key)!),
    ),
    erasures: sortMapKeys(state.erasures.keys()).map((key) =>
      checkedErasureFactKey(state.erasures.get(key)!),
    ),
  };
}

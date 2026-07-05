import { compareCodeUnitStrings } from "../../shared/deterministic-sort";

export type CheckedPlaceLifecycle =
  | "owned"
  | "moved"
  | "consumed"
  | "uninitialized"
  | "proofOnlyErased";

export interface CheckedPlaceState {
  readonly placeKey: string;
  readonly lifecycle: CheckedPlaceLifecycle;
}

export interface CheckedLoanState {
  readonly loanKey: string;
  readonly mode: "shared" | "exclusive";
  readonly placeKey: string;
}

export type CheckedObligationStatus = "open" | "discharged" | "closed";

export interface CheckedObligationState {
  readonly obligationKey: string;
  readonly status: CheckedObligationStatus;
  readonly sessionKey?: string;
  readonly memberKey?: string;
}

export interface CheckedSessionState {
  readonly sessionKey: string;
  readonly brandKey?: string;
  readonly streamLoanKey?: string;
}

export type CheckedValidationStatus = "pending" | "live" | "consumed" | "closed";

export interface CheckedValidationState {
  readonly validationKey: string;
  readonly status: CheckedValidationStatus;
}

export type CheckedAttemptStatus = "pending" | "live" | "consumed" | "closed";

export interface CheckedAttemptState {
  readonly attemptKey: string;
  readonly status: CheckedAttemptStatus;
}

export interface CheckedActiveFact {
  readonly factKey: string;
  readonly termKey: string;
  readonly predicateKey?: string;
  readonly placeKey?: string;
  readonly argumentKeys?: readonly string[];
}

export interface CheckedPrivateStateFact {
  readonly placeKey: string;
  readonly generationKey: string;
}

export interface CheckedValidatedBufferFact {
  readonly bufferKey: string;
  readonly layoutKey: string;
}

export interface CheckedPacketSourceFact {
  readonly packetKey: string;
  readonly sourceKey: string;
}

export interface CheckedCapabilityState {
  readonly capabilityKey: string;
  readonly capabilityKind: string;
}

export interface CheckedTerminalClosureFact {
  readonly terminalKey: string;
}

export type CheckedDivergenceKind = "panic" | "abort" | "doesNotReturn";

export interface CheckedDivergenceFact {
  readonly divergenceKey: string;
  readonly kind: CheckedDivergenceKind;
}

export interface CheckedErasureFact {
  readonly erasureKey: string;
  readonly subjectKey: string;
}

export interface ProofCheckStructuredPlace {
  readonly placeKey: string;
}

export interface ProofCheckStreamMember {
  readonly memberKey: string;
  readonly sessionKey: string;
}

export interface ProofCheckPrivatePredicateRequirement {
  readonly predicateKey: string;
  readonly placeKey?: string;
  readonly argumentKeys?: readonly string[];
  readonly generation: "current" | string;
}

export interface ProofCheckState {
  readonly places: ReadonlyMap<string, CheckedPlaceState>;
  readonly loans: ReadonlyMap<string, CheckedLoanState>;
  readonly obligations: ReadonlyMap<string, CheckedObligationState>;
  readonly sessions: ReadonlyMap<string, CheckedSessionState>;
  readonly validations: ReadonlyMap<string, CheckedValidationState>;
  readonly attempts: ReadonlyMap<string, CheckedAttemptState>;
  readonly facts: ReadonlyMap<string, CheckedActiveFact>;
  readonly privateState: ReadonlyMap<string, CheckedPrivateStateFact>;
  readonly layout: ReadonlyMap<string, CheckedValidatedBufferFact>;
  readonly packetSources: ReadonlyMap<string, CheckedPacketSourceFact>;
  readonly capabilities: ReadonlyMap<string, CheckedCapabilityState>;
  readonly terminal: ReadonlyMap<string, CheckedTerminalClosureFact>;
  readonly divergence: ReadonlyMap<string, CheckedDivergenceFact>;
  readonly erasures: ReadonlyMap<string, CheckedErasureFact>;
}

export interface ProofCheckStateInput {
  readonly places?: readonly CheckedPlaceState[];
  readonly loans?: readonly CheckedLoanState[];
  readonly obligations?: readonly CheckedObligationState[];
  readonly sessions?: readonly CheckedSessionState[];
  readonly validations?: readonly CheckedValidationState[];
  readonly attempts?: readonly CheckedAttemptState[];
  readonly facts?: readonly CheckedActiveFact[];
  readonly privateState?: readonly CheckedPrivateStateFact[];
  readonly layout?: readonly CheckedValidatedBufferFact[];
  readonly packetSources?: readonly CheckedPacketSourceFact[];
  readonly capabilities?: readonly CheckedCapabilityState[];
  readonly terminal?: readonly CheckedTerminalClosureFact[];
  readonly divergence?: readonly CheckedDivergenceFact[];
  readonly erasures?: readonly CheckedErasureFact[];
}

export function checkedPlaceStateKey(state: CheckedPlaceState): string {
  return state.placeKey;
}

export function checkedLoanStateKey(state: CheckedLoanState): string {
  return state.loanKey;
}

export function checkedObligationStateKey(state: CheckedObligationState): string {
  return state.obligationKey;
}

export function checkedSessionStateKey(state: CheckedSessionState): string {
  return state.sessionKey;
}

export function checkedValidationStateKey(state: CheckedValidationState): string {
  return state.validationKey;
}

export function checkedAttemptStateKey(state: CheckedAttemptState): string {
  return state.attemptKey;
}

export function checkedActiveFactKey(fact: CheckedActiveFact): string {
  return fact.factKey;
}

export function checkedPrivateStateFactKey(fact: CheckedPrivateStateFact): string {
  return fact.placeKey;
}

export function checkedValidatedBufferFactKey(fact: CheckedValidatedBufferFact): string {
  return fact.bufferKey;
}

export function checkedPacketSourceFactKey(fact: CheckedPacketSourceFact): string {
  return `${fact.packetKey}->${fact.sourceKey}`;
}

export function checkedCapabilityStateKey(state: CheckedCapabilityState): string {
  return state.capabilityKey;
}

export function checkedTerminalClosureFactKey(fact: CheckedTerminalClosureFact): string {
  return fact.terminalKey;
}

export function checkedDivergenceFactKey(fact: CheckedDivergenceFact): string {
  return fact.divergenceKey;
}

export function checkedErasureFactKey(fact: CheckedErasureFact): string {
  return fact.erasureKey;
}

function sealedReadonlyMap<KeyType, ValueType>(
  map: ReadonlyMap<KeyType, ValueType>,
): ReadonlyMap<KeyType, ValueType> {
  const readonlyMap = {
    get(key: KeyType): ValueType | undefined {
      return map.get(key);
    },
    has(key: KeyType): boolean {
      return map.has(key);
    },
    get size(): number {
      return map.size;
    },
    entries() {
      return map.entries();
    },
    keys() {
      return map.keys();
    },
    values() {
      return map.values();
    },
    forEach(
      callbackfn: (value: ValueType, key: KeyType, map: ReadonlyMap<KeyType, ValueType>) => void,
      thisArg?: unknown,
    ): void {
      map.forEach(callbackfn, thisArg);
    },
    [Symbol.iterator]() {
      return map[Symbol.iterator]();
    },
  };

  return Object.freeze(readonlyMap) as ReadonlyMap<KeyType, ValueType>;
}

function buildDeterministicMap<Entry>(
  entries: readonly Entry[] | undefined,
  keyOf: (entry: Entry) => string,
): ReadonlyMap<string, Entry> {
  const sortedEntries = [...(entries ?? [])].sort((left, right) =>
    compareCodeUnitStrings(keyOf(left), keyOf(right)),
  );
  return sealedReadonlyMap(new Map(sortedEntries.map((entry) => [keyOf(entry), entry])));
}

export function createProofCheckState(input: ProofCheckStateInput = {}): ProofCheckState {
  const state: ProofCheckState = {
    places: buildDeterministicMap(input.places, checkedPlaceStateKey),
    loans: buildDeterministicMap(input.loans, checkedLoanStateKey),
    obligations: buildDeterministicMap(input.obligations, checkedObligationStateKey),
    sessions: buildDeterministicMap(input.sessions, checkedSessionStateKey),
    validations: buildDeterministicMap(input.validations, checkedValidationStateKey),
    attempts: buildDeterministicMap(input.attempts, checkedAttemptStateKey),
    facts: buildDeterministicMap(input.facts, checkedActiveFactKey),
    privateState: buildDeterministicMap(input.privateState, checkedPrivateStateFactKey),
    layout: buildDeterministicMap(input.layout, checkedValidatedBufferFactKey),
    packetSources: buildDeterministicMap(input.packetSources, checkedPacketSourceFactKey),
    capabilities: buildDeterministicMap(input.capabilities, checkedCapabilityStateKey),
    terminal: buildDeterministicMap(input.terminal, checkedTerminalClosureFactKey),
    divergence: buildDeterministicMap(input.divergence, checkedDivergenceFactKey),
    erasures: buildDeterministicMap(input.erasures, checkedErasureFactKey),
  };

  return Object.freeze(state);
}

export function emptyProofCheckState(): ProofCheckState {
  return createProofCheckState();
}

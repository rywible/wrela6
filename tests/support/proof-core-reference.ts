export type ResourceKind = "copy" | "affine" | "linear" | "privateState" | "singleUse";
export type ResourceStatus = "live" | "consumed" | "maybeConsumed";

export interface ResourceSpec {
  readonly kind: ResourceKind;
  readonly brand?: string;
  readonly generation?: number;
  readonly droppable?: boolean;
  readonly coreMovable?: boolean;
  readonly ownerCore?: string;
}

interface ResourceRecord extends ResourceSpec {
  readonly status: ResourceStatus;
}

interface ObligationRecord {
  readonly obligationId: string;
  readonly place: string;
}

interface LoanRecord {
  readonly loanId: string;
  readonly place: string;
}

export interface ProofState {
  readonly places: ReadonlyMap<string, ResourceRecord>;
  readonly facts: ReadonlySet<string>;
  readonly obligations: ReadonlyMap<string, ObligationRecord>;
  readonly loans: ReadonlyMap<string, LoanRecord>;
}

export type ProofResult = {
  readonly succeeded: boolean;
  readonly state: ProofState;
  readonly code?: string;
};

export function emptyState(): ProofState {
  return {
    places: new Map(),
    facts: new Set(),
    obligations: new Map(),
    loans: new Map(),
  };
}

export function cloneState(state: ProofState): ProofState {
  return {
    places: new Map(state.places),
    facts: new Set(state.facts),
    obligations: new Map(state.obligations),
    loans: new Map(state.loans),
  };
}

export function withPlace(state: ProofState, place: string, spec: ResourceSpec): ProofState {
  const places = new Map(state.places);
  places.set(place, {
    ...spec,
    generation: spec.generation ?? 0,
    droppable: spec.droppable ?? spec.kind === "copy",
    coreMovable: spec.coreMovable ?? false,
    status: "live",
  });
  return {
    ...cloneState(state),
    places,
  };
}

export function bindPlace(state: ProofState, place: string, spec: ResourceSpec): ProofResult {
  const existing = state.places.get(place);
  if (existing !== undefined && existing.status === "live" && existing.kind !== "copy") {
    return rejected(state, "PLACE_SHADOWS_LIVE_RESOURCE");
  }

  return accepted(withPlace(state, place, spec));
}

export function expectRejected(result: ProofResult, code: string): void {
  if (result.succeeded) {
    throw new Error(`Expected ${code}, got ok.`);
  }
  if (result.code !== code) {
    throw new Error(`Expected ${code}, got ${result.code ?? "unknown"}.`);
  }
}

export function addFact(state: ProofState, fact: string): ProofState {
  const facts = new Set(state.facts);
  facts.add(fact);
  return {
    ...cloneState(state),
    facts,
  };
}

export function consumePlace(state: ProofState, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind === "copy") {
    return accepted(state);
  }

  const places = new Map(state.places);
  places.set(place, { ...record, status: "consumed" });
  return accepted({ ...cloneState(state), places });
}

export function usePlace(state: ProofState, place: string): ProofResult {
  return checkPlaceAvailable(state, place);
}

export function joinStates(leftState: ProofState, rightState: ProofState): ProofResult {
  const places = new Map<string, ResourceRecord>();
  const placeNames = new Set([...leftState.places.keys(), ...rightState.places.keys()]);

  for (const place of placeNames) {
    const leftRecord = leftState.places.get(place);
    const rightRecord = rightState.places.get(place);

    if (leftRecord === undefined && rightRecord !== undefined) {
      places.set(place, { ...rightRecord, status: "maybeConsumed" });
      continue;
    }

    if (rightRecord === undefined && leftRecord !== undefined) {
      places.set(place, { ...leftRecord, status: "maybeConsumed" });
      continue;
    }

    if (leftRecord !== undefined && rightRecord !== undefined) {
      const status = leftRecord.status === rightRecord.status ? leftRecord.status : "maybeConsumed";
      places.set(place, { ...leftRecord, status });
    }
  }

  const facts = new Set<string>();
  for (const fact of leftState.facts) {
    if (rightState.facts.has(fact)) {
      facts.add(fact);
    }
  }

  return accepted({
    places,
    facts,
    obligations: new Map([...leftState.obligations, ...rightState.obligations]),
    loans: new Map([...leftState.loans, ...rightState.loans]),
  });
}

export function enterLinearObligation(
  state: ProofState,
  obligationId: string,
  place: string,
): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const obligations = new Map(state.obligations);
  obligations.set(obligationId, { obligationId, place });
  return accepted({ ...cloneState(state), obligations });
}

export function dischargeObligation(
  state: ProofState,
  obligationId: string,
  place: string,
  expectedBrand?: string,
): ProofResult {
  const obligation = state.obligations.get(obligationId);
  if (obligation === undefined) {
    return rejected(state, "OBLIGATION_NOT_FOUND");
  }

  if (obligation.place !== place) {
    return rejected(state, "OBLIGATION_PLACE_MISMATCH");
  }

  const record = state.places.get(place);
  if (record === undefined) {
    return rejected(state, "RESOURCE_UNKNOWN_PLACE");
  }

  if (expectedBrand !== undefined && record.brand !== expectedBrand) {
    return rejected(state, "BRAND_MISMATCH");
  }

  const consumeResult = consumePlace(state, place);
  if (!consumeResult.succeeded) return consumeResult;

  const obligations = new Map(consumeResult.state.obligations);
  obligations.delete(obligationId);
  return accepted({ ...cloneState(consumeResult.state), obligations });
}

export function dropPlace(state: ProofState, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (!record.droppable) {
    return rejected(state, "RESOURCE_MUST_BE_HANDLED");
  }

  return consumePlace(state, place);
}

export function wrapPlace(
  state: ProofState,
  wrapperPlace: string,
  sourcePlace: string,
): ProofResult {
  const useResult = checkPlaceAvailable(state, sourcePlace);
  if (!useResult.succeeded) return useResult;

  const sourceRecord = state.places.get(sourcePlace)!;
  const consumedResult = consumePlace(state, sourcePlace);
  if (!consumedResult.succeeded) return consumedResult;

  return accepted(
    withPlace(consumedResult.state, wrapperPlace, {
      kind: sourceRecord.kind,
      brand: sourceRecord.brand,
      generation: sourceRecord.generation,
      droppable: false,
      coreMovable: false,
    }),
  );
}

export function openLoan(state: ProofState, loanId: string, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const loans = new Map(state.loans);
  loans.set(loanId, { loanId, place });
  return accepted({ ...cloneState(state), loans });
}

export function exitFunction(
  state: ProofState,
  _exitKind: "return" | "break" | "continue",
): ProofResult {
  if (state.obligations.size > 0) {
    return rejected(state, "LIVE_OBLIGATION_ON_EXIT");
  }
  if (state.loans.size > 0) {
    return rejected(state, "LIVE_LOAN_ON_EXIT");
  }
  return accepted(state);
}

export function checkLoopBackedge(state: ProofState): ProofResult {
  if (state.obligations.size > 0) {
    return rejected(state, "LIVE_OBLIGATION_ON_LOOP_BACKEDGE");
  }
  if (state.loans.size > 0) {
    return rejected(state, "LIVE_LOAN_ON_LOOP_BACKEDGE");
  }
  return accepted(state);
}

export function markValidationMatched(state: ProofState, place: string): ProofResult {
  return consumePlace(state, place);
}

export function matchValidationOk(
  state: ProofState,
  validationPlace: string,
  sourcePlace: string,
  packetPlace: string,
): ProofResult {
  const validationResult = consumePlace(state, validationPlace);
  if (!validationResult.succeeded) return validationResult;

  const sourceRecord = validationResult.state.places.get(sourcePlace);
  if (sourceRecord === undefined) {
    return rejected(validationResult.state, "RESOURCE_UNKNOWN_PLACE");
  }

  const sourceResult = consumePlace(validationResult.state, sourcePlace);
  if (!sourceResult.succeeded) return sourceResult;

  const packetState = withPlace(sourceResult.state, packetPlace, {
    kind: "linear",
    brand: sourceRecord.brand,
    droppable: false,
    coreMovable: false,
  });
  const obligations = new Map(packetState.obligations);

  for (const [obligationId, obligation] of obligations) {
    if (obligation.place === sourcePlace) {
      obligations.set(obligationId, { ...obligation, place: packetPlace });
    }
  }

  return accepted({ ...cloneState(packetState), obligations });
}

export function requireFact(state: ProofState, fact: string): ProofResult {
  if (!state.facts.has(fact)) {
    return rejected(state, "FACT_NOT_PROVEN");
  }
  return accepted(state);
}

export function advancePrivateState(state: ProofState, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "privateState") {
    return rejected(state, "RESOURCE_KIND_MISMATCH");
  }

  const places = new Map(state.places);
  places.set(place, {
    ...record,
    generation: (record.generation ?? 0) + 1,
  });
  return accepted({ ...cloneState(state), places });
}

export function callFallibleConsume(
  state: ProofState,
  place: string,
  contract: "attempt" | "plainResult",
): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (contract !== "attempt" && record.kind !== "copy") {
    return rejected(state, "ATTEMPT_REQUIRED");
  }

  return consumePlace(state, place);
}

export function callOrdinaryFunctionDischarge(state: ProofState, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "copy") {
    return rejected(state, "ORDINARY_DISCHARGE");
  }

  return accepted(state);
}

export function transferToCore(state: ProofState, place: string, targetCore: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (!record.coreMovable) {
    return rejected(state, "RESOURCE_NOT_CORE_MOVABLE");
  }

  const places = new Map(state.places);
  places.set(place, { ...record, ownerCore: targetCore });
  return accepted({ ...cloneState(state), places });
}

export function checkTerminalGraph(edges: readonly (readonly [string, string])[]): ProofResult {
  const graph = new Map<string, string[]>();
  for (const [caller, callee] of edges) {
    const callees = graph.get(caller) ?? [];
    callees.push(callee);
    graph.set(caller, callees);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(functionName: string): boolean {
    if (visiting.has(functionName)) return true;
    if (visited.has(functionName)) return false;

    visiting.add(functionName);
    for (const callee of graph.get(functionName) ?? []) {
      if (hasCycle(callee)) return true;
    }
    visiting.delete(functionName);
    visited.add(functionName);
    return false;
  }

  for (const functionName of graph.keys()) {
    if (hasCycle(functionName)) {
      return rejected(emptyState(), "TERMINAL_CYCLE");
    }
  }

  return accepted(emptyState());
}

export function readDynamicLayoutField(state: ProofState, field: string): ProofResult {
  const owner = field.split(".")[0] ?? field;
  if (!state.facts.has(`layout.fixedFits(${owner})`)) {
    return rejected(state, "LAYOUT_FIT_NOT_PROVEN");
  }
  return accepted(state);
}

function checkPlaceAvailable(state: ProofState, place: string): ProofResult {
  const record = state.places.get(place);
  if (record === undefined) {
    return rejected(state, "RESOURCE_UNKNOWN_PLACE");
  }
  if (record.status === "consumed") {
    return rejected(state, "RESOURCE_ALREADY_CONSUMED");
  }
  if (record.status === "maybeConsumed") {
    return rejected(state, "RESOURCE_MAYBE_CONSUMED");
  }
  if (isLoaned(state, place)) {
    return rejected(state, "PLACE_LOANED");
  }
  if (hasConsumedChild(state, place)) {
    return rejected(state, "RESOURCE_PARTIALLY_MOVED");
  }
  return accepted(state);
}

function isLoaned(state: ProofState, place: string): boolean {
  for (const loan of state.loans.values()) {
    if (place === loan.place || place.startsWith(`${loan.place}.`)) {
      return true;
    }
  }
  return false;
}

function hasConsumedChild(state: ProofState, place: string): boolean {
  for (const [candidatePlace, record] of state.places) {
    if (
      candidatePlace.startsWith(`${place}.`) &&
      (record.status === "consumed" || record.status === "maybeConsumed")
    ) {
      return true;
    }
  }
  return false;
}

function accepted(state: ProofState): ProofResult {
  return { succeeded: true, state: cloneState(state) };
}

function rejected(state: ProofState, code: string): ProofResult {
  return { succeeded: false, state: cloneState(state), code };
}

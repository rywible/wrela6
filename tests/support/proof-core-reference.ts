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
  if (!factIsStableForState(state, fact)) {
    return cloneState(state);
  }

  const facts = new Set(state.facts);
  facts.add(fact);
  return {
    ...cloneState(state),
    facts,
  };
}

export function consumePlace(state: ProofState, place: string): ProofResult {
  return consumePlaceWithObligationMode(state, place, false);
}

function consumePlaceWithObligationMode(
  state: ProofState,
  place: string,
  allowOverlappingObligation: boolean,
): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (!allowOverlappingObligation && hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }

  if (record.kind === "copy") {
    return accepted(state);
  }

  const places = new Map(state.places);
  places.set(place, { ...record, status: "consumed" });

  for (const [candidatePlace, candidateRecord] of places) {
    if (candidatePlace.startsWith(`${place}.`)) {
      places.set(candidatePlace, { ...candidateRecord, status: "consumed" });
    }
  }

  const affectedPlaces = affectedPlacesForMove(state, place);
  const facts = removeFactsMentioningPlaces(state.facts, affectedPlaces);
  return accepted({ ...cloneState(state), places, facts });
}

export function usePlace(state: ProofState, place: string): ProofResult {
  return checkPlaceAvailable(state, place);
}

export function joinStates(leftState: ProofState, rightState: ProofState): ProofResult {
  if (!sameObligations(leftState.obligations, rightState.obligations)) {
    return rejected(leftState, "BRANCH_OBLIGATION_MISMATCH");
  }

  if (!sameLoans(leftState.loans, rightState.loans)) {
    return rejected(leftState, "BRANCH_LOAN_MISMATCH");
  }

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
      if (!sameResourceShape(leftRecord, rightRecord)) {
        return rejected(leftState, "BRANCH_RESOURCE_MISMATCH");
      }

      const status = leftRecord.status === rightRecord.status ? leftRecord.status : "maybeConsumed";
      places.set(place, { ...leftRecord, status });
    }
  }

  for (const obligation of leftState.obligations.values()) {
    const record = places.get(obligation.place);
    if (record === undefined || record.status !== "live") {
      return rejected(leftState, "BRANCH_OBLIGATION_RESOURCE_MISMATCH");
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
    obligations: new Map(leftState.obligations),
    loans: new Map(leftState.loans),
  });
}

export function enterLinearObligation(
  state: ProofState,
  obligationId: string,
  place: string,
): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  if (state.obligations.has(obligationId)) {
    return rejected(state, "OBLIGATION_ALREADY_OPEN");
  }

  const record = state.places.get(place)!;
  if (record.kind === "copy") {
    return rejected(state, "OBLIGATION_REQUIRES_NON_COPY");
  }

  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "PLACE_ALREADY_OBLIGATED");
  }

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

  const consumeResult = consumePlaceWithObligationMode(state, place, true);
  if (!consumeResult.succeeded) return consumeResult;

  const obligations = new Map(consumeResult.state.obligations);
  obligations.delete(obligationId);
  return accepted({ ...cloneState(consumeResult.state), obligations });
}

export function dropPlace(state: ProofState, place: string): ProofResult {
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }
  if (hasMustHandleChild(state, place)) {
    return rejected(state, "RESOURCE_CHILD_MUST_BE_HANDLED");
  }
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

  if (state.loans.has(loanId)) {
    return rejected(state, "LOAN_ALREADY_OPEN");
  }

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
  const useResult = checkPlaceAvailable(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "singleUse") {
    return rejected(state, "RESOURCE_KIND_MISMATCH");
  }

  return consumePlace(state, place);
}

export function matchValidationOk(
  state: ProofState,
  validationPlace: string,
  sourcePlace: string,
  packetPlace: string,
): ProofResult {
  const validationRecord = state.places.get(validationPlace);
  if (validationRecord === undefined) {
    return rejected(state, "RESOURCE_UNKNOWN_PLACE");
  }

  const sourceRecord = state.places.get(sourcePlace);
  if (sourceRecord === undefined) {
    return rejected(state, "RESOURCE_UNKNOWN_PLACE");
  }

  if (
    validationRecord.brand !== undefined &&
    sourceRecord.brand !== undefined &&
    validationRecord.brand !== sourceRecord.brand
  ) {
    return rejected(state, "BRAND_MISMATCH");
  }

  const validationResult = markValidationMatched(state, validationPlace);
  if (!validationResult.succeeded) return validationResult;

  const sourceResult = consumePlaceWithObligationMode(validationResult.state, sourcePlace, true);
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
  const facts = removeFactsMentioningPlaces(state.facts, [place]);
  return accepted({ ...cloneState(state), places, facts });
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

  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
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

  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }

  const places = new Map(state.places);
  places.set(place, { ...record, ownerCore: targetCore });
  return accepted({ ...cloneState(state), places });
}

export function checkTerminalGraph(
  edges: readonly (readonly [string, string])[],
  platformDischarges?: ReadonlySet<string>,
): ProofResult {
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

  if (platformDischarges !== undefined) {
    for (const functionName of graph.keys()) {
      if (!hasPathToPlatformDischarge(graph, platformDischarges, functionName)) {
        return rejected(emptyState(), "TERMINAL_NO_PLATFORM_DISCHARGE");
      }
    }
  }

  return accepted(emptyState());
}

export function readDynamicLayoutField(state: ProofState, field: string): ProofResult {
  const owner = field.split(".")[0] ?? field;
  if (!state.facts.has(`layout.fixedFits(${owner})`)) {
    return rejected(state, "LAYOUT_FIT_NOT_PROVEN");
  }
  if (!state.facts.has(`layout.dynamicRange(${field})`)) {
    return rejected(state, "LAYOUT_DYNAMIC_RANGE_NOT_PROVEN");
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
  if (hasConsumedParent(state, place)) {
    return rejected(state, "RESOURCE_ALREADY_CONSUMED");
  }
  if (isLoaned(state, place)) {
    return rejected(state, "PLACE_LOANED");
  }
  if (hasLoanedChild(state, place)) {
    return rejected(state, "RESOURCE_PARTIALLY_LOANED");
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

function hasLoanedChild(state: ProofState, place: string): boolean {
  for (const loan of state.loans.values()) {
    if (loan.place.startsWith(`${place}.`)) {
      return true;
    }
  }
  return false;
}

function hasConsumedParent(state: ProofState, place: string): boolean {
  for (const parentPlace of parentPlaces(place)) {
    const record = state.places.get(parentPlace);
    if (record?.status === "consumed" || record?.status === "maybeConsumed") {
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

function sameObligations(
  leftObligations: ReadonlyMap<string, ObligationRecord>,
  rightObligations: ReadonlyMap<string, ObligationRecord>,
): boolean {
  if (leftObligations.size !== rightObligations.size) return false;

  for (const [obligationId, leftObligation] of leftObligations) {
    const rightObligation = rightObligations.get(obligationId);
    if (rightObligation?.place !== leftObligation.place) {
      return false;
    }
  }
  return true;
}

function sameLoans(
  leftLoans: ReadonlyMap<string, LoanRecord>,
  rightLoans: ReadonlyMap<string, LoanRecord>,
): boolean {
  if (leftLoans.size !== rightLoans.size) return false;

  for (const [loanId, leftLoan] of leftLoans) {
    const rightLoan = rightLoans.get(loanId);
    if (rightLoan?.place !== leftLoan.place) {
      return false;
    }
  }
  return true;
}

function sameResourceShape(leftRecord: ResourceRecord, rightRecord: ResourceRecord): boolean {
  return (
    leftRecord.kind === rightRecord.kind &&
    leftRecord.brand === rightRecord.brand &&
    leftRecord.generation === rightRecord.generation &&
    leftRecord.droppable === rightRecord.droppable &&
    leftRecord.coreMovable === rightRecord.coreMovable &&
    leftRecord.ownerCore === rightRecord.ownerCore
  );
}

function hasOverlappingObligation(state: ProofState, place: string): boolean {
  for (const obligation of state.obligations.values()) {
    if (placesOverlap(obligation.place, place)) {
      return true;
    }
  }
  return false;
}

function hasMustHandleChild(state: ProofState, place: string): boolean {
  for (const [candidatePlace, record] of state.places) {
    if (candidatePlace.startsWith(`${place}.`) && record.status === "live" && !record.droppable) {
      return true;
    }
  }
  return false;
}

function placesOverlap(leftPlace: string, rightPlace: string): boolean {
  return (
    leftPlace === rightPlace ||
    leftPlace.startsWith(`${rightPlace}.`) ||
    rightPlace.startsWith(`${leftPlace}.`)
  );
}

function hasPathToPlatformDischarge(
  graph: ReadonlyMap<string, readonly string[]>,
  platformDischarges: ReadonlySet<string>,
  functionName: string,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (platformDischarges.has(functionName)) return true;
  if (seen.has(functionName)) return false;

  const nextSeen = new Set(seen);
  nextSeen.add(functionName);

  for (const callee of graph.get(functionName) ?? []) {
    if (hasPathToPlatformDischarge(graph, platformDischarges, callee, nextSeen)) {
      return true;
    }
  }
  return false;
}

function affectedPlacesForMove(state: ProofState, place: string): readonly string[] {
  const affectedPlaces = new Set<string>([place, ...parentPlaces(place)]);
  for (const candidatePlace of state.places.keys()) {
    if (candidatePlace.startsWith(`${place}.`)) {
      affectedPlaces.add(candidatePlace);
    }
  }
  return [...affectedPlaces];
}

function parentPlaces(place: string): readonly string[] {
  const parts = place.split(".");
  const parents: string[] = [];
  for (let length = parts.length - 1; length > 0; length -= 1) {
    parents.push(parts.slice(0, length).join("."));
  }
  return parents;
}

function removeFactsMentioningPlaces(
  facts: ReadonlySet<string>,
  places: readonly string[],
): ReadonlySet<string> {
  const remainingFacts = new Set<string>();
  for (const fact of facts) {
    if (!places.some((place) => factMentionsPlace(fact, place))) {
      remainingFacts.add(fact);
    }
  }
  return remainingFacts;
}

function factMentionsPlace(fact: string, place: string): boolean {
  const escapedPlace = place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escapedPlace}(?=$|[^A-Za-z0-9_])`).test(fact);
}

function factIsStableForState(state: ProofState, fact: string): boolean {
  for (const [place, record] of state.places) {
    if (!factMentionsPlace(fact, place)) {
      continue;
    }

    if (record.status !== "live") {
      return false;
    }

    if (record.kind === "privateState") {
      const generation = privateGenerationMentionedByFact(fact, place);
      if (generation !== undefined && generation !== (record.generation ?? 0)) {
        return false;
      }
    }
  }

  return true;
}

function privateGenerationMentionedByFact(fact: string, place: string): number | undefined {
  const escapedPlace = place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|[^A-Za-z0-9_])${escapedPlace}@([0-9]+)(?=$|[^A-Za-z0-9_])`).exec(
    fact,
  );
  return match === null ? undefined : Number(match[2]);
}

function accepted(state: ProofState): ProofResult {
  return { succeeded: true, state: cloneState(state) };
}

function rejected(state: ProofState, code: string): ProofResult {
  return { succeeded: false, state: cloneState(state), code };
}

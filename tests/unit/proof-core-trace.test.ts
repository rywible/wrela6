import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import {
  addFact,
  advancePrivateState,
  callFallibleConsume,
  callOrdinaryFunctionDischarge,
  checkLoopBackedge,
  cloneState,
  consumePlace,
  dischargeObligation,
  dropPlace,
  emptyState,
  enterLinearObligation,
  exitFunction,
  markValidationMatched,
  matchValidationOk,
  openLoan,
  readDynamicLayoutField,
  requireFact,
  transferToCore,
  type ProofResult,
  type ProofState,
  usePlace,
  withPlace,
  wrapPlace,
} from "../support/proof-core-reference";

type ProofMirInstruction =
  | { readonly kind: "use"; readonly place: string }
  | { readonly kind: "consume"; readonly place: string }
  | { readonly kind: "drop"; readonly place: string }
  | { readonly kind: "openObligation"; readonly obligationId: string; readonly place: string }
  | { readonly kind: "discharge"; readonly obligationId: string; readonly place: string }
  | { readonly kind: "openLoan"; readonly loanId: string; readonly place: string }
  | { readonly kind: "wrap"; readonly wrapperPlace: string; readonly sourcePlace: string }
  | {
      readonly kind: "matchValidationOk";
      readonly validationPlace: string;
      readonly sourcePlace: string;
      readonly packetPlace: string;
    }
  | { readonly kind: "markValidation"; readonly place: string }
  | {
      readonly kind: "fallibleConsume";
      readonly place: string;
      readonly contract: "attempt" | "plainResult";
    }
  | { readonly kind: "ordinaryDischarge"; readonly place: string }
  | { readonly kind: "transferToCore"; readonly place: string; readonly targetCore: string }
  | { readonly kind: "readLayout"; readonly field: string }
  | { readonly kind: "exit" }
  | { readonly kind: "loopBackedge" }
  | { readonly kind: "addFact"; readonly fact: string }
  | { readonly kind: "requireFact"; readonly fact: string }
  | { readonly kind: "advancePrivate"; readonly place: string };

interface StateSnapshot {
  readonly places: readonly ResourceSnapshot[];
  readonly facts: readonly string[];
  readonly obligations: readonly ObligationSnapshot[];
  readonly loans: readonly LoanSnapshot[];
}

interface ResourceSnapshot {
  readonly place: string;
  readonly kind: string;
  readonly status: string;
  readonly brand?: string;
  readonly generation?: number;
  readonly droppable?: boolean;
  readonly coreMovable?: boolean;
  readonly ownerCore?: string;
}

interface ObligationSnapshot {
  readonly obligationId: string;
  readonly place: string;
}

interface LoanSnapshot {
  readonly loanId: string;
  readonly place: string;
}

describe("proof core generated trace semantics", () => {
  test("direct consume cannot bypass a live obligation", () => {
    const trace: readonly ProofMirInstruction[] = [
      { kind: "openObligation", obligationId: "oa", place: "a" },
      { kind: "consume", place: "a" },
    ];

    const result = runOperationalTrace(initialTraceState(), trace);

    expect(result.succeeded).toBe(false);
    expect(result.code).toBe("RESOURCE_HAS_LIVE_OBLIGATION");
  });

  test("generated Proof MIR traces match the declarative trace checker", () => {
    fastCheck.assert(
      fastCheck.property(
        fastCheck.array(instructionGenerator, { minLength: 0, maxLength: 16 }),
        (trace) => {
          const initialState = initialTraceState();
          const operationalResult = runOperationalTrace(initialState, trace);
          const declarativeResult = runDeclarativeTrace(initialState, trace);

          expect(equivalenceSnapshot(operationalResult)).toEqual(
            equivalenceSnapshot(declarativeResult),
          );
        },
      ),
      { numRuns: 5_000, seed: 0x71ace },
    );
  });
});

const placeGenerator = fastCheck.constantFrom("a", "b", "builder", "count", "mobile", "missing");
const producedPlaceGenerator = fastCheck.constantFrom("packet", "wrapped", "a", "b");
const validationPlaceGenerator = fastCheck.constantFrom("validation", "looseValidation", "a");
const obligationIdGenerator = fastCheck.constantFrom("oa", "ob");
const loanIdGenerator = fastCheck.constantFrom("la", "lb");
const contractGenerator = fastCheck.constantFrom<"attempt" | "plainResult">(
  "attempt",
  "plainResult",
);
const coreGenerator = fastCheck.constantFrom("core0", "core1");
const layoutFieldGenerator = fastCheck.constantFrom("Packet.payload", "Packet.header");
const factGenerator = fastCheck.constantFrom(
  "a.ready",
  "b.ready",
  "builder@0.ready",
  "builder@1.ready",
  "layout.fixedFits(Packet)",
  "layout.dynamicRange(Packet.payload)",
);

const instructionGenerator: fastCheck.Arbitrary<ProofMirInstruction> = fastCheck.oneof(
  placeGenerator.map((place): ProofMirInstruction => ({ kind: "use", place })),
  placeGenerator.map((place): ProofMirInstruction => ({ kind: "consume", place })),
  placeGenerator.map((place): ProofMirInstruction => ({ kind: "drop", place })),
  fastCheck.tuple(obligationIdGenerator, placeGenerator).map(
    ([obligationId, place]): ProofMirInstruction => ({
      kind: "openObligation",
      obligationId,
      place,
    }),
  ),
  fastCheck.tuple(obligationIdGenerator, placeGenerator).map(
    ([obligationId, place]): ProofMirInstruction => ({
      kind: "discharge",
      obligationId,
      place,
    }),
  ),
  fastCheck.tuple(loanIdGenerator, placeGenerator).map(
    ([loanId, place]): ProofMirInstruction => ({
      kind: "openLoan",
      loanId,
      place,
    }),
  ),
  fastCheck.tuple(producedPlaceGenerator, placeGenerator).map(
    ([wrapperPlace, sourcePlace]): ProofMirInstruction => ({
      kind: "wrap",
      wrapperPlace,
      sourcePlace,
    }),
  ),
  fastCheck.tuple(validationPlaceGenerator, placeGenerator, producedPlaceGenerator).map(
    ([validationPlace, sourcePlace, packetPlace]): ProofMirInstruction => ({
      kind: "matchValidationOk",
      validationPlace,
      sourcePlace,
      packetPlace,
    }),
  ),
  validationPlaceGenerator.map((place): ProofMirInstruction => ({ kind: "markValidation", place })),
  fastCheck.tuple(placeGenerator, contractGenerator).map(
    ([place, contract]): ProofMirInstruction => ({
      kind: "fallibleConsume",
      place,
      contract,
    }),
  ),
  placeGenerator.map((place): ProofMirInstruction => ({ kind: "ordinaryDischarge", place })),
  fastCheck.tuple(placeGenerator, coreGenerator).map(
    ([place, targetCore]): ProofMirInstruction => ({
      kind: "transferToCore",
      place,
      targetCore,
    }),
  ),
  layoutFieldGenerator.map((field): ProofMirInstruction => ({ kind: "readLayout", field })),
  fastCheck.constant<ProofMirInstruction>({ kind: "exit" }),
  fastCheck.constant<ProofMirInstruction>({ kind: "loopBackedge" }),
  factGenerator.map((fact): ProofMirInstruction => ({ kind: "addFact", fact })),
  factGenerator.map((fact): ProofMirInstruction => ({ kind: "requireFact", fact })),
  placeGenerator.map((place): ProofMirInstruction => ({ kind: "advancePrivate", place })),
);

function initialTraceState(): ProofState {
  return withPlace(
    withPlace(
      withPlace(
        withPlace(
          withPlace(
            withPlace(withPlace(emptyState(), "a", { kind: "linear", brand: "session" }), "b", {
              kind: "affine",
              droppable: true,
              coreMovable: true,
            }),
            "builder",
            { kind: "privateState", generation: 0 },
          ),
          "validation",
          { kind: "singleUse", brand: "session" },
        ),
        "looseValidation",
        { kind: "singleUse" },
      ),
      "mobile",
      { kind: "linear", coreMovable: true },
    ),
    "count",
    { kind: "copy" },
  );
}

function runOperationalTrace(
  initialState: ProofState,
  trace: readonly ProofMirInstruction[],
): ProofResult {
  let state = cloneState(initialState);

  for (const instruction of trace) {
    const result = applyOperationalInstruction(state, instruction);
    if (!result.succeeded) return result;

    const invariantCode = checkTraceInvariants(result.state);
    if (invariantCode !== undefined) {
      return rejected(result.state, invariantCode);
    }

    state = result.state;
  }

  return accepted(state);
}

function applyOperationalInstruction(
  state: ProofState,
  instruction: ProofMirInstruction,
): ProofResult {
  switch (instruction.kind) {
    case "use":
      return usePlace(state, instruction.place);
    case "consume":
      return consumePlace(state, instruction.place);
    case "drop":
      return dropPlace(state, instruction.place);
    case "openObligation":
      return enterLinearObligation(state, instruction.obligationId, instruction.place);
    case "discharge":
      return dischargeObligation(state, instruction.obligationId, instruction.place);
    case "openLoan":
      return openLoan(state, instruction.loanId, instruction.place);
    case "wrap":
      return wrapPlace(state, instruction.wrapperPlace, instruction.sourcePlace);
    case "matchValidationOk":
      return matchValidationOk(
        state,
        instruction.validationPlace,
        instruction.sourcePlace,
        instruction.packetPlace,
      );
    case "markValidation":
      return markValidationMatched(state, instruction.place);
    case "fallibleConsume":
      return callFallibleConsume(state, instruction.place, instruction.contract);
    case "ordinaryDischarge":
      return callOrdinaryFunctionDischarge(state, instruction.place);
    case "transferToCore":
      return transferToCore(state, instruction.place, instruction.targetCore);
    case "readLayout":
      return readDynamicLayoutField(state, instruction.field);
    case "exit":
      return exitFunction(state, "return");
    case "loopBackedge":
      return checkLoopBackedge(state);
    case "addFact":
      return accepted(addFact(state, instruction.fact));
    case "requireFact":
      return requireFact(state, instruction.fact);
    case "advancePrivate":
      return advancePrivateState(state, instruction.place);
  }
}

function runDeclarativeTrace(
  initialState: ProofState,
  trace: readonly ProofMirInstruction[],
): ProofResult {
  let state = cloneState(initialState);

  for (const instruction of trace) {
    const result = applyDeclarativeInstruction(state, instruction);
    if (!result.succeeded) return result;

    const invariantCode = checkTraceInvariants(result.state);
    if (invariantCode !== undefined) {
      return rejected(result.state, invariantCode);
    }

    state = result.state;
  }

  return accepted(state);
}

function applyDeclarativeInstruction(
  state: ProofState,
  instruction: ProofMirInstruction,
): ProofResult {
  switch (instruction.kind) {
    case "use":
      return checkAvailableDeclarative(state, instruction.place);
    case "consume":
      return consumeDeclarative(state, instruction.place, false);
    case "drop":
      return dropDeclarative(state, instruction.place);
    case "openObligation":
      return openObligationDeclarative(state, instruction.obligationId, instruction.place);
    case "discharge":
      return dischargeDeclarative(state, instruction.obligationId, instruction.place);
    case "openLoan":
      return openLoanDeclarative(state, instruction.loanId, instruction.place);
    case "wrap":
      return wrapDeclarative(state, instruction.wrapperPlace, instruction.sourcePlace);
    case "matchValidationOk":
      return matchValidationOkDeclarative(
        state,
        instruction.validationPlace,
        instruction.sourcePlace,
        instruction.packetPlace,
      );
    case "markValidation":
      return markValidationDeclarative(state, instruction.place);
    case "fallibleConsume":
      return fallibleConsumeDeclarative(state, instruction.place, instruction.contract);
    case "ordinaryDischarge":
      return ordinaryDischargeDeclarative(state, instruction.place);
    case "transferToCore":
      return transferToCoreDeclarative(state, instruction.place, instruction.targetCore);
    case "readLayout":
      return readLayoutDeclarative(state, instruction.field);
    case "exit":
      return exitDeclarative(state);
    case "loopBackedge":
      return loopBackedgeDeclarative(state);
    case "addFact":
      return accepted(addFactDeclarative(state, instruction.fact));
    case "requireFact":
      return state.facts.has(instruction.fact)
        ? accepted(state)
        : rejected(state, "FACT_NOT_PROVEN");
    case "advancePrivate":
      return advancePrivateDeclarative(state, instruction.place);
  }
}

function openObligationDeclarative(
  state: ProofState,
  obligationId: string,
  place: string,
): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;
  if (state.obligations.has(obligationId)) return rejected(state, "OBLIGATION_ALREADY_OPEN");

  const record = state.places.get(place)!;
  if (record.kind === "copy") return rejected(state, "OBLIGATION_REQUIRES_NON_COPY");
  if (hasOverlappingObligation(state, place)) return rejected(state, "PLACE_ALREADY_OBLIGATED");

  const obligations = new Map(state.obligations);
  obligations.set(obligationId, { obligationId, place });
  return accepted({ ...cloneState(state), obligations });
}

function dischargeDeclarative(state: ProofState, obligationId: string, place: string): ProofResult {
  const obligation = state.obligations.get(obligationId);
  if (obligation === undefined) return rejected(state, "OBLIGATION_NOT_FOUND");
  if (obligation.place !== place) return rejected(state, "OBLIGATION_PLACE_MISMATCH");
  if (!state.places.has(place)) return rejected(state, "RESOURCE_UNKNOWN_PLACE");

  const consumedResult = consumeDeclarative(state, place, true);
  if (!consumedResult.succeeded) return consumedResult;

  const obligations = new Map(consumedResult.state.obligations);
  obligations.delete(obligationId);
  return accepted({ ...cloneState(consumedResult.state), obligations });
}

function openLoanDeclarative(state: ProofState, loanId: string, place: string): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;
  if (state.loans.has(loanId)) return rejected(state, "LOAN_ALREADY_OPEN");
  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }

  const loans = new Map(state.loans);
  loans.set(loanId, { loanId, place });
  return accepted({ ...cloneState(state), loans });
}

function wrapDeclarative(
  state: ProofState,
  wrapperPlace: string,
  sourcePlace: string,
): ProofResult {
  const bindResult = checkCanBindPlaceDeclarative(state, wrapperPlace);
  if (!bindResult.succeeded) return bindResult;

  const useResult = checkAvailableDeclarative(state, sourcePlace);
  if (!useResult.succeeded) return useResult;

  const sourceRecord = state.places.get(sourcePlace)!;
  const consumedResult = consumeDeclarative(state, sourcePlace, false);
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

function matchValidationOkDeclarative(
  state: ProofState,
  validationPlace: string,
  sourcePlace: string,
  packetPlace: string,
): ProofResult {
  const validationRecord = state.places.get(validationPlace);
  if (validationRecord === undefined) return rejected(state, "RESOURCE_UNKNOWN_PLACE");

  const sourceRecord = state.places.get(sourcePlace);
  if (sourceRecord === undefined) return rejected(state, "RESOURCE_UNKNOWN_PLACE");

  if (validationRecord.brand !== sourceRecord.brand) {
    return rejected(state, "BRAND_MISMATCH");
  }

  const bindResult = checkCanBindPlaceDeclarative(state, packetPlace);
  if (!bindResult.succeeded) return bindResult;

  const validationResult = markValidationDeclarative(state, validationPlace);
  if (!validationResult.succeeded) return validationResult;

  const sourceResult = consumeDeclarative(validationResult.state, sourcePlace, true);
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

function markValidationDeclarative(state: ProofState, place: string): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "singleUse") return rejected(state, "RESOURCE_KIND_MISMATCH");

  return consumeDeclarative(state, place, false);
}

function fallibleConsumeDeclarative(
  state: ProofState,
  place: string,
  contract: "attempt" | "plainResult",
): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (contract !== "attempt" && record.kind !== "copy") {
    return rejected(state, "ATTEMPT_REQUIRED");
  }
  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }

  return consumeDeclarative(state, place, false);
}

function ordinaryDischargeDeclarative(state: ProofState, place: string): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "copy") return rejected(state, "ORDINARY_DISCHARGE");

  return accepted(state);
}

function transferToCoreDeclarative(
  state: ProofState,
  place: string,
  targetCore: string,
): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (!record.coreMovable) return rejected(state, "RESOURCE_NOT_CORE_MOVABLE");
  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }

  const places = new Map(state.places);
  places.set(place, { ...record, ownerCore: targetCore });
  return accepted({ ...cloneState(state), places });
}

function readLayoutDeclarative(state: ProofState, field: string): ProofResult {
  const owner = field.split(".")[0] ?? field;
  if (!state.facts.has(`layout.fixedFits(${owner})`)) {
    return rejected(state, "LAYOUT_FIT_NOT_PROVEN");
  }
  if (!state.facts.has(`layout.dynamicRange(${field})`)) {
    return rejected(state, "LAYOUT_DYNAMIC_RANGE_NOT_PROVEN");
  }
  return accepted(state);
}

function exitDeclarative(state: ProofState): ProofResult {
  if (state.obligations.size > 0) return rejected(state, "LIVE_OBLIGATION_ON_EXIT");
  if (state.loans.size > 0) return rejected(state, "LIVE_LOAN_ON_EXIT");
  return accepted(state);
}

function loopBackedgeDeclarative(state: ProofState): ProofResult {
  if (state.obligations.size > 0) {
    return rejected(state, "LIVE_OBLIGATION_ON_LOOP_BACKEDGE");
  }
  if (state.loans.size > 0) return rejected(state, "LIVE_LOAN_ON_LOOP_BACKEDGE");
  return accepted(state);
}

function dropDeclarative(state: ProofState, place: string): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }
  if (hasMustHandleChild(state, place)) return rejected(state, "RESOURCE_CHILD_MUST_BE_HANDLED");
  if (!record.droppable) return rejected(state, "RESOURCE_MUST_BE_HANDLED");

  return consumeDeclarative(state, place, false);
}

function advancePrivateDeclarative(state: ProofState, place: string): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (record.kind !== "privateState") return rejected(state, "RESOURCE_KIND_MISMATCH");

  const places = new Map(state.places);
  places.set(place, { ...record, generation: (record.generation ?? 0) + 1 });
  const facts = removeFactsMentioningPlaces(state.facts, [place]);
  return accepted({ ...cloneState(state), places, facts });
}

function consumeDeclarative(
  state: ProofState,
  place: string,
  allowOverlappingObligation: boolean,
): ProofResult {
  const useResult = checkAvailableDeclarative(state, place);
  if (!useResult.succeeded) return useResult;

  const record = state.places.get(place)!;
  if (!allowOverlappingObligation && hasOverlappingObligation(state, place)) {
    return rejected(state, "RESOURCE_HAS_LIVE_OBLIGATION");
  }
  if (record.kind === "copy") return accepted(state);

  const places = new Map(state.places);
  places.set(place, { ...record, status: "consumed" });

  for (const [candidatePlace, candidateRecord] of places) {
    if (candidatePlace.startsWith(`${place}.`)) {
      places.set(candidatePlace, { ...candidateRecord, status: "consumed" });
    }
  }

  const facts = removeFactsMentioningPlaces(state.facts, affectedPlacesForMove(state, place));
  return accepted({ ...cloneState(state), places, facts });
}

function addFactDeclarative(state: ProofState, fact: string): ProofState {
  if (!factIsStableForState(state, fact)) return cloneState(state);

  const facts = new Set(state.facts);
  facts.add(fact);
  return { ...cloneState(state), facts };
}

function checkAvailableDeclarative(state: ProofState, place: string): ProofResult {
  const record = state.places.get(place);
  if (record === undefined) return rejected(state, "RESOURCE_UNKNOWN_PLACE");
  if (record.status === "consumed") return rejected(state, "RESOURCE_ALREADY_CONSUMED");
  if (record.status === "maybeConsumed") return rejected(state, "RESOURCE_MAYBE_CONSUMED");
  if (hasConsumedParent(state, place)) return rejected(state, "RESOURCE_ALREADY_CONSUMED");
  if (isLoaned(state, place)) return rejected(state, "PLACE_LOANED");
  if (hasLoanedChild(state, place)) return rejected(state, "RESOURCE_PARTIALLY_LOANED");
  if (hasConsumedChild(state, place)) return rejected(state, "RESOURCE_PARTIALLY_MOVED");
  return accepted(state);
}

function checkCanBindPlaceDeclarative(state: ProofState, place: string): ProofResult {
  const existing = state.places.get(place);
  if (existing !== undefined && existing.status === "live" && existing.kind !== "copy") {
    return rejected(state, "PLACE_SHADOWS_LIVE_RESOURCE");
  }
  return accepted(state);
}

function checkTraceInvariants(state: ProofState): string | undefined {
  for (const obligation of state.obligations.values()) {
    const record = state.places.get(obligation.place);
    if (record === undefined || record.status !== "live") {
      return "OBLIGATION_POINTS_TO_NON_LIVE_PLACE";
    }
  }

  for (const loan of state.loans.values()) {
    const record = state.places.get(loan.place);
    if (record === undefined || record.status !== "live") {
      return "LOAN_POINTS_TO_NON_LIVE_PLACE";
    }
  }

  for (const fact of state.facts) {
    if (!factIsStableForState(state, fact)) return "FACT_NOT_STABLE_IN_TRACE";
  }

  for (const [place, record] of state.places) {
    if (record.status === "consumed") continue;
    if (hasConsumedParent(state, place)) return "LIVE_CHILD_UNDER_CONSUMED_PARENT";
  }

  return undefined;
}

function equivalenceSnapshot(result: ProofResult): {
  readonly succeeded: boolean;
  readonly code?: string;
  readonly state?: StateSnapshot;
} {
  if (!result.succeeded) return { succeeded: false, code: result.code };
  return { succeeded: true, state: snapshotState(result.state) };
}

function snapshotState(state: ProofState): StateSnapshot {
  return {
    places: [...state.places.entries()]
      .map(([place, record]) => ({
        place,
        kind: record.kind,
        status: record.status,
        brand: record.brand,
        generation: record.generation,
        droppable: record.droppable,
        coreMovable: record.coreMovable,
        ownerCore: record.ownerCore,
      }))
      .sort(compareByPlace),
    facts: [...state.facts].sort(),
    obligations: [...state.obligations.values()]
      .map((obligation) => ({
        obligationId: obligation.obligationId,
        place: obligation.place,
      }))
      .sort(compareByObligationId),
    loans: [...state.loans.values()]
      .map((loan) => ({
        loanId: loan.loanId,
        place: loan.place,
      }))
      .sort(compareByLoanId),
  };
}

function factIsStableForState(state: ProofState, fact: string): boolean {
  for (const [place, record] of state.places) {
    if (!factMentionsPlace(fact, place)) continue;
    if (record.status !== "live") return false;

    if (record.kind === "privateState") {
      const generation = privateGenerationMentionedByFact(fact, place);
      if (generation !== undefined && generation !== (record.generation ?? 0)) return false;
    }
  }

  return true;
}

function hasOverlappingObligation(state: ProofState, place: string): boolean {
  for (const obligation of state.obligations.values()) {
    if (placesOverlap(obligation.place, place)) return true;
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

function hasConsumedParent(state: ProofState, place: string): boolean {
  for (const parentPlace of parentPlaces(place)) {
    const record = state.places.get(parentPlace);
    if (record?.status === "consumed" || record?.status === "maybeConsumed") return true;
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

function isLoaned(state: ProofState, place: string): boolean {
  for (const loan of state.loans.values()) {
    if (place === loan.place || place.startsWith(`${loan.place}.`)) return true;
  }
  return false;
}

function hasLoanedChild(state: ProofState, place: string): boolean {
  for (const loan of state.loans.values()) {
    if (loan.place.startsWith(`${place}.`)) return true;
  }
  return false;
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

function affectedPlacesForMove(state: ProofState, place: string): readonly string[] {
  const affectedPlaces = new Set<string>([place, ...parentPlaces(place)]);
  for (const candidatePlace of state.places.keys()) {
    if (candidatePlace.startsWith(`${place}.`)) affectedPlaces.add(candidatePlace);
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

function placesOverlap(leftPlace: string, rightPlace: string): boolean {
  return (
    leftPlace === rightPlace ||
    leftPlace.startsWith(`${rightPlace}.`) ||
    rightPlace.startsWith(`${leftPlace}.`)
  );
}

function factMentionsPlace(fact: string, place: string): boolean {
  const escapedPlace = place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escapedPlace}(?=$|[^A-Za-z0-9_])`).test(fact);
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

function compareByPlace(
  left: { readonly place: string },
  right: { readonly place: string },
): number {
  return left.place.localeCompare(right.place);
}

function compareByObligationId(left: ObligationSnapshot, right: ObligationSnapshot): number {
  return left.obligationId.localeCompare(right.obligationId);
}

function compareByLoanId(left: LoanSnapshot, right: LoanSnapshot): number {
  return left.loanId.localeCompare(right.loanId);
}

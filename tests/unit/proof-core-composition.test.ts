import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import {
  addFact,
  advancePrivateState,
  checkTerminalGraph,
  consumePlace,
  emptyState,
  joinStates,
  openLoan,
  requireFact,
  type ProofResult,
  type ProofState,
  type ResourceStatus,
  withPlace,
} from "../support/proof-core-reference";

type GeneratedStatus = Extract<ResourceStatus, "live" | "consumed" | "maybeConsumed">;

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

const simplePlace = fastCheck.constantFrom("a", "b", "c", "d");
const disjointPlacePair = fastCheck
  .tuple(simplePlace, simplePlace)
  .filter(([leftPlace, rightPlace]) => leftPlace !== rightPlace);

describe("proof core composition and permutation properties", () => {
  test("adding independent facts is permutation invariant", () => {
    fastCheck.assert(
      fastCheck.property(
        fastCheck.uniqueArray(simplePlace, { minLength: 2, maxLength: 4 }),
        (places) => {
          const facts = places.map((place) => `${place}.ready`);
          const forward = facts.reduce(addFact, emptyState());
          const backward = [...facts].reverse().reduce(addFact, emptyState());

          expect(snapshotState(forward)).toEqual(snapshotState(backward));
        },
      ),
      { numRuns: 200, seed: 0xc001 },
    );
  });

  test("disjoint consumes commute", () => {
    fastCheck.assert(
      fastCheck.property(disjointPlacePair, ([leftPlace, rightPlace]) => {
        const initialState = withLinearPlaces([leftPlace, rightPlace]);

        const leftThenRight = consumePlace(consumePlace(initialState, leftPlace).state, rightPlace);
        const rightThenLeft = consumePlace(consumePlace(initialState, rightPlace).state, leftPlace);

        expectAcceptedEquivalent(leftThenRight, rightThenLeft);
      }),
      { numRuns: 200, seed: 0xc002 },
    );
  });

  test("disjoint loans commute", () => {
    fastCheck.assert(
      fastCheck.property(disjointPlacePair, ([leftPlace, rightPlace]) => {
        const initialState = withAffinePlaces([leftPlace, rightPlace]);

        const leftThenRight = openLoan(
          openLoan(initialState, "left-loan", leftPlace).state,
          "right-loan",
          rightPlace,
        );
        const rightThenLeft = openLoan(
          openLoan(initialState, "right-loan", rightPlace).state,
          "left-loan",
          leftPlace,
        );

        expectAcceptedEquivalent(leftThenRight, rightThenLeft);
      }),
      { numRuns: 200, seed: 0xc003 },
    );
  });

  test("branch joins are commutative for generated resource statuses", () => {
    fastCheck.assert(
      fastCheck.property(generatedStatus, generatedStatus, (leftStatus, rightStatus) => {
        const leftState = stateWithStatus(leftStatus);
        const rightState = stateWithStatus(rightStatus);

        expectAcceptedEquivalent(
          joinStates(leftState, rightState),
          joinStates(rightState, leftState),
        );
      }),
      { numRuns: 200, seed: 0xc004 },
    );
  });

  test("branch joins are associative for generated resource statuses", () => {
    fastCheck.assert(
      fastCheck.property(
        generatedStatus,
        generatedStatus,
        generatedStatus,
        (firstStatus, secondStatus, thirdStatus) => {
          const firstState = stateWithStatus(firstStatus);
          const secondState = stateWithStatus(secondStatus);
          const thirdState = stateWithStatus(thirdStatus);

          const leftGrouped = joinStates(joinStates(firstState, secondState).state, thirdState);
          const rightGrouped = joinStates(firstState, joinStates(secondState, thirdState).state);

          expectAcceptedEquivalent(leftGrouped, rightGrouped);
        },
      ),
      { numRuns: 200, seed: 0xc005 },
    );
  });

  test("terminal graph validation is invariant under edge permutation", () => {
    fastCheck.assert(
      fastCheck.property(fastCheck.boolean(), (swapEdges) => {
        const edges: readonly (readonly [string, string])[] = swapEdges
          ? [
              ["sanitize", "platformDischarge"],
              ["closePacket", "sanitize"],
            ]
          : [
              ["closePacket", "sanitize"],
              ["sanitize", "platformDischarge"],
            ];

        const result = checkTerminalGraph(edges, new Set(["platformDischarge"]));

        expect(result.succeeded).toBe(true);
      }),
      { numRuns: 20, seed: 0xc006 },
    );
  });

  test("facts about consumed resources cannot be revived by permutation", () => {
    fastCheck.assert(
      fastCheck.property(simplePlace, (place) => {
        const fact = `len <= ${place}.initialized_prefix`;
        const initialState = withPlace(emptyState(), place, { kind: "linear" });
        const consumedState = consumePlace(initialState, place).state;
        const revivedState = addFact(consumedState, fact);

        expect(requireFact(revivedState, fact).succeeded).toBe(false);
      }),
      { numRuns: 100, seed: 0xc007 },
    );
  });

  test("old private-state facts cannot be revived after generation advance", () => {
    const initialState = withPlace(emptyState(), "builder", {
      kind: "privateState",
      generation: 0,
    });
    const advancedState = advancePrivateState(initialState, "builder").state;
    const revivedState = addFact(advancedState, "builder@0.can_insert(desc)");

    expect(requireFact(revivedState, "builder@0.can_insert(desc)").succeeded).toBe(false);
  });
});

const generatedStatus = fastCheck.constantFrom<GeneratedStatus>(
  "live",
  "consumed",
  "maybeConsumed",
);

function withLinearPlaces(places: readonly string[]): ProofState {
  return places.reduce(
    (state, place) => withPlace(state, place, { kind: "linear", brand: "session" }),
    emptyState(),
  );
}

function withAffinePlaces(places: readonly string[]): ProofState {
  return places.reduce((state, place) => withPlace(state, place, { kind: "affine" }), emptyState());
}

function stateWithStatus(status: GeneratedStatus): ProofState {
  const liveState = withPlace(emptyState(), "resource", {
    kind: "linear",
    brand: "session",
  });

  if (status === "live") {
    return liveState;
  }

  const consumedState = consumePlace(liveState, "resource").state;
  if (status === "consumed") {
    return consumedState;
  }

  return joinStates(liveState, consumedState).state;
}

function expectAcceptedEquivalent(leftResult: ProofResult, rightResult: ProofResult): void {
  expect(leftResult.succeeded).toBe(true);
  expect(rightResult.succeeded).toBe(true);
  expect(snapshotState(leftResult.state)).toEqual(snapshotState(rightResult.state));
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
      .sort(compareById),
    loans: [...state.loans.values()]
      .map((loan) => ({
        loanId: loan.loanId,
        place: loan.place,
      }))
      .sort(compareById),
  };
}

function compareByPlace(
  left: { readonly place: string },
  right: { readonly place: string },
): number {
  return left.place.localeCompare(right.place);
}

function compareById(
  left: { readonly obligationId?: string; readonly loanId?: string },
  right: { readonly obligationId?: string; readonly loanId?: string },
): number {
  return (left.obligationId ?? left.loanId ?? "").localeCompare(
    right.obligationId ?? right.loanId ?? "",
  );
}

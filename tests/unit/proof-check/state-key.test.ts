import { describe, expect, test } from "bun:test";
import {
  proofCheckStateComponentKeys,
  proofCheckStateDigest,
  proofCheckStateKey,
  proofCheckStateSnapshot,
} from "../../../src/proof-check/kernel/state-key";
import { createProofCheckState, emptyProofCheckState } from "../../../src/proof-check/kernel/state";
import {
  activeFactForTest,
  consumedPlaceForTest,
  exclusiveLoanForTest,
  movedPlaceForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  privateGenerationForTest,
  proofCheckStateForTest,
  proofCheckStateSnapshotForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";

function capabilityStateForTest(capabilityKey: string) {
  return {
    capabilityKey,
    capabilityKind: capabilityKey,
  };
}

const PROOF_CHECK_STATE_MAPS = [
  "places",
  "loans",
  "obligations",
  "sessions",
  "validations",
  "attempts",
  "facts",
  "privateState",
  "layout",
  "packetSources",
  "capabilities",
  "terminal",
  "divergence",
  "erasures",
] as const;

function expectSortedKeys(keys: readonly string[]): void {
  expect([...keys]).toEqual(
    [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

describe("ProofCheckState shape", () => {
  test("ProofCheckState exposes exactly the closed checker state maps", () => {
    const state = emptyProofCheckState();
    expect(Object.keys(state).sort()).toEqual([...PROOF_CHECK_STATE_MAPS].sort());
  });

  test("public state objects are frozen at the boundary", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("fact:a")],
    });

    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe("proofCheckStateKey", () => {
  test("state key ignores map insertion order", () => {
    const first = proofCheckStateForTest({
      facts: [activeFactForTest("fact:b"), activeFactForTest("fact:a")],
    });
    const second = proofCheckStateForTest({
      facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
    });

    expect(proofCheckStateKey(first)).toBe(proofCheckStateKey(second));
    expect(proofCheckStateSnapshot(first)).toEqual(proofCheckStateSnapshot(second));
  });

  test("proofCheckStateKey sorts every map by stable component keys", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("place:z"), ownedPlaceForTest("place:a")],
      loans: [exclusiveLoanForTest("loan:z"), exclusiveLoanForTest("loan:a")],
      obligations: [obligationStateForTest("obligation:z"), obligationStateForTest("obligation:a")],
      sessions: [streamSessionForTest("session:z"), streamSessionForTest("session:a")],
      facts: [activeFactForTest("fact:z"), activeFactForTest("fact:a")],
      privateState: [
        privateGenerationForTest("cell:z", "generation:2"),
        privateGenerationForTest("cell:a", "generation:1"),
      ],
      packetSources: [
        packetSourceForTest("packet:z", "source:z"),
        packetSourceForTest("packet:a", "source:a"),
      ],
      capabilities: [
        capabilityStateForTest("capability:z"),
        capabilityStateForTest("capability:a"),
      ],
    });

    const componentKeys = proofCheckStateComponentKeys(state);
    expect(componentKeys.places).toEqual(["place:a", "place:z"]);
    expect(componentKeys.loans).toEqual(["loan:loan:a", "loan:loan:z"]);
    expect(componentKeys.obligations).toEqual(["obligation:a", "obligation:z"]);
    expect(componentKeys.sessions).toEqual(["session:a", "session:z"]);
    expect(componentKeys.facts).toEqual(["fact:a", "fact:z"]);
    expect(componentKeys.privateState).toEqual(["cell:a", "cell:z"]);
    expect(componentKeys.packetSources).toEqual(["packet:a->source:a", "packet:z->source:z"]);
    expect(componentKeys.capabilities).toEqual(["capability:a", "capability:z"]);
  });

  test("equal states with different construction order share digest and snapshot", () => {
    const left = createProofCheckState({
      places: [movedPlaceForTest("buffer"), ownedPlaceForTest("packet")],
      obligations: [
        streamMemberObligationForTest("member:b", "session:b"),
        streamMemberObligationForTest("member:a", "session:a"),
      ],
    });
    const right = createProofCheckState({
      obligations: [
        streamMemberObligationForTest("member:a", "session:a"),
        streamMemberObligationForTest("member:b", "session:b"),
      ],
      places: [ownedPlaceForTest("packet"), movedPlaceForTest("buffer")],
    });

    expect(proofCheckStateDigest(left)).toBe(proofCheckStateDigest(right));
    expect(proofCheckStateKey(left)).toBe(proofCheckStateKey(right));
    expect(proofCheckStateSnapshot(left)).toEqual(proofCheckStateSnapshot(right));
  });

  test("different states produce different keys", () => {
    const owned = proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] });
    const consumed = proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] });

    expect(proofCheckStateKey(owned)).not.toBe(proofCheckStateKey(consumed));
  });
});

describe("proofCheckStateSnapshot", () => {
  test("snapshot emits compact canonical summaries without object identity", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
      loans: [exclusiveLoanForTest("buffer.header")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
      sessions: [streamSessionForTest("session:a")],
      facts: [activeFactForTest("fact:a")],
      privateState: [privateGenerationForTest("cell", "generation:2")],
      packetSources: [packetSourceForTest("packet", "source")],
      capabilities: [capabilityStateForTest("capability:tx")],
    });

    const snapshot = proofCheckStateSnapshot(state);

    expect(snapshot).toEqual({
      stateKey: proofCheckStateKey(state),
      livePlaces: ["packet"],
      movedOrConsumedPlaces: ["packet.payload"],
      loans: ["loan:buffer.header"],
      obligations: ["member:a"],
      sessions: ["session:a"],
      validations: [],
      attempts: [],
      facts: ["fact:a"],
      privateStateGenerations: ["cell:generation:2"],
      capabilities: ["capability:tx"],
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      "attempts",
      "capabilities",
      "facts",
      "livePlaces",
      "loans",
      "movedOrConsumedPlaces",
      "obligations",
      "privateStateGenerations",
      "sessions",
      "stateKey",
      "validations",
    ]);
  });

  test("proofCheckStateSnapshotForTest wraps the canonical snapshot helper", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    expect(proofCheckStateSnapshotForTest(state)).toEqual(proofCheckStateSnapshot(state));
  });

  test("snapshot summary arrays are sorted by stable component keys", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("fact:z"), activeFactForTest("fact:a")],
      capabilities: [
        capabilityStateForTest("capability:z"),
        capabilityStateForTest("capability:a"),
      ],
    });

    const snapshot = proofCheckStateSnapshot(state);
    expectSortedKeys(snapshot.facts);
    expectSortedKeys(snapshot.capabilities);
  });
});

describe("state immutability", () => {
  test("returned state is frozen and rebuilt maps are independent copies", () => {
    const first = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const second = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });

    expect(Object.isFrozen(first)).toBe(true);
    expect(first.facts).not.toBe(second.facts);
    expect([...first.facts.entries()]).toEqual([...second.facts.entries()]);
  });

  test("mutating a returned state map via cast throws or leaves the state key unchanged", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const keyBefore = proofCheckStateKey(state);
    const mutableFacts = state.facts as Map<string, ReturnType<typeof activeFactForTest>>;

    expect(() => {
      mutableFacts.set("fact:b", activeFactForTest("fact:b"));
    }).toThrow();

    expect(proofCheckStateKey(state)).toBe(keyBefore);
    expect(state.facts.has("fact:b")).toBe(false);
  });

  test("returned state maps are sealed read-only views", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });

    expect(state.facts).not.toBeInstanceOf(Map);
    expect(Object.isFrozen(state.facts)).toBe(true);
  });
});

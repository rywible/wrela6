import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  PROOF_CHECK_PATCH_KINDS,
  PROOF_CHECK_STATE_PATCH_ENTRY_KINDS,
  proofCheckPatchKind,
  type ProofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
  type ProofCheckStatePatchInput,
} from "../../../src/proof-check/kernel/state-patch";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import { proofMirPlaceId } from "../../../src/proof-mir/ids";
import {
  activeFactForTest,
  consumedPlaceForTest,
  movedPlaceForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  privateGenerationForTest,
  proofCheckStateForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

export function proofCheckStatePatchForTest(
  input: ProofCheckStatePatchInput,
): ProofCheckStatePatch<ProofCheckPatchKind> {
  return {
    kind: proofCheckPatchKind(input.kind),
    transitionId: input.transitionId ?? proofCheckTransitionId(1),
    certificate: input.certificate ?? defaultCertificate,
    entries: input.entries ?? [],
    ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
  };
}

function placeStateEntry(
  placeKey: string,
  lifecycle: "owned" | "moved" | "consumed" | "uninitialized" | "proofOnlyErased",
): ProofCheckStatePatchEntry {
  return {
    kind: "placeState",
    place: proofMirPlaceId(0),
    state: { placeKey, lifecycle },
  };
}

function capabilityStateForTest(capabilityKey: string) {
  return {
    capabilityKey,
    capabilityKind: capabilityKey,
  };
}

describe("ProofCheckPatchKind", () => {
  test("ProofCheckPatchKind is exactly the closed companion and core patch kinds", () => {
    expect([...PROOF_CHECK_PATCH_KINDS].sort()).toEqual([
      "coreTransfer",
      "crossCoreOwnership",
      "extensionTransfer",
      "loopConvergence",
      "stateJoin",
      "streamLoop",
      "terminalClosure",
      "yieldResume",
    ]);
  });

  test("proofCheckPatchKind rejects unknown patch kinds", () => {
    expect(() => proofCheckPatchKind("not-a-patch-kind")).toThrow("Unknown proof-check patch kind");
  });
});

describe("ProofCheckStatePatchEntry", () => {
  test("ProofCheckStatePatchEntry is exactly the closed entry kind list", () => {
    expect([...PROOF_CHECK_STATE_PATCH_ENTRY_KINDS].sort()).toEqual([
      "attempt",
      "capability",
      "divergence",
      "erasure",
      "fact",
      "layout",
      "loan",
      "obligation",
      "packetSource",
      "placeState",
      "privateState",
      "session",
      "terminal",
      "validation",
    ]);
  });
});

describe("reduceProofCheckState permission validation", () => {
  test("cross-core companion patch cannot close an unrelated obligation", () => {
    const state = proofCheckStateForTest({
      obligations: [obligationStateForTest("obligation:rx")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "crossCoreOwnership",
      entries: [
        {
          kind: "obligation",
          action: "close",
          obligation: obligationStateForTest("obligation:rx"),
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_STATE_PATCH"),
    );
    expect(proofCheckStateKey(result.state)).toBe(proofCheckStateKey(state));
  });

  test("yield/resume patch rejects ownership changes", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "yieldResume",
      entries: [placeStateEntry("packet", "moved")],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("placeState:not-allowed");
  });

  test("yield/resume patch rejects capability production", () => {
    const state = proofCheckStateForTest();
    const patch = proofCheckStatePatchForTest({
      kind: "yieldResume",
      entries: [
        {
          kind: "capability",
          action: "produce",
          capability: capabilityStateForTest("capability:tx"),
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("entry:capability:not-allowed");
  });

  test("terminal closure patch rejects every entry kind", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const patch = proofCheckStatePatchForTest({
      kind: "terminalClosure",
      entries: [{ kind: "fact", action: "drop", fact: activeFactForTest("fact:a") }],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("terminalClosure");
  });

  test("state join rejects loan changes", () => {
    const state = proofCheckStateForTest();
    const patch = proofCheckStatePatchForTest({
      kind: "stateJoin",
      entries: [
        {
          kind: "loan",
          action: "open",
          loan: { loanKey: "loan:buffer", mode: "exclusive", placeKey: "buffer" },
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("loan:not-allowed");
  });

  test("state join rejects private-state advance", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "stateJoin",
      entries: [
        {
          kind: "privateState",
          advance: {
            placeKey: "cell",
            previous: "generation:1",
            next: "generation:2",
            transitionKey: "loop:header",
          },
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("entry:privateState:not-allowed");
  });

  test("loop convergence allows private-state advance for loop-carried keys", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "loopConvergence",
      constraints: { loopCarriedPrivateStateKeys: ["cell"] },
      entries: [
        {
          kind: "privateState",
          advance: {
            placeKey: "cell",
            previous: "generation:1",
            next: "generation:2",
            transitionKey: "loop:header",
          },
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.privateState.get("cell")?.generationKey).toBe("generation:2");
  });

  test("stream-loop patch cannot close an unrelated obligation", () => {
    const state = proofCheckStateForTest({
      obligations: [streamMemberObligationForTest("member:other", "session:rx")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "streamLoop",
      constraints: { namedYieldedMemberKey: "member:yielded" },
      entries: [
        {
          kind: "obligation",
          action: "close",
          obligation: {
            obligationKey: "member:other",
            status: "closed",
            sessionKey: "session:rx",
            memberKey: "member:other",
          },
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("not-named-member");
  });

  test("extension transfer rejects entry kinds outside the selected schema", () => {
    const state = proofCheckStateForTest();
    const patch = proofCheckStatePatchForTest({
      kind: "extensionTransfer",
      constraints: { allowedExtensionEntryKinds: ["fact"] },
      entries: [
        {
          kind: "capability",
          action: "produce",
          capability: capabilityStateForTest("capability:ext"),
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-extension-schema");
  });

  test("companion patch rejects fact drops outside the dependency set", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("fact:keep"), activeFactForTest("fact:drop")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "yieldResume",
      constraints: { allowedDropFactKeys: ["fact:drop"] },
      entries: [{ kind: "fact", action: "drop", fact: activeFactForTest("fact:keep") }],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-dependency-set");
  });

  test("cross-core patch rejects capability production outside transfer schema", () => {
    const state = proofCheckStateForTest();
    const patch = proofCheckStatePatchForTest({
      kind: "crossCoreOwnership",
      entries: [
        {
          kind: "capability",
          action: "produce",
          capability: capabilityStateForTest("capability:rx"),
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("capability-action:produce:not-allowed");
  });

  test("companion patch rejects manufactured ownership", () => {
    const state = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "stateJoin",
      entries: [placeStateEntry("buffer", "owned")],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("manufactured-ownership:buffer");
  });
});

describe("reduceProofCheckState core transfer application", () => {
  test("core transfer applies fact and place-state entries", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
      facts: [activeFactForTest("fact:old")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "coreTransfer",
      entries: [
        { kind: "fact", action: "add", fact: activeFactForTest("fact:new") },
        { kind: "fact", action: "drop", fact: activeFactForTest("fact:old") },
        placeStateEntry("packet", "moved"),
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.facts.has("fact:new")).toBe(true);
    expect(result.state.facts.has("fact:old")).toBe(false);
    expect(result.state.places.get("packet")?.lifecycle).toBe("moved");
  });

  test("core transfer rejects manufactured ownership for unknown places", () => {
    const state = proofCheckStateForTest();
    const patch = proofCheckStatePatchForTest({
      kind: "coreTransfer",
      entries: [placeStateEntry("buffer", "owned")],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("manufactured-ownership:buffer");
  });
});

describe("reduceProofCheckState companion join application", () => {
  test("state join can drop facts and intersect packet sources", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
      packetSources: [
        packetSourceForTest("packet", "source:a"),
        packetSourceForTest("packet", "source:b"),
      ],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "stateJoin",
      constraints: {
        allowedDropFactKeys: ["fact:b"],
        allowedPacketSourceKeys: ["packet->source:a"],
      },
      entries: [
        { kind: "fact", action: "drop", fact: activeFactForTest("fact:b") },
        {
          kind: "packetSource",
          packetSource: packetSourceForTest("packet", "source:a"),
        },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.facts.has("fact:a")).toBe(true);
    expect(result.state.facts.has("fact:b")).toBe(false);
    expect(result.state.packetSources.has("packet->source:a")).toBe(true);
    expect(result.state.packetSources.has("packet->source:b")).toBe(true);
  });

  test("state join can weaken place state to a core meet", () => {
    const state = proofCheckStateForTest({
      places: [movedPlaceForTest("packet")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "stateJoin",
      entries: [placeStateEntry("packet", "moved")],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.places.get("packet")?.lifecycle).toBe("moved");
  });

  test("stream-loop patch closes the named yielded member and drops member-local facts", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:yielded", "session:rx")],
      facts: [activeFactForTest("fact:member-local")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "streamLoop",
      constraints: {
        namedYieldedMemberKey: "member:yielded",
        allowedDropFactKeys: ["fact:member-local"],
      },
      entries: [
        {
          kind: "obligation",
          action: "close",
          obligation: {
            obligationKey: "member:yielded",
            status: "closed",
            sessionKey: "session:rx",
            memberKey: "member:yielded",
          },
        },
        { kind: "fact", action: "drop", fact: activeFactForTest("fact:member-local") },
        { kind: "session", action: "close", session: streamSessionForTest("session:rx") },
      ],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.obligations.get("member:yielded")?.status).toBe("closed");
    expect(result.state.facts.has("fact:member-local")).toBe(false);
    expect(result.state.sessions.has("session:rx")).toBe(false);
  });
});

describe("reduceProofCheckState error determinism", () => {
  test("error results return unchanged input state", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
      facts: [activeFactForTest("fact:a")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "yieldResume",
      entries: [placeStateEntry("packet", "moved")],
    });

    const result = reduceProofCheckState(state, patch);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.state).toBe(state);
    expect(result.state.facts.has("fact:a")).toBe(true);
    expect(result.state.places.get("packet")?.lifecycle).toBe("owned");
  });

  test("diagnostics are deterministic for the same invalid patch", () => {
    const state = proofCheckStateForTest({
      obligations: [obligationStateForTest("obligation:rx")],
    });
    const patch = proofCheckStatePatchForTest({
      kind: "crossCoreOwnership",
      entries: [
        {
          kind: "obligation",
          action: "close",
          obligation: obligationStateForTest("obligation:rx"),
        },
      ],
    });

    const first = reduceProofCheckState(state, patch);
    const second = reduceProofCheckState(state, patch);

    expect(first).toEqual(second);
  });
});

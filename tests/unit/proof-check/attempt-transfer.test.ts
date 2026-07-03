import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkAttemptErrorEdge,
  checkAttemptSplitJoin,
  checkAttemptSuccessEdge,
  matchAttempt,
  recordAttempt,
  type AttemptSplitJoinInput,
} from "../../../src/proof-check/domains/attempts";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  activeFactForTest,
  consumedPlaceForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  privateGenerationForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  uninitializedPlaceForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

export function attemptSplitForTest(input: {
  readonly attemptKey?: string;
  readonly successState: ReturnType<typeof proofCheckStateForTest>;
  readonly errorState: ReturnType<typeof proofCheckStateForTest>;
  readonly operationOriginKey?: string;
}): AttemptSplitJoinInput {
  return {
    attemptKey: input.attemptKey ?? "attempt:test",
    successState: input.successState,
    errorState: input.errorState,
    ...(input.operationOriginKey !== undefined
      ? { operationOriginKey: input.operationOriginKey }
      : {}),
  };
}

describe("recordAttempt", () => {
  test("attempt records declared input places and one pending result", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer"), ownedPlaceForTest("context")],
    });

    const result = recordAttempt({
      state,
      attemptKey: "attempt:fallible",
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      operationOriginKey: "operation:attempt:record",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "attempt",
        action: "open",
        attempt: {
          attemptKey: "attempt:fallible",
          status: "pending",
        },
      },
    ]);

    const reduced = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2801),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;
    expect(reduced.state.attempts.get("attempt:fallible")).toEqual({
      attemptKey: "attempt:fallible",
      status: "pending",
    });
  });

  test("recordAttempt rejects undeclared inputs that are not usable", () => {
    const state = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });

    const result = recordAttempt({
      state,
      attemptKey: "attempt:fallible",
      declaredInputs: [proofCheckPlaceForTest("buffer")],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ATTEMPT_SPLIT"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("buffer");
  });

  test("recordAttempt initializes the pending result place from known uninitialized state", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer"), uninitializedPlaceForTest("proofMirPlace:7")],
    });

    const result = recordAttempt({
      state,
      attemptKey: "attempt:fallible",
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      pendingResultPlace: proofCheckPlaceForTest("proofMirPlace:7"),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toContainEqual({
      kind: "placeState",
      place: expect.any(Number),
      state: { placeKey: "proofMirPlace:7", lifecycle: "owned" },
    });
  });
});

describe("matchAttempt", () => {
  test("matchAttempt consumes a pending attempt result exactly once", () => {
    const state = proofCheckStateForTest({
      attempts: [{ attemptKey: "attempt:fallible", status: "pending" }],
    });

    const result = matchAttempt({
      state,
      attemptKey: "attempt:fallible",
      operationOriginKey: "operation:attempt:match",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches[0]).toEqual({
      kind: "attempt",
      action: "consume",
      attempt: {
        attemptKey: "attempt:fallible",
        status: "consumed",
      },
    });
  });

  test("matchAttempt rejects missing pending results", () => {
    const result = matchAttempt({
      state: proofCheckStateForTest(),
      attemptKey: "attempt:missing",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ATTEMPT_SPLIT"),
    );
  });
});

describe("checkAttemptSuccessEdge", () => {
  test("success edge may consume only declared affine inputs", () => {
    const originalState = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer"), ownedPlaceForTest("context")],
    });
    const armState = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer"), ownedPlaceForTest("context")],
    });

    const accepted = checkAttemptSuccessEdge({
      originalState,
      armState,
      declaredInputs: [proofCheckPlaceForTest("buffer")],
    });
    expect(accepted.kind).toBe("ok");

    const rejected = checkAttemptSuccessEdge({
      originalState,
      armState: proofCheckStateForTest({
        places: [consumedPlaceForTest("buffer"), consumedPlaceForTest("context")],
      }),
      declaredInputs: [proofCheckPlaceForTest("buffer")],
    });
    expect(rejected.kind).toBe("error");
    if (rejected.kind !== "error") return;
    expect(rejected.diagnostics[0]?.rootCauseKey).toBe("context");
  });

  test("success edge allows declared input and internal pending result consumption only", () => {
    const originalState = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("buffer"),
        ownedPlaceForTest("attempt.result"),
        ownedPlaceForTest("context"),
      ],
    });

    const accepted = checkAttemptSuccessEdge({
      originalState,
      armState: proofCheckStateForTest({
        places: [
          consumedPlaceForTest("buffer"),
          consumedPlaceForTest("attempt.result"),
          ownedPlaceForTest("context"),
        ],
      }),
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      internalConsumedPlaces: [proofCheckPlaceForTest("attempt.result")],
    });
    expect(accepted.kind).toBe("ok");

    const rejected = checkAttemptSuccessEdge({
      originalState,
      armState: proofCheckStateForTest({
        places: [
          consumedPlaceForTest("buffer"),
          consumedPlaceForTest("attempt.result"),
          consumedPlaceForTest("context"),
        ],
      }),
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      internalConsumedPlaces: [proofCheckPlaceForTest("attempt.result")],
    });
    expect(rejected.kind).toBe("error");
    if (rejected.kind !== "error") return;
    expect(rejected.diagnostics[0]?.rootCauseKey).toBe("context");
  });
});

describe("checkAttemptErrorEdge", () => {
  test("error edge starts from the original input state", () => {
    const originalState = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });

    const accepted = checkAttemptErrorEdge({
      originalState,
      edgeState: originalState,
      declaredInputs: [proofCheckPlaceForTest("buffer")],
    });
    expect(accepted.kind).toBe("ok");

    const rejected = checkAttemptErrorEdge({
      originalState,
      edgeState: proofCheckStateForTest({
        places: [consumedPlaceForTest("buffer")],
      }),
      declaredInputs: [proofCheckPlaceForTest("buffer")],
    });
    expect(rejected.kind).toBe("error");
    if (rejected.kind !== "error") return;
    expect(rejected.diagnostics[0]?.rootCauseKey).toBe("buffer");
  });
});

describe("checkAttemptSplitJoin", () => {
  test("attempt success consuming input while error leaves input live requires repair", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] }),
        errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("buffer");
  });

  test("a place is usable after the match only when both paths leave it usable", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] }),
        errorState: proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
  });

  test("attempt error path cannot silently drop live capabilities", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({
          places: [ownedPlaceForTest("firmware-phase")],
        }),
        errorState: proofCheckStateForTest({
          places: [consumedPlaceForTest("firmware-phase")],
        }),
        operationOriginKey: "operation:attempt:error-path-capability-drop",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("firmware-phase");
  });

  test("success and error arms repaired to the same output shape join exactly", () => {
    const sharedState = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
      facts: [activeFactForTest("fact:shared")],
    });

    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: sharedState,
        errorState: sharedState,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.meetKind).toBe("exact");
  });

  test("diagnostics name the first divergent fact", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
          facts: [activeFactForTest("fact:success-only")],
        }),
        errorState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
          facts: [activeFactForTest("fact:error-only")],
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.meetKind).toBe("coreMeet");
    expect(result.joinedState.facts.has("fact:success-only")).toBe(false);
    expect(result.joinedState.facts.has("fact:error-only")).toBe(false);
  });

  test("diagnostics name the first divergent packet source", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
          packetSources: [packetSourceForTest("packet", "source")],
        }),
        errorState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("packet->source");
  });

  test("diagnostics name the first divergent private-state generation", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        successState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
          privateState: [privateGenerationForTest("cell", "generation:2")],
        }),
        errorState: proofCheckStateForTest({
          places: [consumedPlaceForTest("buffer")],
          privateState: [privateGenerationForTest("cell", "generation:1")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("cell");
  });
});

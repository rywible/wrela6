import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  applySummaryPlaceEffect,
  checkUsePlace,
  observeCopyPlace,
  transferAssignPlace,
  transferConsumePlace,
  transferMovePlace,
} from "../../../src/proof-check/domains/ownership";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import {
  activeFactForTest,
  exclusiveLoanForTest,
  movedPlaceForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForState,
  uninitializedPlaceForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

describe("checkUsePlace", () => {
  test("whole object use fails after moving one linear field", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
    });

    const result = checkUsePlace({ state, place: proofCheckPlaceForTest("packet") });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });

  test("disjoint field use succeeds after moving another field", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer.header"), movedPlaceForTest("buffer.payload")],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
    });

    expect(result.kind).toBe("ok");
  });

  test("field use fails when aggregate root is moved", () => {
    const state = proofCheckStateForTest({
      places: [movedPlaceForTest("packet"), ownedPlaceForTest("packet.payload")],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("packet.payload"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });

  test("use of consumed place reports use after consume", () => {
    const state = proofCheckStateForTest({
      places: [{ placeKey: "buffer", lifecycle: "consumed" }],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("buffer"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_CONSUME"),
    );
  });

  test("use of uninitialized place is rejected", () => {
    const state = proofCheckStateForTest({
      places: [uninitializedPlaceForTest("tmp")],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("tmp"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });

  test("whole object use conflicts with live loan below it", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("packet.payload")],
      places: [ownedPlaceForTest("packet")],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("packet"),
      operationOriginKey: "origin:use:packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
  });
});

describe("transferMovePlace", () => {
  test("moving a field marks the aggregate unavailable and destination owned", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("packet"),
        ownedPlaceForTest("packet.payload"),
        uninitializedPlaceForTest("dest"),
      ],
      facts: [activeFactForTest("place:packet.payload:brand")],
    });

    const result = transferMovePlace({
      state,
      source: proofCheckPlaceForTest("packet.payload"),
      destination: proofCheckPlaceForTest("dest"),
      operationOriginKey: "origin:move:payload",
      placeResolver: testPlaceResolverForState(state),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("ownership")),
    ).toBe(true);
    expect(result.certificates.length).toBeGreaterThan(0);

    const nextState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(23),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(nextState.kind).toBe("ok");
    if (nextState.kind !== "ok") return;
    expect(nextState.state.places.get("packet.payload")?.lifecycle).toBe("moved");
    expect(nextState.state.places.get("packet")?.lifecycle).toBe("moved");
    expect(nextState.state.places.get("dest")?.lifecycle).toBe("owned");
    expect(nextState.state.facts.has("place:packet.payload:brand")).toBe(false);
    expect(nextState.state.facts.has("place:dest:brand")).toBe(true);
  });

  test("move rejects source that is already moved", () => {
    const state = proofCheckStateForTest({
      places: [movedPlaceForTest("buffer"), uninitializedPlaceForTest("dest")],
    });

    const result = transferMovePlace({
      state,
      source: proofCheckPlaceForTest("buffer"),
      destination: proofCheckPlaceForTest("dest"),
      operationOriginKey: "origin:move:buffer",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });
});

describe("observeCopyPlace and transferConsumePlace", () => {
  test("copy resources can be observed without changing place state", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("count")],
    });

    const result = observeCopyPlace({
      state,
      place: proofCheckPlaceForTest("count"),
      resourceKind: "Copy",
      operationOriginKey: "origin:observe:count",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([]);
  });

  test("consuming affine resources removes active type-intrinsic facts", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("token")],
      facts: [activeFactForTest("place:token:sealed")],
    });

    const result = transferConsumePlace({
      state,
      place: proofCheckPlaceForTest("token"),
      resourceKind: "Affine",
      operationOriginKey: "origin:consume:token",
      placeResolver: testPlaceResolverForState(state),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const nextState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        entries: result.patches,
      }),
    );
    expect(nextState.kind).toBe("ok");
    if (nextState.kind !== "ok") return;
    expect(nextState.state.places.get("token")?.lifecycle).toBe("consumed");
    expect(nextState.state.facts.has("place:token:sealed")).toBe(false);
  });

  test("consuming contract replacement facts are preserved", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("source")],
      facts: [activeFactForTest("place:source:brand")],
    });

    const result = transferConsumePlace({
      state,
      place: proofCheckPlaceForTest("source"),
      resourceKind: "Linear",
      operationOriginKey: "origin:consume:source",
      replacementFacts: [activeFactForTest("place:result:brand")],
      placeResolver: testPlaceResolverForState(state),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const nextState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        entries: result.patches,
      }),
    );
    expect(nextState.kind).toBe("ok");
    if (nextState.kind !== "ok") return;
    expect(nextState.state.facts.has("place:result:brand")).toBe(true);
  });
});

describe("transferAssignPlace and applySummaryPlaceEffect", () => {
  test("copy assignment observes without move patches", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("src"), ownedPlaceForTest("dest")],
    });

    const result = transferAssignPlace({
      state,
      source: proofCheckPlaceForTest("src"),
      destination: proofCheckPlaceForTest("dest"),
      resourceKind: "Copy",
      operationOriginKey: "origin:assign:copy",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([]);
  });

  test("source-call consume effect delegates to consume transfer", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("arg")],
    });

    const result = applySummaryPlaceEffect({
      state,
      place: proofCheckPlaceForTest("arg"),
      resourceKind: "Linear",
      mode: "consume",
      operationOriginKey: "origin:call:consume-arg",
      placeResolver: testPlaceResolverForState(state),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "placeState")).toBe(true);
  });

  test("source-call observe effect checks ownership without changing affine place state", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("arg")],
    });

    const result = applySummaryPlaceEffect({
      state,
      place: proofCheckPlaceForTest("arg"),
      resourceKind: "Affine",
      mode: "observe",
      operationOriginKey: "origin:call:observe-arg",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([]);
  });
});

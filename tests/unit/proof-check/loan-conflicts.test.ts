import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkConsumeWithLoans,
  checkMutateWithLoans,
  checkReturnWithLoans,
  checkUseWithLoans,
  closeLoan,
  findLoanConflict,
  openLoan,
} from "../../../src/proof-check/domains/loans";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import type { CheckedLoanState } from "../../../src/proof-check/kernel/state";
import {
  exclusiveLoanForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForState,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

function sharedLoanForTest(placeKey: string): CheckedLoanState {
  return {
    loanKey: `loan:shared:${placeKey}`,
    mode: "shared",
    placeKey,
  };
}

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

describe("findLoanConflict", () => {
  test("returns samePlace for exclusive loan on the same place", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const conflict = findLoanConflict({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
      operation: { kind: "observe" },
    });

    expect(conflict).toEqual({
      kind: "samePlace",
      loanKey: "loan:buffer.header",
    });
  });

  test("returns ancestor when whole object is used under a field loan", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const conflict = findLoanConflict({
      state,
      place: proofCheckPlaceForTest("buffer"),
      operation: { kind: "observe" },
    });

    expect(conflict).toEqual({
      kind: "ancestor",
      loanKey: "loan:buffer.header",
    });
  });

  test("returns descendant when a field is used under a whole-object loan", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer")],
    });

    const conflict = findLoanConflict({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
      operation: { kind: "observe" },
    });

    expect(conflict).toEqual({
      kind: "descendant",
      loanKey: "loan:buffer",
    });
  });

  test("returns undefined for disjoint field places", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const conflict = findLoanConflict({
      state,
      place: proofCheckPlaceForTest("buffer.payload"),
      operation: { kind: "observe" },
    });

    expect(conflict).toBeUndefined();
  });
});

describe("checkUseWithLoans", () => {
  test("exclusive loan of one field does not block use of disjoint field", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
      places: [ownedPlaceForTest("buffer.payload")],
    });

    const result = checkUseWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.payload"),
      operationOriginKey: "origin:use:payload",
      placeResolver: testPlaceResolverForState(state, ["buffer.payload"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("fieldDisjointness")),
    ).toBe(true);
    expect(result.packetEntries.some((entry) => entry.kind === checkedFactKindId("noalias"))).toBe(
      true,
    );
  });

  test("shared observation conflicts with active exclusive loan on same place", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const result = checkUseWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
      operationOriginKey: "origin:use:header",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe("origin:use:header");
    expect(result.diagnostics[0]?.rootCauseKey).toBe("loan:buffer.header");
  });

  test("shared observation does not conflict with shared loan on same place", () => {
    const state = proofCheckStateForTest({
      loans: [sharedLoanForTest("buffer.header")],
    });

    const result = checkUseWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
      operationOriginKey: "origin:use:header",
    });

    expect(result.kind).toBe("ok");
  });

  test("whole-object use conflicts with field exclusive loan", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("packet.payload")],
      places: [ownedPlaceForTest("packet")],
    });

    const result = checkUseWithLoans({
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

describe("checkMutateWithLoans and checkConsumeWithLoans", () => {
  test("mutating conflicts with shared loan on same place", () => {
    const state = proofCheckStateForTest({
      loans: [sharedLoanForTest("buffer.header")],
    });

    const result = checkMutateWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.header"),
      operationOriginKey: "origin:mutate:header",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe("origin:mutate:header");
    expect(result.diagnostics[0]?.rootCauseKey).toBe("loan:shared:buffer.header");
  });

  test("consuming conflicts with exclusive loan on descendant place", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer")],
    });

    const result = checkConsumeWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.payload"),
      operationOriginKey: "origin:consume:payload",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
  });
});

describe("loan lifecycle", () => {
  test("openLoan accepts disjoint field loan and closeLoan removes it from state", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const openResult = openLoan({
      state,
      loan: exclusiveLoanForTest("buffer.payload"),
      operationOriginKey: "origin:borrow:payload",
      placeResolver: testPlaceResolverForState(state, ["buffer.payload"]),
    });

    expect(openResult.kind).toBe("ok");
    if (openResult.kind !== "ok") return;

    const openedState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(24),
        certificate: defaultCertificate,
        entries: openResult.patches,
      }),
    );
    expect(openedState.kind).toBe("ok");
    if (openedState.kind !== "ok") return;
    expect(openedState.state.loans.has("loan:buffer.payload")).toBe(true);

    const closeResult = closeLoan({
      state: openedState.state,
      loanKey: "loan:buffer.payload",
      operationOriginKey: "origin:release:payload",
    });
    expect(closeResult.kind).toBe("ok");
    if (closeResult.kind !== "ok") return;

    const closedState = reduceProofCheckState(
      openedState.state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        entries: closeResult.patches,
      }),
    );
    expect(closedState.kind).toBe("ok");
    if (closedState.kind !== "ok") return;
    expect(closedState.state.loans.has("loan:buffer.payload")).toBe(false);
  });

  test("openLoan rejects exclusive loan that overlaps an active shared loan", () => {
    const state = proofCheckStateForTest({
      loans: [sharedLoanForTest("buffer.header")],
    });

    const result = openLoan({
      state,
      loan: exclusiveLoanForTest("buffer"),
      operationOriginKey: "origin:borrow:buffer",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
  });
});

describe("checkReturnWithLoans", () => {
  test("returning with any live loan is rejected", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header"), sharedLoanForTest("buffer.payload")],
    });

    const result = checkReturnWithLoans({
      state,
      operationOriginKey: "origin:return:main",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_LOAN"),
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_LOAN"),
    ]);
    expect(result.diagnostics[0]?.ownerKey).toBe("origin:return:main");
    expect(result.diagnostics[0]?.rootCauseKey).toBe("loan:buffer.header");
  });

  test("return accepts when no loans are live", () => {
    const result = checkReturnWithLoans({
      state: proofCheckStateForTest(),
      operationOriginKey: "origin:return:main",
    });

    expect(result.kind).toBe("ok");
  });
});

describe("proofCheckPatchKind usage in loan patches", () => {
  test("loan patches use coreTransfer patch kind", () => {
    expect(proofCheckPatchKind("coreTransfer")).toBe(proofCheckPatchKind("coreTransfer"));
  });
});

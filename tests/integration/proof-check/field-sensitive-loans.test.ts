import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { checkReturnWithLoans, checkUseWithLoans } from "../../../src/proof-check/domains/loans";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import {
  exclusiveLoanForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForState,
} from "../../support/proof-check/state-fixtures";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";

describe("field-sensitive loans integration", () => {
  test("disjoint field use while another field is loaned succeeds with noalias facts", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
      places: [ownedPlaceForTest("buffer.payload")],
    });

    const result = checkUseWithLoans({
      state,
      place: proofCheckPlaceForTest("buffer.payload"),
      operationOriginKey: "integration:use:payload",
      placeResolver: testPlaceResolverForState(state),
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

  test("whole-object use with field loan is rejected end to end", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("packet.payload")],
      places: [ownedPlaceForTest("packet")],
    });

    const result = checkUseWithLoans({
      state,
      place: proofCheckPlaceForTest("packet"),
      operationOriginKey: "integration:use:packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_CONFLICTING_LOAN",
        ownerKey: "integration:use:packet",
        rootCauseKey: "loan:packet.payload",
      },
    ]);
  });

  test("live loan return is rejected with deterministic diagnostic order", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const result = checkReturnWithLoans({
      state,
      operationOriginKey: "integration:return:main",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_LOAN"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_LOAN",
        ownerKey: "integration:return:main",
        rootCauseKey: "loan:buffer.header",
      },
    ]);
  });
});

describe("field-sensitive loans public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
  });

  test("live loan return rejects at domain layer with deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      loans: [exclusiveLoanForTest("buffer.header")],
    });

    const result = checkReturnWithLoans({
      state,
      operationOriginKey: "integration:public-api:live-loan-return",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_LOAN",
        ownerKey: "integration:public-api:live-loan-return",
        rootCauseKey: "loan:buffer.header",
      },
    ]);
  });

  test("live loan return fixture rejects through public checker when invalidCase is wired", () => {
    const result = checkProofAndResourcesForClosedFixture({ invalidCase: "live-loan-return" });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_LOAN"),
    );
  });
});

import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  buildCheckedFunctionSummary,
  checkSourceCallTransfer,
  resetCheckedFunctionSummaryCertificateIdsForTest,
  resetCheckedSummaryInstantiationCertificateIdsForTest,
} from "../../../src/proof-check/domains/source-calls";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import {
  activeFactForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  checkedFunctionForTest,
  summaryFactForTest,
} from "../../unit/proof-check/source-call-summaries.test";
import { proofCheckProgramWithSourceCall } from "../../unit/proof-check/source-call-transfer.test";

beforeEach(() => {
  resetCheckedFunctionSummaryCertificateIdsForTest();
  resetCheckedSummaryInstantiationCertificateIdsForTest();
  resetProofCheckCoreCertificateIdsForTest();
});

describe("source-call summary export integration", () => {
  test("checked callee summary exports parameter-bound returned fact after clean exit", () => {
    const returnedFactKey = normalizeProofCheckTerm(
      comparisonTerm(valueTerm("result"), "le", valueTerm("argument:0")),
    ).key;
    const checked = checkedFunctionForTest({
      functionInstanceId: monoInstanceId("callee"),
      declaredRequirements: [comparisonTerm(valueTerm("argument:0"), "le", literalInt(8n))],
      normalReturnExitStates: [
        proofCheckStateForTest({ facts: [activeFactForTest(returnedFactKey)] }),
      ],
      returnFactCandidates: [
        summaryFactForTest({ key: returnedFactKey, dependsOnParameter: 0, dependsOnResult: true }),
      ],
      observedInputs: [{ kind: "observes", placeKey: "argument:0" }],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.summary.functionInstanceId).toBe(monoInstanceId("callee"));
    expect(result.summary.returnedFacts).toEqual([{ termKey: returnedFactKey }]);
    expect(result.summary.observedInputs.length).toBe(1);
  });

  test("summary export integration rejects unclean return state before import", () => {
    const checked = checkedFunctionForTest({
      normalReturnExitStates: [
        proofCheckStateForTest({
          validations: [{ validationKey: "validation:packet", status: "live" }],
        }),
      ],
      returnFactCandidates: [],
    });

    const result = buildCheckedFunctionSummary(checked);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_VALIDATION"),
    );
  });

  test("source call import rejects missing callee preconditions before summary facts", () => {
    const transferInput = proofCheckProgramWithSourceCall({
      calleeRequiredFact: comparisonTerm(valueTerm("argument:0"), "lt", literalInt(4n)),
      callerFacts: [],
    });

    const result = checkSourceCallTransfer(transferInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe("test:source-call");
  });
});

describe("source-call summary public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.summaries.size).toBeGreaterThanOrEqual(0);
  });

  test("forged summary facts reject through public checker with deterministic order", () => {
    const result = checkProofAndResourcesForClosedFixture({ invalidCase: "forged-summary-facts" });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_OBLIGATION",
        ownerKey: "edge:function:fn:0|ownerType:none|owner:<>|fn:<>/edge:0",
        rootCauseKey: "function:fn:0|ownerType:none|owner:<>|fn:<>/000000009040",
      },
    ]);
  });

  test("certified callee summary import accepts validated-buffer success fixture", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "validated-buffer-success",
    });

    expect(result.kind).toBe("ok");
  });
});

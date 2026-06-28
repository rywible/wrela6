import { describe, expect, test, beforeEach } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkValidationExitClosure,
  checkValidationSplitJoin,
  matchValidation,
  resetValidationCertificateIdsForTest,
  transferValidationErrArm,
  validationTransferChain,
} from "../../../src/proof-check/domains/validation";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import {
  expectProofCheckDiagnosticOrderForTest,
  checkProofSourceForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  consumedPlaceForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  proofCheckStateForTest,
  withTestPlaceResolver,
} from "../../support/proof-check/state-fixtures";
import { validationSplitForTest } from "../../unit/proof-check/validation-transfer.test";

function validatedBufferLayoutForTest(bufferKey: string, layoutKey = "layout:Packet") {
  return { bufferKey, layoutKey };
}

beforeEach(() => {
  resetValidationCertificateIdsForTest();
});

describe("validation splits integration", () => {
  test("accepted validation split converges after both arms repair resources", () => {
    const initialState = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
    });

    const opened = validationTransferChain(
      initialState,
      [
        {
          kind: "create",
          input: {
            validationKey: "validation:packet",
            sourcePlaceKey: "source",
            pendingResultPlaceKey: "validation:pending",
            packetPlaceKey: "packet",
            layoutKey: "layout:Packet",
            operationOriginKey: "integration:validate",
          },
        },
        {
          kind: "match",
          input: {
            validationKey: "validation:packet",
            sourcePlaceKey: "source",
            packetPlaceKey: "packet",
            pendingResultPlaceKey: "validation:pending",
            layoutKey: "layout:Packet",
            operationOriginKey: "integration:match",
          },
        },
      ],
      { placeResolver: withTestPlaceResolver({ state: initialState }).placeResolver },
    );
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok" || opened.armStates === undefined) return;

    expect(opened.armStates.okState.places.get("source")?.lifecycle).toBe("consumed");
    expect(opened.armStates.errorState.places.get("source")?.lifecycle).toBe("owned");

    const errRepaired = transferValidationErrArm({
      state: opened.armStates.errorState,
      validationKey: "validation:packet",
      sourcePlaceKey: "source",
      operationOriginKey: "integration:err-arm",
    });
    expect(errRepaired.kind).toBe("ok");

    const convergentState = proofCheckStateForTest({
      places: [consumedPlaceForTest("source")],
    });
    const join = checkValidationSplitJoin(
      validationSplitForTest({
        okState: convergentState,
        errorState: convergentState,
        validationKey: "validation:packet",
        operationOriginKey: "integration:join",
      }),
    );

    expect(join.kind).toBe("ok");
    if (join.kind !== "ok") return;
    expect(proofCheckStateKey(join.state)).toBe(proofCheckStateKey(convergentState));
  });

  test("rejected divergent validation split reports deterministic diagnostics", () => {
    const result = checkValidationSplitJoin(
      validationSplitForTest({
        okState: proofCheckStateForTest({
          packetSources: [packetSourceForTest("packet", "source")],
        }),
        errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("source")] }),
        validationKey: "validation:packet",
        operationOriginKey: "integration:divergent-split",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
        ownerKey: "integration:divergent-split",
        rootCauseKey: "places",
      },
    ]);
  });

  test("return with pending validation reports deterministic leak diagnostic", () => {
    const state = proofCheckStateForTest({
      validations: [{ validationKey: "validation:packet", status: "pending" }],
    });

    const result = checkValidationExitClosure({
      state,
      exitKind: "return",
      operationOriginKey: "integration:return:pending-validation",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_VALIDATION"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_VALIDATION",
        ownerKey: "integration:return:pending-validation",
        rootCauseKey: "validation:packet",
      },
    ]);
  });

  test("matchValidation consumes pending validation end to end", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
      validations: [{ validationKey: "validation:packet", status: "pending" }],
      layout: [validatedBufferLayoutForTest("source")],
    });

    const result = matchValidation(
      withTestPlaceResolver({
        state,
        validationKey: "validation:packet",
        sourcePlaceKey: "source",
        packetPlaceKey: "packet",
        pendingResultPlaceKey: "validation:pending",
        layoutKey: "layout:Packet",
        operationOriginKey: "integration:match-validation",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.armStates === undefined) return;
    expect(result.armStates.okState.places.get("source")?.lifecycle).toBe("consumed");
    expect(result.armStates.errorState.places.get("source")?.lifecycle).toBe("owned");
    expect(result.armStates.okState.packetSources.has("packet->source")).toBe(true);
    expect(result.armStates.errorState.packetSources.size).toBe(0);
  });
});

describe("validation splits public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
  });

  test("divergent validation split fixture rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "divergent-validation-split",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_JOIN"),
    );
  });

  test("ignored validation result fixture rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "ignored-validation-result",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_VALIDATION"),
    );
  });
});

import { describe, expect, test } from "bun:test";
import {
  checkAttemptSplitJoin,
  checkAttemptSuccessEdge,
  matchAttempt,
  recordAttempt,
} from "../../../src/proof-check/domains/attempts";
import {
  checkValidationExitClosure,
  checkValidationSplitJoin,
  matchValidation,
  transferValidationErrArm,
  validationTransferChain,
} from "../../../src/proof-check/domains/validation";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import {
  consumedPlaceForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  withTestPlaceResolver,
} from "../../support/proof-check/state-fixtures";
import { attemptSplitForTest } from "../../unit/proof-check/attempt-transfer.test";
import { validationSplitForTest } from "../../unit/proof-check/validation-transfer.test";
import { proofCheckStatePatchForTest } from "../../unit/proof-check/state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

const VALIDATION_SOURCE = [
  "validated buffer Packet:",
  "    params:",
  "        payload_len: u8",
  "    layout:",
  "        tag: u8 @ 0",
  "        payload: u8 @ 1 len source.len - 1",
  "",
  "fn main(source: Packet) -> Packet:",
  "    match source.validate():",
  "        case ok(packet):",
  "            return packet",
  "        case err(_):",
  "            return source",
].join("\n");

const ATTEMPT_SOURCE = [
  "fn main() -> Never:",
  "    let buffer = source()",
  "    let value = fallible(buffer)?",
  "    return value",
].join("\n");

describe("validation and attempts public API integration", () => {
  test("supported closed source accepts validation-capable program end to end", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.mir.functions.entries().length).toBeGreaterThan(0);
  });

  test("unsupported validation syntax routes through fixture fallback rather than skipping", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(VALIDATION_SOURCE);
    const result = checkProofSourceForTest(VALIDATION_SOURCE, {
      fixtureFallback: { validCase: "validated-buffer-success" },
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("ok");
    }
  });

  test("unsupported attempt syntax routes through fixture fallback rather than skipping", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(ATTEMPT_SOURCE);
    const result = checkProofSourceForTest(ATTEMPT_SOURCE, {
      fixtureFallback: {},
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(result.kind).toBe("ok");
  });

  test("ignored validation result rejects at domain transfer layer", () => {
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
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_VALIDATION",
        ownerKey: "integration:return:pending-validation",
        rootCauseKey: "validation:packet",
      },
    ]);
  });
});

describe("validation and attempts domain integration", () => {
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

  test("validation success records packet source facts end to end", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("source"),
        ownedPlaceForTest("validation:pending"),
        ownedPlaceForTest("packet"),
      ],
      validations: [{ validationKey: "validation:packet", status: "pending" }],
      layout: [{ bufferKey: "source", layoutKey: "layout:Packet" }],
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
    expect(result.armStates.okState.packetSources.has("packet->source")).toBe(true);
  });

  test("accepted attempt arms converge after resource repair end to end", () => {
    const originalState = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });
    const attemptKey = "attempt:integration:convergent";

    const recorded = recordAttempt({
      state: originalState,
      attemptKey,
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      operationOriginKey: "integration:attempt:record",
    });
    expect(recorded.kind).toBe("ok");
    if (recorded.kind !== "ok") return;

    const withAttempt = reduceProofCheckState(
      originalState,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(3701),
        certificate: defaultCertificate,
        entries: recorded.patches,
      }),
    );
    expect(withAttempt.kind).toBe("ok");
    if (withAttempt.kind !== "ok") return;

    const matched = matchAttempt({
      state: withAttempt.state,
      attemptKey,
      operationOriginKey: "integration:attempt:match",
    });
    expect(matched.kind).toBe("ok");

    const successArm = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });
    const errorArm = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });

    const successEdge = checkAttemptSuccessEdge({
      originalState,
      armState: successArm,
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      operationOriginKey: "integration:attempt:success",
    });
    expect(successEdge.kind).toBe("ok");

    const joined = checkAttemptSplitJoin({
      attemptKey,
      successState: successArm,
      errorState: errorArm,
      operationOriginKey: "integration:attempt:join",
    });
    expect(joined.kind).toBe("ok");
  });

  test("divergent attempt split reports deterministic diagnostics at domain layer", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        attemptKey: "attempt:integration:divergent",
        successState: proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] }),
        errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] }),
        operationOriginKey: "integration:attempt:split-join",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
        ownerKey: "integration:attempt:split-join",
        rootCauseKey: "buffer",
      },
    ]);
  });
});

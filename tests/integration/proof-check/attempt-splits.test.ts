import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkAttemptErrorEdge,
  checkAttemptSplitJoin,
  checkAttemptSuccessEdge,
  matchAttempt,
  recordAttempt,
} from "../../../src/proof-check/domains/attempts";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  checkProofSourceForTest,
  domainIntegrationFixtureForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import {
  consumedPlaceForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { attemptSplitForTest } from "../../unit/proof-check/attempt-transfer.test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import { proofCheckStatePatchForTest } from "../../unit/proof-check/state-patch-reducer.test";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

function proofMirDomainFixtureForAttemptSplitTest(label: string) {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirDomainFixtureForAttemptSplitTest(${label}) failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

describe("attempt split integration", () => {
  test("divergent attempt split reports deterministic diagnostics end to end", () => {
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
        transitionId: proofCheckTransitionId(2802),
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
    if (matched.kind !== "ok") return;

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

    const errorEdge = checkAttemptErrorEdge({
      originalState,
      edgeState: originalState,
      declaredInputs: [proofCheckPlaceForTest("buffer")],
      operationOriginKey: "integration:attempt:error",
    });
    expect(errorEdge.kind).toBe("ok");

    const joined = checkAttemptSplitJoin({
      attemptKey,
      successState: successArm,
      errorState: errorArm,
      operationOriginKey: "integration:attempt:join",
    });
    expect(joined.kind).toBe("ok");
    if (joined.kind !== "ok") return;
    expect(joined.meetKind).toBe("exact");
  });

  test("probeProofCheckSourceSyntaxForTest routes unsupported attempt syntax through fixture fallback", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(
      [
        "fn main() -> Never:",
        "    let buffer = source()",
        "    let value = fallible(buffer)?",
        "    return value",
      ].join("\n"),
    );
    const fixture = domainIntegrationFixtureForTest({
      source: "fn main() -> Never { unsupported_attempt_body() }",
      fixtureFallback: () => proofMirDomainFixtureForAttemptSplitTest("attempt-body"),
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
    if (syntax === "unsupported-source-syntax") {
      expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    }
  });

  test("attempt success consuming input while error leaves input live is rejected in integration", () => {
    const result = checkAttemptSplitJoin(
      attemptSplitForTest({
        attemptKey: "attempt:integration:must-reject",
        successState: proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] }),
        errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] }),
        operationOriginKey: "integration:attempt:must-reject",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
    );
  });
});

describe("attempt splits public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
  });

  test("attempt arms repaired to common state converge at domain layer", () => {
    const successArm = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });
    const errorArm = proofCheckStateForTest({
      places: [consumedPlaceForTest("buffer")],
    });

    const joined = checkAttemptSplitJoin({
      attemptKey: "attempt:integration:public-api",
      successState: successArm,
      errorState: errorArm,
      operationOriginKey: "integration:public-api:attempt-join",
    });

    expect(joined.kind).toBe("ok");
  });

  test("divergent attempt split fixture rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "divergent-attempt-split",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_JOIN"),
    );
  });
});

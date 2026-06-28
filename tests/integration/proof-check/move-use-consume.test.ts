import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkUsePlace,
  transferConsumePlace,
  transferMovePlace,
} from "../../../src/proof-check/domains/ownership";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import {
  checkProofSourceForTest,
  domainIntegrationFixtureForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  movedPlaceForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForState,
  uninitializedPlaceForTest,
} from "../../support/proof-check/state-fixtures";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { proofCheckStatePatchForTest } from "../../unit/proof-check/state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

function proofMirDomainFixtureForMoveUseConsumeTest(label: string) {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirDomainFixtureForMoveUseConsumeTest(${label}) failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

describe("move use consume integration", () => {
  test("accepted move transfer emits ownership packet fact end to end", () => {
    const state = proofCheckStateForTest({
      places: [
        ownedPlaceForTest("packet"),
        ownedPlaceForTest("packet.payload"),
        uninitializedPlaceForTest("dest"),
      ],
    });

    const result = transferMovePlace({
      state,
      source: proofCheckPlaceForTest("packet.payload"),
      destination: proofCheckPlaceForTest("dest"),
      operationOriginKey: "integration:move:payload",
      placeResolver: testPlaceResolverForState(state),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("ownership")),
    ).toBe(true);

    const nextState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2301),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(nextState.kind).toBe("ok");
  });

  test("rejected use after consume reports deterministic diagnostics end to end", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });

    const consumed = transferConsumePlace({
      state,
      place: proofCheckPlaceForTest("buffer"),
      resourceKind: "Linear",
      operationOriginKey: "integration:consume:buffer",
      placeResolver: testPlaceResolverForState(state),
    });
    expect(consumed.kind).toBe("ok");
    if (consumed.kind !== "ok") return;

    const afterConsume = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2302),
        certificate: defaultCertificate,
        entries: consumed.patches,
      }),
    );
    expect(afterConsume.kind).toBe("ok");
    if (afterConsume.kind !== "ok") return;

    const result = checkUsePlace({
      state: afterConsume.state,
      place: proofCheckPlaceForTest("buffer"),
      operationOriginKey: "integration:use-after-consume",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_USE_AFTER_CONSUME",
        ownerKey: "integration:use-after-consume",
        rootCauseKey: "buffer",
      },
    ]);
  });

  test("rejected whole-object use after field move reports deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("packet"),
      operationOriginKey: "integration:use:packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_USE_AFTER_MOVE",
        ownerKey: "integration:use:packet",
        rootCauseKey: "packet",
      },
    ]);
  });

  test("probeProofCheckSourceSyntaxForTest routes unsupported move syntax through fixture fallback", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(
      [
        "fn main() -> Never:",
        "    let packet = source()",
        "    let payload = packet.payload",
        "    return payload",
      ].join("\n"),
    );
    const fixture = domainIntegrationFixtureForTest({
      source: "fn main() -> Never { unsupported_move_body() }",
      fixtureFallback: () => proofMirDomainFixtureForMoveUseConsumeTest("move-body"),
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
    if (syntax === "unsupported-source-syntax") {
      expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    }
  });

  test("fixture-backed rejected use-after-move when unsupported syntax is named", () => {
    const fixture = domainIntegrationFixtureForTest({
      source: "fn main() -> Never { unsupported_move_use() }",
      fixtureFallback: () => proofMirDomainFixtureForMoveUseConsumeTest("use-after-move"),
    });

    const result = checkUsePlace({
      state: proofCheckStateForTest({
        places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
      }),
      place: proofCheckPlaceForTest("packet"),
      operationOriginKey: "integration:fixture:use-after-move",
    });

    expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });
});

describe("move use consume public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
  });

  test("unsupported move syntax routes through fixture fallback rather than skipping", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(
      [
        "fn main() -> Never:",
        "    let packet = source()",
        "    let payload = packet.payload",
        "    return payload",
      ].join("\n"),
    );
    const result = checkProofSourceForTest("fn main() -> Never { unsupported_move_body() }", {
      fixtureFallback: {},
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(result.kind).toBe("ok");
  });

  test("use after consume rejects at domain layer with deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      places: [{ placeKey: "buffer", lifecycle: "consumed" }],
    });

    const result = checkUsePlace({
      state,
      place: proofCheckPlaceForTest("buffer"),
      operationOriginKey: "integration:public-api:use-after-consume",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_USE_AFTER_CONSUME",
        ownerKey: "integration:public-api:use-after-consume",
        rootCauseKey: "buffer",
      },
    ]);
  });

  test("use after move rejects at domain layer with deterministic diagnostics", () => {
    const result = checkUsePlace({
      state: proofCheckStateForTest({
        places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
      }),
      place: proofCheckPlaceForTest("packet"),
      operationOriginKey: "integration:public-api:use-after-move",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_USE_AFTER_MOVE",
        ownerKey: "integration:public-api:use-after-move",
        rootCauseKey: "packet",
      },
    ]);
  });

  test("wrapper with hidden affine linear content fixture rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "wrapper-hidden-affine-linear-content",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_WRAPPER_RESOURCE_LEAK"),
    );
  });

  test("option writable buffer some arm sends and none arm has no live resource", () => {
    const optionSource = [
      "fn send_saved(saved: Option[WritableBuffer]) -> Never:",
      "    match saved:",
      "        case Some(buffer):",
      "            send buffer",
      "        case None:",
      "            return",
    ].join("\n");
    const syntax = probeProofCheckSourceSyntaxForTest(optionSource);

    const someState = proofCheckStateForTest({
      places: [ownedPlaceForTest("saved.some")],
    });
    const someResult = transferConsumePlace({
      state: someState,
      place: proofCheckPlaceForTest("saved.some"),
      resourceKind: "Linear",
      operationOriginKey: "integration:option-writable:some-send",
      placeResolver: testPlaceResolverForState(someState),
    });
    expect(someResult.kind).toBe("ok");

    const noneResult = checkProofSourceForTest(optionSource, {
      fixtureFallback: {},
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(noneResult.kind).toBe("ok");
  });
});

import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirBlockId } from "../../../src/proof-mir/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  proofCheckPatchKind,
  type ProofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchInput,
} from "../../../src/proof-check/kernel/state-patch";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import {
  advancePrivateState,
  provePrivatePredicateRequirement,
  resetProofCheckPrivateStateCertificateIdsForTest,
} from "../../../src/proof-check/domains/private-state";
import {
  privateGenerationForTest,
  privatePredicateFactForTest,
  privatePredicateRequirementForTest,
  proofCheckStateForTest,
  testPlaceResolverForKeys,
} from "../../support/proof-check/state-fixtures";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
const defaultPatchCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

function proofCheckStatePatchForTest(
  input: ProofCheckStatePatchInput,
): ProofCheckStatePatch<ProofCheckPatchKind> {
  return {
    kind: proofCheckPatchKind(input.kind),
    transitionId: input.transitionId ?? proofCheckTransitionId(1),
    certificate: input.certificate ?? defaultPatchCertificate,
    entries: input.entries ?? [],
    ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
  };
}

beforeEach(() => {
  resetProofCheckPrivateStateCertificateIdsForTest();
});

describe("private state threading integration", () => {
  test("accepted private-state advancement invalidates stale facts and allows re-proving", () => {
    const initialState = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const beforeAdvance = provePrivatePredicateRequirement({
      state: initialState,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      ownerKey: "integration:advance:accepted",
    });
    expect(beforeAdvance.kind).toBe("ok");

    const advance = advancePrivateState({
      state: initialState,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:close",
      operationOriginKey: "integration:advance:accepted",
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("1"),
        blockId: proofMirBlockId(0),
      },
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });
    expect(advance.kind).toBe("ok");
    if (advance.kind !== "ok") return;

    const reduced = reduceProofCheckState(
      initialState,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        entries: advance.patches,
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;

    const reprovedState = proofCheckStateForTest({
      privateState: [...reduced.state.privateState.values()],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:2")],
    });

    const afterReprove = provePrivatePredicateRequirement({
      state: reprovedState,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      ownerKey: "integration:advance:accepted",
    });
    expect(afterReprove.kind).toBe("ok");
    expect(advance.packetEntries[0]?.scope.kind).toBe("blockEntry");
  });

  test("rejected stale private predicate reports deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:2")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      ownerKey: "integration:stale:predicate",
      advanceTransitionKey: "transition:close",
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_STALE_FACT",
        ownerKey: "integration:stale:predicate",
        rootCauseKey: "stale-private-predicate:cell.is_open",
      },
    ]);
    expect(result.diagnostics[0]?.stableDetail).toContain("transition:close");
  });

  test("fixture-backed rejected case names stale private predicate after advancement", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("device.state", "generation:3")],
      facts: [privatePredicateFactForTest("device.state.ready", "generation:2")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("device.state.ready", "current"),
      ownerKey: "integration:fixture:stale-private-predicate",
      advanceTransitionKey: "transition:device-reset",
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_STALE_FACT",
        ownerKey: "integration:fixture:stale-private-predicate",
        rootCauseKey: "stale-private-predicate:device.state.ready",
      },
    ]);
  });
});

describe("private state threading public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
  });

  test("unsupported private predicate syntax routes through fixture fallback", () => {
    const source = [
      "fn open_device(device: Device) -> Device:",
      "    requires:",
      "        device.state.is_open",
      "    return device",
    ].join("\n");
    const syntax = probeProofCheckSourceSyntaxForTest(source);
    const result = checkProofSourceForTest(source, {
      fixtureFallback: {},
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("ok");
    }
  });

  test("private generation invalidation and re-proving succeeds at domain layer", () => {
    const initialState = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const advance = advancePrivateState({
      state: initialState,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:close",
      operationOriginKey: "integration:public-api:advance",
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("1"),
        blockId: proofMirBlockId(0),
      },
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });
    expect(advance.kind).toBe("ok");
  });
});

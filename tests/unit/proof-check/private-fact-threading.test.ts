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
  activeFactForTest,
  privateGenerationForTest,
  privatePredicateFactForTest,
  privatePredicateRequirementForTest,
  proofCheckStateForTest,
  testPlaceResolverForKeys,
} from "../../support/proof-check/state-fixtures";

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

describe("provePrivatePredicateRequirement", () => {
  test("stale private predicate cannot satisfy a subsequent requirement", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:2")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      advanceTransitionKey: "transition:open",
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"));
    expect(result.diagnostics[0]?.stableDetail).toContain("cell.is_open");
    expect(result.diagnostics[0]?.stableDetail).toContain("transition:open");
  });

  test("current-generation predicate facts satisfy current requirements", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:2")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:2")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
    });

    expect(result.kind).toBe("ok");
  });

  test("explicit-generation predicate facts satisfy explicit requirements", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:2")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("cell.is_open", "generation:1"),
      advanceTransitionKey: "transition:open",
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"));
  });

  test("missing private predicate facts report unsatisfied requirements", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
    });

    const result = provePrivatePredicateRequirement({
      state,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
  });
});

describe("advancePrivateState", () => {
  test("advancePrivateState threads a new generation through state patches", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const advance = advancePrivateState({
      state,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:close",
      operationOriginKey: "operation:close",
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("1"),
        blockId: proofMirBlockId(0),
      },
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });

    expect(advance.kind).toBe("ok");
    if (advance.kind !== "ok") return;
    expect(advance.invalidatedFactKeys).toEqual(["cell.is_open"]);

    const reduced = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        entries: advance.patches,
      }),
    );

    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;
    expect(reduced.state.privateState.get("cell")?.generationKey).toBe("generation:2");
    expect(reduced.state.facts.has("cell.is_open")).toBe(false);
  });

  test("preserved predicate facts survive private-state advancement", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [
        privatePredicateFactForTest("cell.is_open", "generation:1"),
        privatePredicateFactForTest("cell.is_locked", "generation:1"),
      ],
    });

    const advance = advancePrivateState({
      state,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:preserve-lock",
      operationOriginKey: "operation:preserve-lock",
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("1"),
        blockId: proofMirBlockId(0),
      },
      preservedFactKeys: ["cell.is_locked"],
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });

    expect(advance.kind).toBe("ok");
    if (advance.kind !== "ok") return;
    expect(advance.invalidatedFactKeys).toEqual(["cell.is_open"]);
    expect(
      advance.patches.some(
        (entry) =>
          entry.kind === "fact" &&
          entry.action === "drop" &&
          entry.fact.factKey === "cell.is_locked",
      ),
    ).toBe(false);
  });

  test("packet private-state facts are scoped to the accepted program point", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
    });
    const programPointScope = {
      kind: "blockEntry" as const,
      functionInstanceId: monoInstanceId("7"),
      blockId: proofMirBlockId(3),
    };

    const advance = advancePrivateState({
      state,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:advance",
      operationOriginKey: "operation:advance",
      programPointScope,
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });

    expect(advance.kind).toBe("ok");
    if (advance.kind !== "ok") return;
    expect(advance.packetEntries).toHaveLength(1);
    expect(advance.packetEntries[0]?.scope).toEqual(programPointScope);
  });

  test("catalog preconditions cannot be satisfied by stale predicate facts after advancement", () => {
    const initialState = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const advance = advancePrivateState({
      state: initialState,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:close",
      operationOriginKey: "catalog:precondition",
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

    const staleFactState = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:2")],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
    });

    const staleResult = provePrivatePredicateRequirement({
      state: staleFactState,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      ownerKey: "catalog:precondition",
      advanceTransitionKey: "transition:close",
    });

    expect(staleResult.kind).toBe("missing");
    if (staleResult.kind !== "missing") return;
    expect(staleResult.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"),
    );

    const reprovedState = proofCheckStateForTest({
      privateState: [...reduced.state.privateState.values()],
      facts: [privatePredicateFactForTest("cell.is_open", "generation:2")],
    });
    const reproved = provePrivatePredicateRequirement({
      state: reprovedState,
      requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
      ownerKey: "catalog:precondition",
    });
    expect(reproved.kind).toBe("ok");
  });

  test("non-private predicate facts are not dropped during advancement", () => {
    const state = proofCheckStateForTest({
      privateState: [privateGenerationForTest("cell", "generation:1")],
      facts: [
        privatePredicateFactForTest("cell.is_open", "generation:1"),
        activeFactForTest("other:fact"),
      ],
    });

    const advance = advancePrivateState({
      state,
      placeKey: "cell",
      nextGenerationKey: "generation:2",
      transitionKey: "transition:close",
      operationOriginKey: "operation:close",
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("1"),
        blockId: proofMirBlockId(0),
      },
      placeResolver: testPlaceResolverForKeys(["cell"]),
    });

    expect(advance.kind).toBe("ok");
    if (advance.kind !== "ok") return;
    expect(advance.invalidatedFactKeys).toEqual(["cell.is_open"]);
    expect(
      advance.patches.some((entry) => entry.kind === "fact" && entry.fact.factKey === "other:fact"),
    ).toBe(false);
  });
});

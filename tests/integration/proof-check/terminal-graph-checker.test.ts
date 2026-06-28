import { describe, expect, test } from "bun:test";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirBlockId, proofMirControlEdgeId } from "../../../src/proof-mir/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { checkExtensionGateTransfer } from "../../../src/proof-check/domains/extension-gates";
import {
  checkLoopConvergence,
  proofCheckLoopJoinPolicyHooks,
} from "../../../src/proof-check/domains/loops";
import { proofCheckTransitionId } from "../../../src/proof-check/ids";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import { expectProofCheckDiagnosticOrderForTest } from "../../support/proof-check/integration-fixtures";
import {
  checkProofAndResourcesForClosedFixture,
  checkProofAndResourcesForTest,
  proofCheckClosedFixture,
  withProofCheckAuthoritiesForTest,
} from "../../support/proof-check/proof-check-fixtures";
import { validateProofCheckInput } from "../../../src/proof-check/validation/input-validator";
import {
  activeFactForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { extensionGateInputForTest } from "../../unit/proof-check/extension-gates.test";
import {
  dependencyKeysForLoopConvergenceInput,
  loopConvergenceInputForTest,
} from "../../unit/proof-check/loop-convergence.test";

const defaultFunctionInstanceId = monoInstanceId("fn:integration:loop");
const defaultHeaderBlockId = proofMirBlockId(3);
const defaultBackedgeId = proofMirControlEdgeId(2);

function integrationLoopMir(): ProofMirProgram {
  return {
    targetId: targetId("proof-check-test-target"),
    imageInstanceId: monoInstanceId("image:integration"),
    reachableFunctions: [defaultFunctionInstanceId],
    callGraph: { edges: new Map(), roots: [] },
    platformEdges: new Map(),
    runtimeCatalog: undefined as never,
    functions: new Map([
      [
        defaultFunctionInstanceId,
        {
          functionInstanceId: defaultFunctionInstanceId,
          entryBlockId: defaultHeaderBlockId,
          blocks: new Map([
            [
              defaultHeaderBlockId,
              {
                blockId: defaultHeaderBlockId,
                scopeId: 0 as never,
                parameters: [],
                statements: [],
                terminator: {
                  terminatorId: 0 as never,
                  kind: "branch",
                  outgoingEdges: [defaultBackedgeId],
                  origin: 0 as never,
                },
                incomingEdges: [defaultBackedgeId],
                stateMerge: {
                  kind: "loopHeader",
                  loopScopeId: 0 as never,
                  boundaryResources: {
                    places: [],
                    loans: [],
                    obligations: [],
                    sessionMembers: [],
                    privateStateGenerations: [],
                  },
                  origin: 0 as never,
                },
                origin: 0 as never,
              },
            ],
          ]),
          edges: new Map([
            [
              defaultBackedgeId,
              {
                edgeId: defaultBackedgeId,
                fromBlockId: defaultHeaderBlockId,
                toBlockId: defaultHeaderBlockId,
                kind: "loopBackedge",
                origin: 0 as never,
              },
            ],
          ]),
          exits: [],
          locals: new Map(),
          places: new Map(),
          scopes: new Map(),
          values: new Map(),
          facts: new Map(),
          calls: new Map(),
          origins: new Map(),
        },
      ],
    ]),
  } as unknown as ProofMirProgram;
}

describe("extension gate integration", () => {
  test("rejected extension gate without companion reports deterministic diagnostics", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_UNSAFE_EXTENSION",
        ownerKey: "extension:targetSpecific",
        rootCauseKey: "extension:targetSpecific",
      },
    ]);
  });

  test("accepted extension gate transfer applies companion patch end to end", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("operand:a")],
      facts: [activeFactForTest("fact:extension")],
    });

    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        state,
        placeKeys: ["operand:a"],
        companion: extensionGateInputForTest().companion,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packetEntryKeys).toEqual(["packet:extension:1"]);
    expect(result.patch.kind).toBe("extensionTransfer");
  });
});

describe("loop convergence integration", () => {
  test("rejected loop header without companion reports deterministic diagnostics", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("counter")] });
    const right = proofCheckStateForTest({
      places: [ownedPlaceForTest("counter")],
      facts: [activeFactForTest("fact:iteration")],
    });

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        functionInstanceId: defaultFunctionInstanceId,
        headerBlockId: defaultHeaderBlockId,
        backedgeIds: [defaultBackedgeId],
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
        incomingStates: [left, right],
        ownerKey: "integration:loop:missing-companion",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
        ownerKey: "integration:loop:missing-companion",
        rootCauseKey: "integration:loop:missing-companion",
      },
    ]);
  });

  test("accepted exact loop-state equality converges through join policy hooks", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("counter")],
      facts: [activeFactForTest("fact:invariant")],
    });
    const hooks = proofCheckLoopJoinPolicyHooks({
      mir: integrationLoopMir(),
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    });

    const result = hooks.resolveLoopHeaderJoin?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId: defaultHeaderBlockId,
      incomingStates: [state, state],
      transitionId: proofCheckTransitionId(1),
    });

    expect(result?.kind).toBe("accept");
    if (result?.kind !== "accept") return;
    expect(proofCheckStateKey(result.state)).toBe(proofCheckStateKey(state));
  });

  test("companion-backed loop join accepts through policy hooks end to end", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("counter")] });
    const right = proofCheckStateForTest({
      places: [ownedPlaceForTest("counter")],
      facts: [activeFactForTest("fact:iteration")],
    });

    const hooks = proofCheckLoopJoinPolicyHooks({
      mir: integrationLoopMir(),
      companion: loopConvergenceInputForTest({
        functionInstanceId: defaultFunctionInstanceId,
        headerBlockId: defaultHeaderBlockId,
        backedgeIds: [defaultBackedgeId],
      }).companion,
      dependencyKeys: dependencyKeysForLoopConvergenceInput({
        backedgeIds: [defaultBackedgeId],
      }),
    });

    const result = hooks.resolveLoopHeaderJoin?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId: defaultHeaderBlockId,
      incomingStates: [left, right],
      transitionId: proofCheckTransitionId(1),
    });

    expect(result?.kind).toBe("accept");
    if (result?.kind !== "accept") return;
    expect(result.state.places.get("counter")?.lifecycle).toBe("owned");
  });

  test("loop convergence failure reports loop diagnostic code", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("counter")] });
    const right = proofCheckStateForTest({
      places: [ownedPlaceForTest("counter")],
      facts: [activeFactForTest("fact:iteration")],
    });
    const stateKey = proofCheckStateKey(left);

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        functionInstanceId: defaultFunctionInstanceId,
        headerBlockId: defaultHeaderBlockId,
        incomingStates: [left, right],
        acceptedVariantStates: new Map([["", new Set(["state:not-seen"])]]),
        visitCounts: new Map([[`${String(defaultHeaderBlockId)}::${stateKey}`, 2]]),
        ownerKey: "integration:loop:replay-failure",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LOOP_CONVERGENCE_FAILED"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LOOP_CONVERGENCE_FAILED",
        ownerKey: "integration:loop:replay-failure",
        rootCauseKey: "integration:loop:replay-failure",
      },
    ]);
  });
});

describe("loop and extension end-to-end integration", () => {
  test("loop header with exact meet does not require loop convergence at input validation", () => {
    const input = proofCheckClosedFixture({ invalidCase: "missing-loop-convergence" });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
    expect(input.semantics.providedJudgments.map(String)).not.toContain("loopConvergence");
    expect(checkProofAndResourcesForTest(input).kind).toBe("ok");
  });

  test("unsupported extension without companion judgment is rejected end to end", () => {
    const extensionMir = proofCheckClosedFixture({
      invalidCase: "missing-cross-core-certificate",
    }).mir;
    const input = withProofCheckAuthoritiesForTest({
      mir: extensionMir,
      invalidCase: "unsupported-extension",
    });

    const result = checkProofAndResources(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("loop convergence failure reports loop diagnostic through domain transfer", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("counter")] });
    const right = proofCheckStateForTest({
      places: [ownedPlaceForTest("counter")],
      facts: [activeFactForTest("fact:iteration")],
    });
    const stateKey = proofCheckStateKey(left);

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        functionInstanceId: defaultFunctionInstanceId,
        headerBlockId: defaultHeaderBlockId,
        incomingStates: [left, right],
        acceptedVariantStates: new Map([["", new Set(["state:not-seen"])]]),
        visitCounts: new Map([[`${String(defaultHeaderBlockId)}::${stateKey}`, 2]]),
        ownerKey: "integration:e2e:loop-replay-failure",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LOOP_CONVERGENCE_FAILED",
        ownerKey: "integration:e2e:loop-replay-failure",
        rootCauseKey: "integration:e2e:loop-replay-failure",
      },
    ]);
  });
});

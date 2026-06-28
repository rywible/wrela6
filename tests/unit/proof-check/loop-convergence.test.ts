import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofCheckStateDigest,
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofLoopConvergenceJudgmentInput,
  type ProofLoopConvergenceJudgmentResult,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkLoopConvergence,
  checkStateJoinWithCompanion,
  parseLoopConvergenceCertificate,
  proofCheckLoopJoinPolicyHooks,
  type LoopConvergenceInput,
} from "../../../src/proof-check/domains/loops";
import { proofCheckTransitionId, proofSemanticsCertificateId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import type {
  ProofCheckStatePatchEntry,
  ProofCheckStatePatch,
} from "../../../src/proof-check/kernel/state-patch";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirBlockId, proofMirControlEdgeId } from "../../../src/proof-mir/ids";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import {
  activeFactForTest,
  ownedPlaceForTest,
  privateGenerationForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";

const defaultFunctionInstanceId = monoInstanceId("fn:loop");
const defaultHeaderBlockId = proofMirBlockId(5);
const defaultBackedgeId = proofMirControlEdgeId(1);

function semanticsFingerprintForTest(digestHex = "cc".repeat(32)): ProofAuthorityFingerprint {
  return {
    authorityKind: "semantics",
    targetId: targetId("proof-check-test-target"),
    version: "semantics-v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

const defaultFingerprint = semanticsFingerprintForTest();
const defaultCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(1),
};

function emptyPatch<Kind extends "stateJoin" | "loopConvergence">(
  kind: Kind,
  entries: readonly ProofCheckStatePatchEntry[] = [],
): ProofCheckStatePatch<ReturnType<typeof proofCheckPatchKind>> {
  return {
    kind: proofCheckPatchKind(kind),
    transitionId: proofCheckTransitionId(1),
    certificate: defaultCertificate,
    entries,
  };
}

function dependencyKeysForLoopRequest(input: ProofLoopConvergenceJudgmentInput): readonly string[] {
  return [
    ...input.backedgeIds.map((edgeId) => `loop:backedge:${String(edgeId)}`),
    ...input.variantKeys.map((variantKey) => `loop:variant:${variantKey}`),
    "loop:visit-bound:2",
    ...input.loopCarriedPrivateStateKeys.map((placeKey) => `loop:carried:${placeKey}`),
    "loop:generation-role:cell:currentIteration",
    "loop:invariant:fact:inv",
    "loop:dropped:fact:path",
  ];
}

function loopConvergenceOkResult(input: {
  readonly request: ProofSemanticsJudgmentRequest;
  readonly dependencyKeys?: readonly string[];
  readonly replayWitnessKey?: string;
  readonly patchEntries?: readonly ProofCheckStatePatchEntry[];
}): Extract<ProofSemanticsJudgmentResult, { readonly kind: "loopConvergence" }> {
  if (input.request.kind !== "loopConvergence") {
    throw new Error("loopConvergenceOkResult requires a loopConvergence request.");
  }
  return {
    kind: "loopConvergence",
    requestKind: "loopConvergence",
    requestKey: input.request.input.requestKey,
    companionFingerprint: defaultFingerprint,
    subjectKey: `loop:${input.request.input.functionInstanceId}:${input.request.input.headerBlockId}`,
    dependencyKeys: input.dependencyKeys ?? dependencyKeysForLoopRequest(input.request.input),
    certificateId: proofSemanticsCertificateId(1),
    replayWitnessKey: input.replayWitnessKey ?? "witness:final",
    patch: emptyPatch(
      "loopConvergence",
      input.patchEntries ?? [],
    ) as ProofLoopConvergenceJudgmentResult["patch"],
  };
}

function stateJoinOkResult(
  requestKey: string,
  subjectKey: string,
): Extract<ProofSemanticsJudgmentResult, { readonly kind: "stateJoin" }> {
  return {
    kind: "stateJoin",
    requestKind: "stateJoin",
    requestKey,
    companionFingerprint: defaultFingerprint,
    subjectKey,
    dependencyKeys: [],
    certificateId: proofSemanticsCertificateId(2),
    patch: emptyPatch("stateJoin") as Extract<
      ProofSemanticsJudgmentResult,
      { readonly kind: "stateJoin" }
    >["patch"],
  };
}

function loopCompanionWithJudge(
  judge: (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined,
): ProofSemanticsCompanion {
  return proofSemanticsCompanion({
    fingerprint: defaultFingerprint,
    targetId: targetId("proof-check-test-target"),
    schemaVersion: "semantics-v1",
    providedJudgments: [
      proofSemanticsJudgmentKind("stateJoin"),
      proofSemanticsJudgmentKind("loopConvergence"),
    ],
    judge,
  });
}

function emptyMirForLoopHeaderTest(): ProofMirProgram {
  const functionInstanceId = defaultFunctionInstanceId;
  const headerBlockId = defaultHeaderBlockId;
  return {
    targetId: targetId("proof-check-test-target"),
    imageInstanceId: monoInstanceId("image:test"),
    reachableFunctions: [functionInstanceId],
    callGraph: { edges: new Map(), roots: [] },
    platformEdges: new Map(),
    runtimeCatalog: undefined as never,
    functions: new Map([
      [
        functionInstanceId,
        {
          functionInstanceId,
          entryBlockId: headerBlockId,
          blocks: new Map([
            [
              headerBlockId,
              {
                blockId: headerBlockId,
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
                fromBlockId: headerBlockId,
                toBlockId: headerBlockId,
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

export function loopConvergenceInputForTest(
  overrides: Partial<LoopConvergenceInput> = {},
): LoopConvergenceInput {
  const incomingState = proofCheckStateForTest({
    facts: [activeFactForTest("fact:loop")],
    privateState: [privateGenerationForTest("cell", "generation:1")],
  });
  const backedgeIds = overrides.backedgeIds ?? [defaultBackedgeId];
  const baseInput: LoopConvergenceInput = {
    companion: loopCompanionWithJudge((request) => {
      if (request.kind !== "loopConvergence") {
        return undefined;
      }
      return loopConvergenceOkResult({ request });
    }),
    functionInstanceId: defaultFunctionInstanceId,
    headerBlockId: defaultHeaderBlockId,
    incomingStates: [incomingState, incomingState],
    backedgeIds,
    transitionId: proofCheckTransitionId(1),
    variantKey: "",
    dependencyKeys: dependencyKeysForLoopConvergenceInput({ backedgeIds }),
  };
  return {
    ...baseInput,
    ...overrides,
    ...(overrides.companion !== undefined ? { companion: overrides.companion } : {}),
    ...(overrides.dependencyKeys !== undefined ? { dependencyKeys: overrides.dependencyKeys } : {}),
  };
}

export function dependencyKeysForLoopConvergenceInput(input: {
  readonly backedgeIds: readonly ReturnType<typeof proofMirControlEdgeId>[];
  readonly variantKey?: string;
  readonly loopCarriedPrivateStateKeys?: readonly string[];
}): Set<string> {
  return new Set(
    dependencyKeysForLoopRequest({
      requestKey: "request:loop",
      functionInstanceId: defaultFunctionInstanceId,
      headerBlockId: defaultHeaderBlockId,
      backedgeIds: input.backedgeIds,
      incomingStateDigests: [],
      variantKeys: [input.variantKey ?? ""],
      loopCarriedPrivateStateKeys: input.loopCarriedPrivateStateKeys ?? ["cell"],
    }),
  );
}

describe("checkLoopConvergence", () => {
  test("loop header without required companion judgment is rejected", () => {
    const divergentLeft = proofCheckStateForTest({ facts: [activeFactForTest("fact:left")] });
    const divergentRight = proofCheckStateForTest({ facts: [activeFactForTest("fact:right")] });

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
        incomingStates: [divergentLeft, divergentRight],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("exact loop-state equality accepts without companion judgment", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:same")] });

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
        incomingStates: [state, state],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.meetKind).toBe("exact");
    expect(proofCheckStateKey(result.state)).toBe(proofCheckStateKey(state));
  });

  test("companion loop certificate names required metadata fields", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "loopConvergence",
      input: {
        requestKey: "request:loop:1",
        functionInstanceId: defaultFunctionInstanceId,
        headerBlockId: defaultHeaderBlockId,
        backedgeIds: [defaultBackedgeId],
        incomingStateDigests: [proofCheckStateDigest("state:a")],
        variantKeys: ["main"],
        loopCarriedPrivateStateKeys: ["cell"],
      } satisfies ProofLoopConvergenceJudgmentInput,
    };
    const result = loopConvergenceOkResult({ request });

    const certificate = parseLoopConvergenceCertificate({
      judgmentInput: request.input,
      judgmentResult: result,
      incomingStateKeys: ["state:a"],
      variantKey: "main",
    });

    expect(certificate).toBeDefined();
    if (certificate === undefined) return;
    expect(certificate.backedgeIds).toEqual([defaultBackedgeId]);
    expect(certificate.variantKeys).toContain("main");
    expect(certificate.loopCarriedResourceKeys).toContain("cell");
    expect(certificate.generationRoles).toEqual([{ placeKey: "cell", role: "currentIteration" }]);
    expect(certificate.invariantFactKeys).toContain("fact:inv");
    expect(certificate.allowedDroppedRefinementKeys).toContain("fact:path");
    expect(certificate.visitBound).toBe(2);
    expect(certificate.finalReplayWitnessKey).toBe("witness:final");
    expect(certificate.finalReplay.replayWitnessKey).toBe("witness:final");
  });

  test("accepted companion loop convergence replays patch through reducer", () => {
    const left = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:drop-me")],
    });
    const right = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:other")],
    });

    const result = checkLoopConvergence(
      loopConvergenceInputForTest({
        incomingStates: [left, right],
        companion: loopCompanionWithJudge((request) => {
          if (request.kind !== "loopConvergence") {
            return undefined;
          }
          return loopConvergenceOkResult({
            request,
            patchEntries: [
              { kind: "fact", action: "drop", fact: activeFactForTest("fact:drop-me") },
            ],
          });
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.facts.has("fact:drop-me")).toBe(false);
    expect(result.state.facts.has("fact:shared")).toBe(true);
  });

  test("replay after visit bound requires an already accepted variant state", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("item")] });
    const right = proofCheckStateForTest({
      places: [ownedPlaceForTest("item")],
      facts: [activeFactForTest("fact:iteration")],
    });
    const stateKey = proofCheckStateKey(left);

    const firstVisit = checkLoopConvergence(
      loopConvergenceInputForTest({
        incomingStates: [left, right],
        acceptedVariantStates: new Map([["", new Set([stateKey])]]),
        visitCounts: new Map([[`${String(defaultHeaderBlockId)}::${stateKey}`, 1]]),
      }),
    );
    expect(firstVisit.kind).toBe("ok");

    const replay = checkLoopConvergence(
      loopConvergenceInputForTest({
        incomingStates: [left, right],
        acceptedVariantStates: new Map([["", new Set(["state:not-accepted"])]]),
        visitCounts: new Map([[`${String(defaultHeaderBlockId)}::${stateKey}`, 2]]),
      }),
    );

    expect(replay.kind).toBe("error");
    if (replay.kind !== "error") return;
    expect(replay.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LOOP_CONVERGENCE_FAILED"),
    );
  });
});

describe("checkStateJoinWithCompanion", () => {
  test("non-exact acyclic join requires a stateJoin companion judgment", () => {
    const left = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const right = proofCheckStateForTest({ facts: [activeFactForTest("fact:b")] });
    const meet = proofCheckStateForTest({ facts: [] });

    const result = checkStateJoinWithCompanion({
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
      functionInstanceId: defaultFunctionInstanceId,
      blockId: proofMirBlockId(2),
      incomingStates: [left, right],
      coreMeetState: meet,
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("stateJoin companion patch is replayed through reducer", () => {
    const left = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:drop")],
    });
    const right = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:other")],
    });
    const meet = proofCheckStateForTest({ facts: [activeFactForTest("fact:shared")] });

    const result = checkStateJoinWithCompanion({
      companion: loopCompanionWithJudge((request) => {
        if (request.kind !== "stateJoin") {
          return undefined;
        }
        return {
          ...stateJoinOkResult(
            request.input.requestKey,
            `join:${request.input.functionInstanceId}:${request.input.blockId}`,
          ),
          patch: emptyPatch("stateJoin", [
            { kind: "fact", action: "drop", fact: activeFactForTest("fact:drop") },
          ]) as Extract<ProofSemanticsJudgmentResult, { readonly kind: "stateJoin" }>["patch"],
        };
      }),
      functionInstanceId: defaultFunctionInstanceId,
      blockId: proofMirBlockId(2),
      incomingStates: [left, right],
      coreMeetState: meet,
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.facts.has("fact:drop")).toBe(false);
    expect(result.state.facts.has("fact:shared")).toBe(true);
  });
});

describe("proofCheckLoopJoinPolicyHooks", () => {
  test("routes loop headers to loop convergence and ordinary joins to stateJoin", () => {
    const mir = emptyMirForLoopHeaderTest();
    const hooks = proofCheckLoopJoinPolicyHooks({
      mir,
      companion: loopCompanionWithJudge((request) => {
        if (request.kind === "loopConvergence") {
          return loopConvergenceOkResult({ request });
        }
        if (request.kind === "stateJoin") {
          return stateJoinOkResult(
            request.input.requestKey,
            `join:${request.input.functionInstanceId}:${request.input.blockId}`,
          );
        }
        return undefined;
      }),
      dependencyKeys: dependencyKeysForLoopConvergenceInput({ backedgeIds: [defaultBackedgeId] }),
    });

    const loopLeft = proofCheckStateForTest({ facts: [activeFactForTest("fact:loop-left")] });
    const loopRight = proofCheckStateForTest({ facts: [activeFactForTest("fact:loop-right")] });
    const loopResult = hooks.resolveNonExactJoin?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId: defaultHeaderBlockId,
      incomingStates: [loopLeft, loopRight],
      coreMeetState: proofCheckStateForTest({ facts: [] }),
      transitionId: proofCheckTransitionId(1),
    });
    expect(loopResult?.kind).toBe("accept");

    const joinLeft = proofCheckStateForTest({ facts: [activeFactForTest("fact:join-left")] });
    const joinRight = proofCheckStateForTest({ facts: [activeFactForTest("fact:join-right")] });
    const joinResult = hooks.resolveNonExactJoin?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId: proofMirBlockId(9),
      incomingStates: [joinLeft, joinRight],
      coreMeetState: proofCheckStateForTest({ facts: [] }),
      transitionId: proofCheckTransitionId(1),
    });
    expect(joinResult?.kind).toBe("accept");
  });
});

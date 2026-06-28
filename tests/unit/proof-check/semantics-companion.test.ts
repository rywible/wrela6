import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  PROOF_SEMANTICS_JUDGMENT_KINDS,
  proofCheckStateDigest,
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  semanticsJudgmentSubjectKey,
  validateProofSemanticsJudgmentResult,
  type ProofEntailmentJudgmentInput,
  type ProofEntailmentJudgmentResult,
  type ProofExtensionTransferJudgmentInput,
  type ProofLoopConvergenceJudgmentInput,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
  type ProofStateJoinJudgmentInput,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  proofCheckCoreCertificateId,
  proofCheckTransitionId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import {
  proofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
} from "../../../src/proof-check/kernel/state-patch";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirPlaceId,
} from "../../../src/proof-mir/ids";
import { targetId } from "../../../src/semantic/ids";
import {
  capabilityRequirementForTest,
  comparisonTerm,
  proofCheckValueOperandForTest,
} from "../../support/proof-check/term-fixtures";
import { activeFactForTest } from "../../support/proof-check/state-fixtures";

function semanticsFingerprintForTask8Test(digestHex = "cc".repeat(32)): ProofAuthorityFingerprint {
  return {
    authorityKind: "semantics",
    targetId: targetId("proof-check-test-target"),
    version: "semantics-v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

const defaultFingerprint = semanticsFingerprintForTask8Test();
const defaultCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(1),
};

function semanticsCompanionForTask8Test(input?: {
  readonly providedJudgments?: readonly string[];
  readonly result?: ProofSemanticsJudgmentResult;
  readonly fingerprint?: ProofAuthorityFingerprint;
  readonly judge?: (
    request: ProofSemanticsJudgmentRequest,
  ) => ProofSemanticsJudgmentResult | undefined;
}): ProofSemanticsCompanion {
  return proofSemanticsCompanion({
    fingerprint: input?.fingerprint ?? defaultFingerprint,
    targetId: targetId("proof-check-test-target"),
    schemaVersion: "semantics-v1",
    providedJudgments: (input?.providedJudgments ?? []).map((kind) =>
      proofSemanticsJudgmentKind(kind),
    ),
    judge: input?.judge ?? (() => input?.result),
  });
}

function entailmentInputForTask8Test(
  overrides: Partial<ProofEntailmentJudgmentInput> = {},
): ProofEntailmentJudgmentInput {
  return {
    requestKey: "request:entailment:1",
    subjectKey: "wanted-request",
    environmentFactKeys: ["fact:a"],
    requirement: comparisonTerm(
      proofCheckValueOperandForTest("value:a"),
      "eq",
      proofCheckValueOperandForTest("value:b"),
    ),
    allowedAuthorityKeys: ["authority:layout"],
    ...overrides,
  };
}

function entailmentRequestForTask8Test(
  overrides: Partial<ProofEntailmentJudgmentInput> = {},
): ProofSemanticsJudgmentRequest {
  return {
    kind: "entailment",
    input: entailmentInputForTask8Test(overrides),
  };
}

function entailmentOkResultForTask8Test(
  overrides: Partial<ProofEntailmentJudgmentResult> = {},
): ProofEntailmentJudgmentResult {
  return {
    kind: "entailment",
    requestKind: "entailment",
    requestKey: "request:entailment:1",
    companionFingerprint: defaultFingerprint,
    subjectKey: "wanted-request",
    dependencyKeys: ["authority:layout"],
    certificateId: proofSemanticsCertificateId(1),
    entailed: true,
    ...overrides,
  };
}

function stateJoinInputForTask8Test(
  overrides: Partial<ProofStateJoinJudgmentInput> = {},
): ProofStateJoinJudgmentInput {
  return {
    requestKey: "request:state-join:1",
    functionInstanceId: monoInstanceId("fn:main"),
    blockId: proofMirBlockId(2),
    incomingStateDigests: [proofCheckStateDigest("state:a"), proofCheckStateDigest("state:b")],
    allowedDropFactKeys: ["fact:drop"],
    allowedPacketSourceKeys: ["packet:a->source:a"],
    ...overrides,
  };
}

function stateJoinRequestForTask8Test(): ProofSemanticsJudgmentRequest {
  return { kind: "stateJoin", input: stateJoinInputForTask8Test() };
}

function emptyPatch<
  Kind extends
    | "stateJoin"
    | "loopConvergence"
    | "yieldResume"
    | "crossCoreOwnership"
    | "streamLoop"
    | "extensionTransfer",
>(kind: Kind, entries: readonly ProofCheckStatePatchEntry[] = []): ProofCheckStatePatch<Kind> {
  return {
    kind,
    transitionId: proofCheckTransitionId(1),
    certificate: defaultCertificate,
    entries,
  };
}

function factDropEntry(factKey: string): ProofCheckStatePatchEntry {
  return {
    kind: "fact",
    action: "drop",
    fact: activeFactForTest(factKey),
  };
}

describe("ProofSemanticsJudgmentKind", () => {
  test("judgment kinds are exactly the closed Task 8 set", () => {
    expect([...PROOF_SEMANTICS_JUDGMENT_KINDS]).toEqual([
      "entailment",
      "stateJoin",
      "loopConvergence",
      "terminalClosure",
      "yieldResume",
      "crossCoreOwnership",
      "streamLoop",
      "extensionTransfer",
    ]);
  });

  test("proofSemanticsJudgmentKind rejects unknown labels", () => {
    expect(() => proofSemanticsJudgmentKind("not-a-judgment")).toThrow(
      "Unknown proof-semantics judgment kind",
    );
  });
});

describe("ProofSemanticsCompanion", () => {
  test("companion exposes fingerprint, target ID, schema version, provided judgments, and pure judge", () => {
    const result = entailmentOkResultForTask8Test();
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result,
    });

    expect(companion.fingerprint).toEqual(defaultFingerprint);
    expect(companion.targetId).toBe(targetId("proof-check-test-target"));
    expect(companion.schemaVersion).toBe("semantics-v1");
    expect(companion.providedJudgments).toEqual([proofSemanticsJudgmentKind("entailment")]);
    expect(companion.judge(entailmentRequestForTask8Test())).toEqual(result);
  });
});

describe("semanticsJudgmentSubjectKey", () => {
  test("derives stable subject keys per judgment kind", () => {
    expect(semanticsJudgmentSubjectKey(entailmentRequestForTask8Test())).toBe("wanted-request");
    expect(semanticsJudgmentSubjectKey(stateJoinRequestForTask8Test())).toBe(
      `join:${monoInstanceId("fn:main")}:${proofMirBlockId(2)}`,
    );
    expect(
      semanticsJudgmentSubjectKey({
        kind: "terminalClosure",
        input: {
          requestKey: "request:terminal:1",
          terminalKey: checkedTerminalClosureKey("terminal:main"),
          terminalGraphKey: "graph:1",
          platformBaseKeys: ["platform:base"],
        },
      }),
    ).toBe("terminal:main");
  });
});

describe("validateProofSemanticsJudgmentResult", () => {
  test("semantics result rejects a certificate for the wrong normalized request", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: entailmentOkResultForTask8Test({ subjectKey: "other-request" }),
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test({ subjectKey: "wanted-request" }),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE"),
    );
  });

  test("accepts a matching entailment certificate", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: entailmentOkResultForTask8Test(),
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    if (result.result.kind !== "entailment") return;
    expect(result.result.entailed).toBe(true);
  });

  test("rejects undeclared judgment kinds", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: [],
      result: entailmentOkResultForTask8Test(),
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("rejects companion fingerprint mismatch", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: entailmentOkResultForTask8Test({
        companionFingerprint: semanticsFingerprintForTask8Test("dd".repeat(32)),
      }),
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toBe("companion-fingerprint-mismatch");
  });

  test("rejects unknown dependency keys", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: entailmentOkResultForTask8Test({
        dependencyKeys: ["authority:missing"],
      }),
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("unknown-dependency");
  });

  test("rejects mismatched request kind", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment", "stateJoin"],
      judge: (request) => {
        if (request.kind === "entailment") {
          return {
            kind: "stateJoin",
            requestKind: "stateJoin",
            requestKey: "request:entailment:1",
            companionFingerprint: defaultFingerprint,
            subjectKey: "wanted-request",
            dependencyKeys: ["authority:layout"],
            certificateId: proofSemanticsCertificateId(1),
            patch: emptyPatch("stateJoin"),
          };
        }
        return undefined;
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("request-kind-mismatch");
  });

  test("rejects extra result fields", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: {
        ...entailmentOkResultForTask8Test(),
        unexpectedField: true,
      } as ProofEntailmentJudgmentResult,
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("result-extra-field");
  });

  test("entailment cannot return a state patch", () => {
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["entailment"],
      result: {
        ...entailmentOkResultForTask8Test(),
        patch: emptyPatch("stateJoin"),
      } as unknown as ProofEntailmentJudgmentResult,
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request: entailmentRequestForTask8Test(),
      dependencyKeys: new Set(["authority:layout"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("result-extra-field");
  });

  test("terminal closure cannot return a state patch", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "terminalClosure",
      input: {
        requestKey: "request:terminal:1",
        terminalKey: checkedTerminalClosureKey("terminal:main"),
        terminalGraphKey: "graph:1",
        platformBaseKeys: ["platform:base"],
      },
    };
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["terminalClosure"],
      result: {
        kind: "terminalClosure",
        requestKind: "terminalClosure",
        requestKey: "request:terminal:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: "terminal:main",
        dependencyKeys: ["platform:base"],
        certificateId: proofSemanticsCertificateId(2),
        terminalClosureKey: checkedTerminalClosureKey("terminal:main"),
        patch: emptyPatch("stateJoin"),
      } as unknown as ProofSemanticsJudgmentResult,
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set(["platform:base"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("result-extra-field");
  });

  test("stateJoin rejects invalid patch kind", () => {
    const request = stateJoinRequestForTask8Test();
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["stateJoin"],
      result: {
        kind: "stateJoin",
        requestKind: "stateJoin",
        requestKey: "request:state-join:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: semanticsJudgmentSubjectKey(request),
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(3),
        patch: emptyPatch("yieldResume") as unknown as ProofCheckStatePatch<"stateJoin">,
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("patch-kind-mismatch");
  });

  test("stateJoin rejects fact drops outside allowed dependency set", () => {
    const request = stateJoinRequestForTask8Test();
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["stateJoin"],
      result: {
        kind: "stateJoin",
        requestKind: "stateJoin",
        requestKey: "request:state-join:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: semanticsJudgmentSubjectKey(request),
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(4),
        patch: emptyPatch("stateJoin", [factDropEntry("fact:outside")]),
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-dependency-set");
  });

  test("loopConvergence rejects private-state remapping outside loop-carried set", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "loopConvergence",
      input: {
        requestKey: "request:loop:1",
        functionInstanceId: monoInstanceId("fn:loop"),
        headerBlockId: proofMirBlockId(5),
        backedgeIds: [proofMirControlEdgeId(1)],
        incomingStateDigests: [proofCheckStateDigest("state:loop")],
        variantKeys: ["variant:a"],
        loopCarriedPrivateStateKeys: ["place:allowed"],
      } satisfies ProofLoopConvergenceJudgmentInput,
    };
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["loopConvergence"],
      result: {
        kind: "loopConvergence",
        requestKind: "loopConvergence",
        requestKey: "request:loop:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: semanticsJudgmentSubjectKey(request),
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(5),
        replayWitnessKey: "witness:1",
        patch: emptyPatch("loopConvergence", [
          {
            kind: "privateState",
            advance: {
              placeKey: "place:other",
              previous: "gen:0",
              next: "gen:1",
              transitionKey: "transition:1",
            },
          },
        ]),
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("not-loop-carried");
  });

  test("crossCoreOwnership rejects transfer of unrelated source place", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "crossCoreOwnership",
      input: {
        requestKey: "request:cross-core:1",
        sourcePlaceKey: "place:source",
        destinationCoreKey: "core:1",
        capabilityKind: capabilityRequirementForTest("cap:dma").capabilityKind,
        orderingFactKey: "fact:ordering",
      },
    };
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["crossCoreOwnership"],
      result: {
        kind: "crossCoreOwnership",
        requestKind: "crossCoreOwnership",
        requestKey: "request:cross-core:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: "place:source",
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(6),
        patch: emptyPatch("crossCoreOwnership", [
          {
            kind: "placeState",
            place: proofMirPlaceId(1),
            state: { placeKey: "place:other", lifecycle: "owned" },
          },
        ]),
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("not-named-source");
  });

  test("streamLoop rejects closing unrelated member obligations", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "streamLoop",
      input: {
        requestKey: "request:stream:1",
        streamSessionKey: "session:rx",
        yieldedMemberKey: "member:expected",
        memberLocalFactKeys: ["fact:member"],
      },
    };
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["streamLoop"],
      result: {
        kind: "streamLoop",
        requestKind: "streamLoop",
        requestKey: "request:stream:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: "member:expected",
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(7),
        patch: emptyPatch("streamLoop", [
          {
            kind: "obligation",
            action: "close",
            obligation: {
              obligationKey: "member:other",
              status: "open",
            },
          },
        ]),
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("not-named-member");
  });

  test("extensionTransfer rejects entries outside declared extension schema", () => {
    const request: ProofSemanticsJudgmentRequest = {
      kind: "extensionTransfer",
      input: {
        requestKey: "request:extension:1",
        extensionKind: "targetSpecific",
        extensionSchemaKey: "schema:target",
        operandKeys: ["operand:a"],
        allowedPatchKinds: [proofCheckPatchKind("extensionTransfer")],
      } satisfies ProofExtensionTransferJudgmentInput,
    };
    const companion = semanticsCompanionForTask8Test({
      providedJudgments: ["extensionTransfer"],
      result: {
        kind: "extensionTransfer",
        requestKind: "extensionTransfer",
        requestKey: "request:extension:1",
        companionFingerprint: defaultFingerprint,
        subjectKey: "schema:target",
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(8),
        packetEntryKeys: ["packet:entry:1"],
        patch: {
          kind: "extensionTransfer",
          transitionId: proofCheckTransitionId(1),
          certificate: {
            kind: "core",
            id: proofCheckCoreCertificateId(1),
          },
          entries: [
            {
              kind: "loan",
              action: "open",
              loan: {
                loanKey: "loan:1",
                mode: "exclusive",
                placeKey: "place:1",
              },
            },
          ],
          constraints: {
            allowedExtensionEntryKinds: ["fact"],
          },
        },
      },
    });

    const result = validateProofSemanticsJudgmentResult({
      companion,
      request,
      dependencyKeys: new Set([]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-declared-schema");
  });
});

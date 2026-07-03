import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofSemanticsJudgmentKind,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
  type ProofYieldResumeJudgmentInput,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkYieldResumeTransfer,
  type YieldResumeTransferInput,
} from "../../../src/proof-check/domains/yield-resume";
import { proofCheckTransitionId, proofSemanticsCertificateId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  proofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
} from "../../../src/proof-check/kernel/state-patch";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import {
  activeFactForTest,
  capabilityStateForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  proofCheckStateForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultFingerprint: ProofAuthorityFingerprint = {
  authorityKind: "semantics",
  targetId: targetId("proof-check-test-target"),
  version: "semantics-v1",
  digestAlgorithm: "sha256",
  digestHex: "cc".repeat(32),
};

const defaultCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(1),
};

function yieldResumeOkPatch(
  invalidatableFactKeys: readonly string[],
  entries: readonly ProofCheckStatePatchEntry[] = [],
): ProofCheckStatePatch<"yieldResume"> {
  return proofCheckStatePatchForTest({
    kind: "yieldResume",
    transitionId: proofCheckTransitionId(3401),
    certificate: defaultCertificate,
    constraints: { allowedDropFactKeys: [...invalidatableFactKeys] },
    entries,
  }) as ProofCheckStatePatch<"yieldResume">;
}

function yieldResumeCompanionWithJudge(
  judge: (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined,
): ProofSemanticsCompanion {
  return proofSemanticsCompanionFake({
    providedJudgments: ["yieldResume"],
    fingerprint: defaultFingerprint,
    judge,
  });
}

export function yieldResumeInputForTest(
  overrides: Partial<YieldResumeTransferInput> = {},
): YieldResumeTransferInput {
  return {
    state: proofCheckStateForTest({
      places: [ownedPlaceForTest("receiver")],
      capabilities: [capabilityStateForTest("capability:wake")],
      loans: [exclusiveLoanForTest("receiver")],
    }),
    yieldPointKey: "yield:main",
    resumePointKey: "resume:main",
    wakeCapabilityKey: "capability:wake",
    wakeReceiverPlaceKey: "receiver",
    companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    transitionId: proofCheckTransitionId(1),
    ...overrides,
  };
}

describe("checkYieldResumeTransfer", () => {
  test("yield with live stream member is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          sessions: [streamSessionForTest("session:rx")],
          obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield with live buffer obligation is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          obligations: [obligationStateForTest("obligation:buffer")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield with live validation source is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          validations: [{ validationKey: "validation:packet", status: "live" }],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield with live packet is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("packet")],
          packetSources: [packetSourceForTest("packet", "source")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield with pending attempt is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          attempts: [{ attemptKey: "attempt:fallible", status: "pending" }],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield with unclosed private-state transition is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          facts: [activeFactForTest("private-transition:cell:open")],
        }),
        openPrivateStateTransitionKeys: ["cell"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("yield without wake capability borrow is rejected before companion dispatch", () => {
    const result = checkYieldResumeTransfer(
      yieldResumeInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("receiver")],
          capabilities: [capabilityStateForTest("capability:wake")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("borrowed");
  });

  test("missing companion judgment is rejected after boundary checks", () => {
    const result = checkYieldResumeTransfer(yieldResumeInputForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("accepted yield/resume applies companion patch and preserves wake capability ownership", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("receiver")],
      capabilities: [capabilityStateForTest("capability:wake")],
      loans: [exclusiveLoanForTest("receiver")],
      facts: [activeFactForTest("fact:unstable"), activeFactForTest("fact:preserved")],
    });
    const preservedFactKeys = ["fact:preserved"];
    const invalidatableFactKeys = ["fact:unstable"];

    const companion = yieldResumeCompanionWithJudge((request) => {
      if (request.kind !== "yieldResume") {
        return undefined;
      }
      const input = request.input satisfies ProofYieldResumeJudgmentInput;
      expect(input.stableCapabilityKeys).toEqual(["capability:wake"]);
      expect(input.invalidatableFactKeys).toEqual(invalidatableFactKeys);
      return {
        kind: "yieldResume",
        requestKind: "yieldResume",
        requestKey: input.requestKey,
        companionFingerprint: defaultFingerprint,
        subjectKey: `yield:${input.yieldPointKey}:${input.resumePointKey}`,
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(2),
        patch: yieldResumeOkPatch(invalidatableFactKeys, [
          { kind: "fact", action: "add", fact: activeFactForTest("fact:suspend-frame") },
          { kind: "fact", action: "add", fact: activeFactForTest("fact:resume-frame") },
          { kind: "fact", action: "drop", fact: activeFactForTest("fact:unstable") },
        ]),
      };
    });

    const result = checkYieldResumeTransfer({
      state,
      yieldPointKey: "yield:main",
      resumePointKey: "resume:main",
      wakeCapabilityKey: "capability:wake",
      wakeReceiverPlaceKey: "receiver",
      preservedFactKeys,
      companion,
      operationOriginKey: "origin:yield:main",
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.capabilities.has("capability:wake")).toBe(true);
    expect(result.state.places.get("receiver")?.lifecycle).toBe("owned");
    expect(result.state.facts.has("fact:unstable")).toBe(false);
    expect(result.state.facts.has("fact:preserved")).toBe(true);
    expect(result.state.facts.has("fact:suspend-frame")).toBe(true);
    expect(result.state.facts.has("fact:resume-frame")).toBe(true);
  });

  test("companion patch cannot drop preserved scheduler facts", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("receiver")],
      capabilities: [capabilityStateForTest("capability:wake")],
      loans: [exclusiveLoanForTest("receiver")],
      facts: [activeFactForTest("fact:preserved"), activeFactForTest("fact:volatile")],
    });

    const companion = yieldResumeCompanionWithJudge((request) => {
      if (request.kind !== "yieldResume") {
        return undefined;
      }
      return {
        kind: "yieldResume",
        requestKind: "yieldResume",
        requestKey: request.input.requestKey,
        companionFingerprint: defaultFingerprint,
        subjectKey: `yield:${request.input.yieldPointKey}:${request.input.resumePointKey}`,
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(3),
        patch: yieldResumeOkPatch(
          ["fact:volatile", "fact:preserved"],
          [{ kind: "fact", action: "drop", fact: activeFactForTest("fact:preserved") }],
        ),
      };
    });

    const result = checkYieldResumeTransfer({
      state,
      yieldPointKey: "yield:main",
      resumePointKey: "resume:main",
      wakeCapabilityKey: "capability:wake",
      wakeReceiverPlaceKey: "receiver",
      preservedFactKeys: ["fact:preserved"],
      companion,
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE"),
    );
  });
});

describe("proofSemanticsJudgmentKind", () => {
  test("yieldResume is a closed companion judgment kind", () => {
    expect(proofSemanticsJudgmentKind(String("yieldResume"))).toBe("yieldResume");
    expect(proofCheckPatchKind(String("yieldResume"))).toBe("yieldResume");
  });
});

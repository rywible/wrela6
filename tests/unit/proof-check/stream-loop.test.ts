import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofSemanticsJudgmentKind,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
  type ProofStreamLoopJudgmentInput,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkStreamLoopTransfer,
  type StreamLoopTransferInput,
} from "../../../src/proof-check/domains/stream-loop";
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
  digestHex: "dd".repeat(32),
};

const defaultCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(10),
};

function streamLoopOkPatch(input: {
  readonly yieldedMemberKey: string;
  readonly streamSessionKey: string;
  readonly memberLocalFactKeys: readonly string[];
  readonly entries: readonly ProofCheckStatePatchEntry[];
}): ProofCheckStatePatch<"streamLoop"> {
  return proofCheckStatePatchForTest({
    kind: "streamLoop",
    transitionId: proofCheckTransitionId(3402),
    certificate: defaultCertificate,
    constraints: {
      namedYieldedMemberKey: input.yieldedMemberKey,
      allowedDropFactKeys: [...input.memberLocalFactKeys],
    },
    entries: input.entries,
  }) as ProofCheckStatePatch<"streamLoop">;
}

function streamLoopCompanionWithJudge(
  judge: (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined,
): ProofSemanticsCompanion {
  return proofSemanticsCompanionFake({
    providedJudgments: ["streamLoop"],
    fingerprint: defaultFingerprint,
    judge,
  });
}

export function streamLoopInputForTest(
  overrides: Partial<StreamLoopTransferInput> = {},
): StreamLoopTransferInput {
  return {
    state: proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:yielded", "session:rx")],
    }),
    streamSessionKey: "session:rx",
    yieldedMemberKey: "member:yielded",
    memberLocalFactKeys: [],
    companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    transitionId: proofCheckTransitionId(1),
    ...overrides,
  };
}

describe("checkStreamLoopTransfer", () => {
  test("stream loop closes the named yielded member and drops member-local facts", () => {
    const memberLocalFactKeys = ["fact:member-local"];
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [
        streamMemberObligationForTest("member:yielded", "session:rx"),
        streamMemberObligationForTest("member:other", "session:rx"),
      ],
      facts: [activeFactForTest("fact:member-local"), activeFactForTest("fact:shared")],
    });

    const companion = streamLoopCompanionWithJudge((request) => {
      if (request.kind !== "streamLoop") {
        return undefined;
      }
      const input = request.input satisfies ProofStreamLoopJudgmentInput;
      expect(input.memberLocalFactKeys).toEqual(memberLocalFactKeys);
      return {
        kind: "streamLoop",
        requestKind: "streamLoop",
        requestKey: input.requestKey,
        companionFingerprint: defaultFingerprint,
        subjectKey: input.yieldedMemberKey,
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(11),
        patch: streamLoopOkPatch({
          yieldedMemberKey: "member:yielded",
          streamSessionKey: "session:rx",
          memberLocalFactKeys,
          entries: [
            {
              kind: "obligation",
              action: "close",
              obligation: {
                obligationKey: "member:yielded",
                status: "closed",
                sessionKey: "session:rx",
                memberKey: "member:yielded",
              },
            },
            { kind: "fact", action: "drop", fact: activeFactForTest("fact:member-local") },
          ],
        }),
      };
    });

    const result = checkStreamLoopTransfer({
      state,
      streamSessionKey: "session:rx",
      yieldedMemberKey: "member:yielded",
      memberLocalFactKeys,
      companion,
      operationOriginKey: "origin:stream-loop:yield",
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.obligations.get("member:yielded")?.status).toBe("closed");
    expect(result.state.obligations.get("member:other")?.status).toBe("open");
    expect(result.state.facts.has("fact:member-local")).toBe(false);
    expect(result.state.facts.has("fact:shared")).toBe(true);
    expect(result.state.sessions.has("session:rx")).toBe(true);
  });

  test("stream loop rejects closing unrelated member obligations from companion patch", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [
        streamMemberObligationForTest("member:yielded", "session:rx"),
        streamMemberObligationForTest("member:other", "session:rx"),
      ],
    });

    const companion = streamLoopCompanionWithJudge((request) => {
      if (request.kind !== "streamLoop") {
        return undefined;
      }
      return {
        kind: "streamLoop",
        requestKind: "streamLoop",
        requestKey: request.input.requestKey,
        companionFingerprint: defaultFingerprint,
        subjectKey: request.input.yieldedMemberKey,
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(12),
        patch: streamLoopOkPatch({
          yieldedMemberKey: "member:yielded",
          streamSessionKey: "session:rx",
          memberLocalFactKeys: [],
          entries: [
            {
              kind: "obligation",
              action: "close",
              obligation: {
                obligationKey: "member:other",
                status: "closed",
                sessionKey: "session:rx",
                memberKey: "member:other",
              },
            },
          ],
        }),
      };
    });

    const result = checkStreamLoopTransfer({
      state,
      streamSessionKey: "session:rx",
      yieldedMemberKey: "member:yielded",
      companion,
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("not-named-member");
  });

  test("stream loop rejects closing session while other members remain outstanding", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [
        streamMemberObligationForTest("member:yielded", "session:rx"),
        streamMemberObligationForTest("member:other", "session:rx"),
      ],
    });

    const companion = streamLoopCompanionWithJudge((request) => {
      if (request.kind !== "streamLoop") {
        return undefined;
      }
      return {
        kind: "streamLoop",
        requestKind: "streamLoop",
        requestKey: request.input.requestKey,
        companionFingerprint: defaultFingerprint,
        subjectKey: request.input.yieldedMemberKey,
        dependencyKeys: [],
        certificateId: proofSemanticsCertificateId(13),
        patch: streamLoopOkPatch({
          yieldedMemberKey: "member:yielded",
          streamSessionKey: "session:rx",
          memberLocalFactKeys: [],
          entries: [
            {
              kind: "obligation",
              action: "close",
              obligation: {
                obligationKey: "member:yielded",
                status: "closed",
                sessionKey: "session:rx",
                memberKey: "member:yielded",
              },
            },
            { kind: "session", action: "close", session: streamSessionForTest("session:rx") },
          ],
        }),
      };
    });

    const result = checkStreamLoopTransfer({
      state,
      streamSessionKey: "session:rx",
      yieldedMemberKey: "member:yielded",
      companion,
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outstanding members");
  });

  test("missing companion judgment is rejected after member validation", () => {
    const result = checkStreamLoopTransfer(streamLoopInputForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("stream loop rejects missing yielded member before companion dispatch", () => {
    const result = checkStreamLoopTransfer(
      streamLoopInputForTest({
        state: proofCheckStateForTest({
          sessions: [streamSessionForTest("session:rx")],
        }),
        yieldedMemberKey: "member:missing",
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });
});

describe("proofSemanticsJudgmentKind", () => {
  test("streamLoop is a closed companion judgment kind", () => {
    expect(proofSemanticsJudgmentKind(String("streamLoop"))).toBe("streamLoop");
    expect(proofCheckPatchKind(String("streamLoop"))).toBe("streamLoop");
  });
});

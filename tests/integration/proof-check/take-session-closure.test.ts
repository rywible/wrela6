import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import type { ProofSemanticsJudgmentResult } from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { checkStreamLoopTransfer } from "../../../src/proof-check/domains/stream-loop";
import { checkYieldResumeTransfer } from "../../../src/proof-check/domains/yield-resume";
import {
  applyTakeSessionPatchesForTest,
  checkCrossedScopeExit,
  checkValidatedTakePlaceOperation,
  closeTakeSession,
  dischargeTakeMember,
  openTakeBuffer,
  openTakeStream,
  takeSessionTransferChain,
  yieldStreamMember,
} from "../../../src/proof-check/domains/take-sessions";
import {
  proofCheckCoreCertificateId,
  proofCheckTransitionId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  activeFactForTest,
  capabilityStateForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
  streamMemberForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "../../unit/proof-check/state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

const semanticsFingerprint: ProofAuthorityFingerprint = {
  authorityKind: "semantics",
  targetId: targetId("proof-check-test-target"),
  version: "semantics-v1",
  digestAlgorithm: "sha256",
  digestHex: "ee".repeat(32),
};

const semanticsCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(3401),
};

describe("take session closure integration", () => {
  test("return with open take-buffer obligation is rejected end to end", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
      obligations: [obligationStateForTest("obligation:buffer")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "integration:return:buffer-obligation",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_OBLIGATION",
        ownerKey: "integration:return:buffer-obligation",
        rootCauseKey: "obligation:buffer",
      },
    ]);
  });

  test("live session member return is rejected with deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "integration:return:session-member",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_SESSION_MEMBER",
        ownerKey: "integration:return:session-member",
        rootCauseKey: "member:rx",
      },
    ]);
  });

  test("wrong-session discharge is rejected end to end", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
    });

    const result = dischargeTakeMember({
      state,
      member: streamMemberForTest("member:a", "session:b"),
      operationOriginKey: "integration:discharge:wrong-session",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
        ownerKey: "integration:discharge:wrong-session",
        rootCauseKey: "member:a",
      },
    ]);
  });

  test("accepted stream session closure discharges members and closes session", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const opened = openTakeStream({
      state: initialState,
      sessionKey: "session:batch",
      brandKey: "brand:batch",
      closureObligationKey: "obligation:batch:closure",
      producerEdgePathKey: "edge:rx",
      operationOriginKey: "integration:take:stream",
    });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    let state = applyTakeSessionPatchesForTest(initialState, opened.patches);
    const yielded = yieldStreamMember({
      state,
      sessionKey: "session:batch",
      memberKey: "member:buffer",
      operationOriginKey: "integration:yield:buffer",
    });
    expect(yielded.kind).toBe("ok");
    if (yielded.kind !== "ok") return;
    state = applyTakeSessionPatchesForTest(state, yielded.patches);

    const discharged = dischargeTakeMember({
      state,
      member: streamMemberForTest("member:buffer", "session:batch"),
      operationOriginKey: "integration:discharge:member:buffer",
    });
    expect(discharged.kind).toBe("ok");
    if (discharged.kind !== "ok") return;
    state = applyTakeSessionPatchesForTest(state, discharged.patches);

    const closed = closeTakeSession({
      state,
      sessionKey: "session:batch",
      operationOriginKey: "integration:close:session:batch",
    });
    expect(closed.kind).toBe("ok");
    if (closed.kind !== "ok") return;

    const reduced = reduceProofCheckState(
      initialState,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2602),
        certificate: defaultCertificate,
        entries: [...opened.patches, ...yielded.patches, ...discharged.patches, ...closed.patches],
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;
    expect(reduced.state.sessions.has("session:batch")).toBe(false);
    expect(reduced.state.obligations.get("member:buffer")?.status).toBe("discharged");
  });

  test("take buffer open and discharge clears obligation before scope exit", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });

    const chain = takeSessionTransferChain(initialState, [
      {
        state: initialState,
        operation: "takeBuffer",
        sessionKey: "session:buffer",
        obligationKey: "obligation:buffer",
        bufferPlaceKey: "buffer",
        operationOriginKey: "integration:take:buffer",
      },
      {
        state: initialState,
        operation: "discharge",
        sessionKey: "session:buffer",
        obligationKey: "obligation:buffer",
        operationOriginKey: "integration:discharge:buffer",
      },
    ]);
    expect(chain.kind).toBe("ok");
    if (chain.kind !== "ok") return;

    const nextState = applyTakeSessionPatchesForTest(initialState, chain.patches);
    const exitCheck = checkCrossedScopeExit({
      state: nextState,
      exitKind: "return",
      operationOriginKey: "integration:return:after-buffer-discharge",
    });
    expect(exitCheck.kind).toBe("ok");
  });

  test("open take buffer then return without discharge is rejected", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });

    const opened = openTakeBuffer({
      state: initialState,
      obligationKey: "obligation:buffer",
      bufferPlaceKey: "buffer",
      operationOriginKey: "integration:take:buffer",
    });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const state = applyTakeSessionPatchesForTest(initialState, opened.patches);
    const exitCheck = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "integration:return:leaked-buffer",
    });

    expect(exitCheck.kind).toBe("error");
    if (exitCheck.kind !== "error") return;
    expect(exitCheck.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
  });

  test("validated take blocks return without transfer contract", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
      sessions: [{ sessionKey: "session:validated", brandKey: "validated:packet" }],
      obligations: [
        {
          obligationKey: "obligation:validated:closure",
          status: "open",
          sessionKey: "session:validated",
        },
      ],
    });

    const result = checkValidatedTakePlaceOperation({
      state,
      placeKey: "packet",
      operation: "return",
      operationOriginKey: "integration:return:validated-packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_OBLIGATION",
        ownerKey: "integration:return:validated-packet",
        rootCauseKey: "packet",
      },
    ]);
  });

  test("yield with live session member is rejected before companion dispatch end to end", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("receiver")],
      capabilities: [capabilityStateForTest("capability:wake")],
      loans: [exclusiveLoanForTest("receiver")],
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
    });

    const result = checkYieldResumeTransfer({
      state,
      yieldPointKey: "yield:integration",
      resumePointKey: "resume:integration",
      wakeCapabilityKey: "capability:wake",
      wakeReceiverPlaceKey: "receiver",
      companion: proofSemanticsCompanionFake({ providedJudgments: ["yieldResume"] }),
      operationOriginKey: "integration:yield:session-member",
      transitionId: proofCheckTransitionId(1),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_INVALID_YIELD_BOUNDARY",
        ownerKey: "integration:yield:session-member",
        rootCauseKey: "member:rx",
      },
    ]);
  });

  test("stream loop transfer closes yielded member through reducer replay", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const opened = openTakeStream({
      state: initialState,
      sessionKey: "session:batch",
      brandKey: "brand:batch",
      closureObligationKey: "obligation:batch:closure",
      producerEdgePathKey: "edge:rx",
      operationOriginKey: "integration:take:stream",
    });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    let state = applyTakeSessionPatchesForTest(initialState, opened.patches);
    const yielded = yieldStreamMember({
      state,
      sessionKey: "session:batch",
      memberKey: "member:buffer",
      operationOriginKey: "integration:yield:buffer",
    });
    expect(yielded.kind).toBe("ok");
    if (yielded.kind !== "ok") return;
    state = applyTakeSessionPatchesForTest(state, yielded.patches);

    const memberLocalFactKeys = ["fact:member:buffer"];
    state = proofCheckStateForTest({
      places: [...state.places.values()],
      loans: [...state.loans.values()],
      obligations: [...state.obligations.values()],
      sessions: [...state.sessions.values()],
      facts: [activeFactForTest("fact:member:buffer")],
    });

    const companion = proofSemanticsCompanionFake({
      providedJudgments: ["streamLoop"],
      fingerprint: semanticsFingerprint,
      judge: (request) => {
        if (request.kind !== "streamLoop") {
          return undefined;
        }
        return {
          kind: "streamLoop",
          requestKind: "streamLoop",
          requestKey: request.input.requestKey,
          companionFingerprint: semanticsFingerprint,
          subjectKey: request.input.yieldedMemberKey,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(3402),
          patch: proofCheckStatePatchForTest({
            kind: "streamLoop",
            transitionId: proofCheckTransitionId(3403),
            certificate: semanticsCertificate,
            constraints: {
              namedYieldedMemberKey: "member:buffer",
              allowedDropFactKeys: memberLocalFactKeys,
            },
            entries: [
              {
                kind: "obligation",
                action: "close",
                obligation: {
                  obligationKey: "member:buffer",
                  status: "closed",
                  sessionKey: "session:batch",
                  memberKey: "member:buffer",
                },
              },
              { kind: "fact", action: "drop", fact: activeFactForTest("fact:member:buffer") },
            ],
          }),
        } as ProofSemanticsJudgmentResult;
      },
    });

    const transferred = checkStreamLoopTransfer({
      state,
      streamSessionKey: "session:batch",
      yieldedMemberKey: "member:buffer",
      memberLocalFactKeys,
      companion,
      operationOriginKey: "integration:stream-loop:buffer",
      transitionId: proofCheckTransitionId(1),
    });
    expect(transferred.kind).toBe("ok");
    if (transferred.kind !== "ok") return;

    const reduced = reduceProofCheckState(
      initialState,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(3404),
        certificate: defaultCertificate,
        entries: [...opened.patches, ...yielded.patches],
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;

    const finalState = reduceProofCheckState(
      reduced.state,
      proofCheckStatePatchForTest({
        kind: proofCheckPatchKind("streamLoop"),
        transitionId: proofCheckTransitionId(3405),
        certificate: semanticsCertificate,
        constraints: {
          namedYieldedMemberKey: "member:buffer",
          allowedDropFactKeys: memberLocalFactKeys,
        },
        entries: [
          {
            kind: "obligation",
            action: "close",
            obligation: {
              obligationKey: "member:buffer",
              status: "closed",
              sessionKey: "session:batch",
              memberKey: "member:buffer",
            },
          },
          { kind: "fact", action: "drop", fact: activeFactForTest("fact:member:buffer") },
        ],
      }),
    );
    expect(finalState.kind).toBe("ok");
    if (finalState.kind !== "ok") return;
    expect(finalState.state.obligations.get("member:buffer")?.status).toBe("closed");
    expect(finalState.state.facts.has("fact:member:buffer")).toBe(false);
    expect(transferred.state.obligations.get("member:buffer")?.status).toBe("closed");
  });
});

describe("take session closure public API integration", () => {
  test("live session member return routes through fixture fallback when source syntax is unsupported", () => {
    const source = [
      "fn main(buffer: WritableBuffer) -> WritableBuffer:",
      "    take buffer",
      "    return buffer",
    ].join("\n");
    const syntax = probeProofCheckSourceSyntaxForTest(source);
    const result = checkProofSourceForTest(source, {
      fixtureFallback: { invalidCase: "live-session-member-return" },
    });

    expect(syntax).toBe("unsupported-source-syntax");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
  });

  test("open obligation return rejects at domain layer with deterministic diagnostics", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
      obligations: [obligationStateForTest("obligation:buffer")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "integration:public-api:buffer-obligation",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_LEAKED_OBLIGATION",
        ownerKey: "integration:public-api:buffer-obligation",
        rootCauseKey: "obligation:buffer",
      },
    ]);
  });

  test("wrong-session discharge fixture rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "wrong-session-discharge",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });
});

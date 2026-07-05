import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  applyTakeSessionPatches,
  checkCrossedScopeExit,
  checkValidatedTakePlaceOperation,
  closeTakeSession,
  dischargeTakeMember,
  dischargeTakeObligation,
  openTakeBuffer,
  openTakeStream,
  openTakeValidated,
  takeSessionTransferChain,
  transferTakeSession,
  yieldStreamMember,
} from "../../../src/proof-check/domains/take-sessions";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  obligationStateForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
  streamMemberForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

function bufferObligationForTest(obligationKey: string) {
  return obligationStateForTest(obligationKey);
}

describe("dischargeTakeMember", () => {
  test("wrong stream brand cannot close yielded member", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
    });

    const result = dischargeTakeMember({
      state,
      member: streamMemberForTest("member:a", "session:b"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_WRONG_SESSION_DISCHARGE"),
    );
  });

  test("matching session brand discharges yielded member", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
    });

    const result = dischargeTakeMember({
      state,
      member: streamMemberForTest("member:a", "session:a"),
      operationOriginKey: "origin:discharge:member:a",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "obligation",
        action: "discharge",
        obligation: {
          obligationKey: "member:a",
          status: "discharged",
          sessionKey: "session:a",
          memberKey: "member:a",
        },
      },
    ]);
  });
});

describe("openTakeStream", () => {
  test("opens stream session, producer loan, and closure obligation", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const result = openTakeStream({
      state,
      sessionKey: "session:batch",
      brandKey: "brand:batch",
      closureObligationKey: "obligation:batch:closure",
      producerEdgePathKey: "edge:rx",
      operationOriginKey: "origin:take:stream",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "session")).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "loan")).toBe(true);
    expect(
      result.patches.some(
        (patch) =>
          patch.kind === "obligation" &&
          patch.obligation.obligationKey === "obligation:batch:closure",
      ),
    ).toBe(true);
  });
});

describe("openTakeBuffer", () => {
  test("opens linear buffer obligation", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("buffer")],
    });

    const result = openTakeBuffer({
      state,
      obligationKey: "obligation:buffer",
      bufferPlaceKey: "buffer",
      operationOriginKey: "origin:take:buffer",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "obligation",
        action: "open",
        obligation: { obligationKey: "obligation:buffer", status: "open" },
      },
    ]);
  });
});

describe("openTakeValidated", () => {
  test("opens validated-buffer session and closure obligation", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("packet")],
    });

    const result = openTakeValidated({
      state,
      sessionKey: "session:validated",
      brandKey: "brand:validated",
      closureObligationKey: "obligation:validated:closure",
      validatedPlaceKey: "packet",
      operationOriginKey: "origin:take:validated",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "session",
        action: "open",
        session: { sessionKey: "session:validated", brandKey: "validated:packet" },
      },
      {
        kind: "obligation",
        action: "open",
        obligation: {
          obligationKey: "obligation:validated:closure",
          status: "open",
          sessionKey: "session:validated",
        },
      },
    ]);
  });
});

describe("yieldStreamMember", () => {
  test("tracks outstanding member obligation branded to session", () => {
    const state = proofCheckStateForTest({
      sessions: [{ sessionKey: "session:batch", brandKey: "brand:batch" }],
    });

    const result = yieldStreamMember({
      state,
      sessionKey: "session:batch",
      memberKey: "member:buffer",
      operationOriginKey: "origin:yield:buffer",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches).toEqual([
      {
        kind: "obligation",
        action: "open",
        obligation: {
          obligationKey: "member:buffer",
          status: "open",
          sessionKey: "session:batch",
          memberKey: "member:buffer",
        },
      },
    ]);
  });
});

describe("closeTakeSession", () => {
  test("rejects closing session with outstanding members", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
    });

    const result = closeTakeSession({
      state,
      sessionKey: "session:a",
      operationOriginKey: "origin:close:session:a",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_SESSION_MEMBER"),
    );
  });

  test("closes session after members are discharged", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [
        {
          obligationKey: "member:a",
          status: "discharged",
          sessionKey: "session:a",
          memberKey: "member:a",
        },
        {
          obligationKey: "obligation:closure",
          status: "open",
          sessionKey: "session:a",
        },
      ],
    });

    const result = closeTakeSession({
      state,
      sessionKey: "session:a",
      operationOriginKey: "origin:close:session:a",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some((patch) => patch.kind === "session" && patch.action === "close"),
    ).toBe(true);
  });
});

describe("checkCrossedScopeExit", () => {
  test("return with open buffer obligation is rejected", () => {
    const state = proofCheckStateForTest({
      obligations: [bufferObligationForTest("obligation:buffer")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return:main",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
  });

  test("return with live session member is rejected", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "return",
      operationOriginKey: "origin:return:main",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_SESSION_MEMBER"),
    );
  });

  test("yield with live session member is rejected before companion dispatch", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:rx")],
      obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "yield",
      operationOriginKey: "origin:yield:main",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
    );
  });

  test("break may cross when obligation is explicitly allowed to discharge", () => {
    const state = proofCheckStateForTest({
      obligations: [bufferObligationForTest("obligation:buffer")],
    });

    const result = checkCrossedScopeExit({
      state,
      exitKind: "break",
      allowedDischargeObligationKeys: ["obligation:buffer"],
      operationOriginKey: "origin:break:loop",
    });

    expect(result.kind).toBe("ok");
  });
});

describe("checkValidatedTakePlaceOperation", () => {
  test("validated take place cannot be returned without transfer contract", () => {
    const state = proofCheckStateForTest({
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
      operationOriginKey: "origin:return:packet",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
    );
  });

  test("validated take place may move when transfer contract is selected", () => {
    const state = proofCheckStateForTest({
      sessions: [{ sessionKey: "session:validated", brandKey: "validated:packet" }],
    });

    const result = checkValidatedTakePlaceOperation({
      state,
      placeKey: "packet",
      operation: "move",
      hasTransferContract: true,
      operationOriginKey: "origin:move:packet",
    });

    expect(result.kind).toBe("ok");
  });
});

describe("transferTakeSession", () => {
  test("dispatches takeStream through facade", () => {
    const state = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const result = transferTakeSession({
      state,
      operation: "takeStream",
      sessionKey: "session:batch",
      brandKey: "brand:batch",
      producerEdgePathKey: "edge:rx",
      obligationKey: "obligation:batch:closure",
    });

    expect(result.kind).toBe("ok");
  });

  test("dispatches discharge through facade", () => {
    const state = proofCheckStateForTest({
      sessions: [streamSessionForTest("session:a")],
      obligations: [streamMemberObligationForTest("member:a", "session:a")],
    });

    const result = transferTakeSession({
      state,
      operation: "discharge",
      sessionKey: "session:a",
      member: streamMemberForTest("member:a", "session:a"),
    });

    expect(result.kind).toBe("ok");
  });
});

describe("dischargeTakeObligation", () => {
  test("discharges buffer obligation targeting same session when provided", () => {
    const state = proofCheckStateForTest({
      obligations: [bufferObligationForTest("obligation:buffer")],
    });

    const result = dischargeTakeObligation({
      state,
      obligationKey: "obligation:buffer",
      operationOriginKey: "origin:discharge:buffer",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches[0]).toEqual({
      kind: "obligation",
      action: "discharge",
      obligation: { obligationKey: "obligation:buffer", status: "discharged" },
    });
  });
});

describe("takeSessionTransferChain", () => {
  test("stream take, yield, discharge, and close replay through reducer", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const result = takeSessionTransferChain(initialState, [
      {
        state: initialState,
        operation: "takeStream",
        sessionKey: "session:batch",
        brandKey: "brand:batch",
        producerEdgePathKey: "edge:rx",
        obligationKey: "obligation:batch:closure",
      },
      {
        state: initialState,
        operation: "discharge",
        sessionKey: "session:batch",
        obligationKey: "obligation:batch:closure",
      },
    ]);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const reduced = reduceProofCheckState(
      initialState,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2601),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;
    expect(reduced.state.obligations.get("obligation:batch:closure")?.status).toBe("discharged");
  });

  test("applyTakeSessionPatches advances state for chained transfers", () => {
    const initialState = proofCheckStateForTest({
      places: [ownedPlaceForTest("edge:rx")],
    });

    const openResult = openTakeStream({
      state: initialState,
      sessionKey: "session:batch",
      brandKey: "brand:batch",
      closureObligationKey: "obligation:batch:closure",
      producerEdgePathKey: "edge:rx",
    });
    expect(openResult.kind).toBe("ok");
    if (openResult.kind !== "ok") return;

    const nextState = applyTakeSessionPatches(initialState, openResult.patches);
    const yieldResult = yieldStreamMember({
      state: nextState,
      sessionKey: "session:batch",
      memberKey: "member:buffer",
    });
    expect(yieldResult.kind).toBe("ok");
  });
});

import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import {
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactSubject,
} from "../model/fact-packet";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import type { ProofCheckState } from "../kernel/state";
import { closeLoan } from "./loans";
import { openTakeStream } from "./take-session-stream-operations";
import type {
  CheckCrossedScopeExitInput,
  CheckValidatedTakePlaceOperationInput,
  CloseTakeSessionInput,
  DischargeTakeMemberInput,
  DischargeTakeObligationInput,
  OpenTakeBufferInput,
  OpenTakeValidatedInput,
  TakeSessionTransferInput,
  TakeSessionTransferResult,
  YieldStreamMemberInput,
} from "./take-session-types";
import {
  closeObligationPatch,
  closeSessionPatch,
  defaultOwnerKey,
  dischargeObligationPatch,
  errorTakeTransfer,
  invalidYieldBoundaryDiagnostic,
  leakedObligationDiagnostic,
  leakedPacketDiagnostic,
  leakedSessionMemberDiagnostic,
  leakedValidationDiagnostic,
  liveAttemptKeys,
  livePacketKeys,
  liveValidationKeys,
  missingObligationDiagnostic,
  obligationForMember,
  okTakeTransfer,
  openObligationPatch,
  openSessionAlreadyExistsDiagnostic,
  openSessionPatch,
  sortedLiveSessionMembers,
  sortedOpenObligations,
  sortedOpenSessions,
  validatedSessionForPlace,
  validatedTakePlaceDiagnostic,
  wrongSessionDischargeDiagnostic,
} from "./take-session-support";

export { openTakeStream };

export function openTakeObligation(input: {
  readonly state: ProofCheckState;
  readonly obligationKey: string;
  readonly sessionKey?: string;
  readonly operationOriginKey?: string;
}): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:open-take-obligation");
  const existing = input.state.obligations.get(input.obligationKey);
  if (existing !== undefined && existing.status === "open") {
    return okTakeTransfer();
  }
  if (existing !== undefined) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.duplicate-obligation",
        messageArguments: [{ kind: "text", value: input.obligationKey }],
        message: `Take obligation ${input.obligationKey} is already tracked`,
        ownerKey,
        rootCauseKey: input.obligationKey,
        stableDetail: `operation:open:obligation:${input.obligationKey}:duplicate`,
      }),
    ]);
  }
  return okTakeTransfer([
    openObligationPatch({
      obligationKey: input.obligationKey,
      status: "open",
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    }),
  ]);
}

export function openTakeBuffer(input: OpenTakeBufferInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:take-buffer");
  if (input.state.obligations.has(input.obligationKey)) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.duplicate-obligation",
        messageArguments: [{ kind: "text", value: input.obligationKey }],
        message: `Take buffer obligation ${input.obligationKey} is already open`,
        ownerKey,
        rootCauseKey: input.obligationKey,
        stableDetail: `operation:open:buffer-obligation:${input.obligationKey}:duplicate`,
      }),
    ]);
  }

  return okTakeTransfer([
    openObligationPatch({
      obligationKey: input.obligationKey,
      status: "open",
    }),
  ]);
}

export function openTakeValidated(input: OpenTakeValidatedInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:take-validated");
  if (input.state.sessions.has(input.sessionKey)) {
    return errorTakeTransfer([
      openSessionAlreadyExistsDiagnostic({ sessionKey: input.sessionKey, ownerKey }),
    ]);
  }

  const patches: ProofCheckStatePatchEntry[] = [
    openSessionPatch({
      sessionKey: input.sessionKey,
      brandKey: `validated:${input.validatedPlaceKey}`,
    }),
  ];
  if (!input.state.obligations.has(input.closureObligationKey)) {
    patches.push(
      openObligationPatch({
        obligationKey: input.closureObligationKey,
        status: "open",
        sessionKey: input.sessionKey,
      }),
    );
  }
  return okTakeTransfer(patches);
}

export function yieldStreamMember(input: YieldStreamMemberInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:yield-stream-member");
  const session = input.state.sessions.get(input.sessionKey);
  if (session === undefined) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.missing-session",
        messageArguments: [{ kind: "text", value: input.sessionKey }],
        message: `Cannot yield member for missing session ${input.sessionKey}`,
        ownerKey,
        rootCauseKey: input.sessionKey,
        stableDetail: `operation:yield-member:session:${input.sessionKey}:missing`,
      }),
    ]);
  }

  if (input.state.obligations.has(input.memberKey)) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.duplicate-member",
        messageArguments: [{ kind: "text", value: input.memberKey }],
        message: `Stream member ${input.memberKey} is already outstanding`,
        ownerKey,
        rootCauseKey: input.memberKey,
        stableDetail: `operation:yield-member:member:${input.memberKey}:duplicate`,
      }),
    ]);
  }

  return okTakeTransfer([
    openObligationPatch({
      obligationKey: input.memberKey,
      status: "open",
      sessionKey: input.sessionKey,
      memberKey: input.memberKey,
    }),
  ]);
}

export function dischargeTakeMember(input: DischargeTakeMemberInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:discharge-take-member");
  const obligationKey = input.obligationKey ?? input.member.memberKey;
  const obligation = obligationForMember(input.state, input.member, obligationKey);
  if (obligation === undefined) {
    return errorTakeTransfer([missingObligationDiagnostic({ obligationKey, ownerKey })]);
  }

  if (obligation.status !== "open") {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.obligation-not-open",
        messageArguments: [{ kind: "text", value: obligationKey }],
        message: `Obligation ${obligationKey} is not open`,
        ownerKey,
        rootCauseKey: obligationKey,
        stableDetail: `operation:discharge:obligation:${obligationKey}:status:${obligation.status}`,
      }),
    ]);
  }

  if (obligation.sessionKey !== input.member.sessionKey) {
    return errorTakeTransfer([
      wrongSessionDischargeDiagnostic({
        member: input.member,
        obligation,
        ownerKey,
      }),
    ]);
  }

  if (obligation.memberKey !== undefined && obligation.memberKey !== input.member.memberKey) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
        messageTemplateId: "proof-check.take-session.wrong-member-discharge",
        messageArguments: [
          { kind: "text", value: input.member.memberKey },
          { kind: "text", value: obligation.memberKey },
        ],
        message: `Cannot discharge member ${input.member.memberKey} through obligation ${obligation.memberKey}`,
        ownerKey,
        rootCauseKey: input.member.memberKey,
        stableDetail: `wrong-member-discharge:requested:${input.member.memberKey}:obligation:${obligation.memberKey}`,
      }),
    ]);
  }

  return okTakeTransfer([dischargeObligationPatch(obligation)]);
}

export function dischargeTakeObligation(
  input: DischargeTakeObligationInput,
): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(
    input.operationOriginKey,
    "proof-check:discharge-take-obligation",
  );
  const obligation = input.state.obligations.get(input.obligationKey);
  if (obligation === undefined) {
    return errorTakeTransfer([
      missingObligationDiagnostic({ obligationKey: input.obligationKey, ownerKey }),
    ]);
  }

  if (obligation.status !== "open") {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.obligation-not-open",
        messageArguments: [{ kind: "text", value: input.obligationKey }],
        message: `Obligation ${input.obligationKey} is not open`,
        ownerKey,
        rootCauseKey: input.obligationKey,
        stableDetail: `operation:discharge:obligation:${input.obligationKey}:status:${obligation.status}`,
      }),
    ]);
  }

  if (
    input.sessionKey !== undefined &&
    obligation.sessionKey !== undefined &&
    obligation.sessionKey !== input.sessionKey
  ) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
        messageTemplateId: "proof-check.take-session.wrong-session-obligation-discharge",
        messageArguments: [
          { kind: "text", value: input.obligationKey },
          { kind: "text", value: input.sessionKey },
          { kind: "text", value: obligation.sessionKey },
        ],
        message: `Cannot discharge obligation ${input.obligationKey} through session ${input.sessionKey}`,
        ownerKey,
        rootCauseKey: input.obligationKey,
        stableDetail: `wrong-session-obligation-discharge:obligation:${input.obligationKey}:requested:${input.sessionKey}:actual:${obligation.sessionKey}`,
      }),
    ]);
  }

  return okTakeTransfer([dischargeObligationPatch(obligation)]);
}

export function closeTakeSession(input: CloseTakeSessionInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:close-take-session");
  const session = input.state.sessions.get(input.sessionKey);
  if (session === undefined) {
    return errorTakeTransfer([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.take-session.missing-session",
        messageArguments: [{ kind: "text", value: input.sessionKey }],
        message: `Cannot close missing session ${input.sessionKey}`,
        ownerKey,
        rootCauseKey: input.sessionKey,
        stableDetail: `operation:close:session:${input.sessionKey}:missing`,
      }),
    ]);
  }

  const outstandingMembers = sortedLiveSessionMembers(input.state).filter(
    (obligation) => obligation.sessionKey === input.sessionKey,
  );
  if (outstandingMembers.length > 0) {
    return errorTakeTransfer(
      outstandingMembers.map((obligation) =>
        leakedSessionMemberDiagnostic({
          memberKey: obligation.memberKey ?? obligation.obligationKey,
          exitKind: "return",
          ownerKey,
        }),
      ),
    );
  }

  const openSessionObligations = sortedOpenObligations(input.state).filter(
    (obligation) =>
      obligation.sessionKey === input.sessionKey && obligation.memberKey === undefined,
  );
  const patches: ProofCheckStatePatchEntry[] = [closeSessionPatch(session)];
  for (const obligation of openSessionObligations) {
    patches.push(closeObligationPatch(obligation));
  }
  if (session.streamLoanKey !== undefined) {
    const closeLoanResult = closeLoan({
      state: input.state,
      loanKey: session.streamLoanKey,
      operationOriginKey: ownerKey,
    });
    if (closeLoanResult.kind === "error") {
      return closeLoanResult;
    }
    patches.push(...closeLoanResult.patches);
  }

  return okTakeTransfer(patches);
}

export function checkCrossedScopeExit(
  input: CheckCrossedScopeExitInput,
): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(
    input.operationOriginKey,
    `proof-check:crossed-scope:${input.exitKind}`,
  );
  const allowedDischarges = new Set(input.allowedDischargeObligationKeys ?? []);
  const allowedSessionClosures = new Set(input.allowedCloseSessionKeys ?? []);
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const obligation of sortedOpenObligations(input.state)) {
    if (allowedDischarges.has(obligation.obligationKey)) {
      continue;
    }
    if (obligation.memberKey !== undefined) {
      diagnostics.push(
        input.exitKind === "yield"
          ? invalidYieldBoundaryDiagnostic({
              detail: `yield crosses live session member ${obligation.memberKey}`,
              ownerKey,
              rootCauseKey: obligation.memberKey,
            })
          : leakedSessionMemberDiagnostic({
              memberKey: obligation.memberKey,
              exitKind: input.exitKind,
              ownerKey,
            }),
      );
      continue;
    }
    diagnostics.push(
      input.exitKind === "yield"
        ? invalidYieldBoundaryDiagnostic({
            detail: `yield crosses live obligation ${obligation.obligationKey}`,
            ownerKey,
            rootCauseKey: obligation.obligationKey,
          })
        : leakedObligationDiagnostic({
            obligationKey: obligation.obligationKey,
            exitKind: input.exitKind,
            ownerKey,
          }),
    );
  }

  for (const session of sortedOpenSessions(input.state)) {
    if (allowedSessionClosures.has(session.sessionKey)) {
      continue;
    }
    const hasOpenSessionObligation = sortedOpenObligations(input.state).some(
      (obligation) => obligation.sessionKey === session.sessionKey,
    );
    if (hasOpenSessionObligation) {
      continue;
    }
    diagnostics.push(
      input.exitKind === "yield"
        ? invalidYieldBoundaryDiagnostic({
            detail: `yield crosses live session ${session.sessionKey}`,
            ownerKey,
            rootCauseKey: session.sessionKey,
          })
        : leakedObligationDiagnostic({
            obligationKey: session.sessionKey,
            exitKind: input.exitKind,
            ownerKey,
          }),
    );
  }

  for (const validationKey of liveValidationKeys(input.state)) {
    diagnostics.push(
      input.exitKind === "yield"
        ? invalidYieldBoundaryDiagnostic({
            detail: `yield crosses live validation ${validationKey}`,
            ownerKey,
            rootCauseKey: validationKey,
          })
        : leakedValidationDiagnostic({
            validationKey,
            exitKind: input.exitKind,
            ownerKey,
          }),
    );
  }

  for (const attemptKey of liveAttemptKeys(input.state)) {
    diagnostics.push(
      input.exitKind === "yield"
        ? invalidYieldBoundaryDiagnostic({
            detail: `yield crosses live attempt ${attemptKey}`,
            ownerKey,
            rootCauseKey: attemptKey,
          })
        : leakedObligationDiagnostic({
            obligationKey: attemptKey,
            exitKind: input.exitKind,
            ownerKey,
          }),
    );
  }

  for (const packetKey of livePacketKeys(input.state)) {
    diagnostics.push(
      input.exitKind === "yield"
        ? invalidYieldBoundaryDiagnostic({
            detail: `yield crosses live packet ${packetKey}`,
            ownerKey,
            rootCauseKey: packetKey,
          })
        : leakedPacketDiagnostic({
            packetKey,
            exitKind: input.exitKind,
            ownerKey,
          }),
    );
  }

  if (diagnostics.length > 0) {
    return errorTakeTransfer(diagnostics);
  }
  return okTakeTransfer();
}

export function checkValidatedTakePlaceOperation(
  input: CheckValidatedTakePlaceOperationInput,
): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(
    input.operationOriginKey,
    "proof-check:validated-take-place-operation",
  );
  if (input.hasTransferContract === true) {
    return okTakeTransfer();
  }

  const session = validatedSessionForPlace(input.state, input.placeKey);
  if (session === undefined) {
    return okTakeTransfer();
  }

  return errorTakeTransfer([
    validatedTakePlaceDiagnostic({
      placeKey: input.placeKey,
      operation: input.operation,
      ownerKey,
    }),
  ]);
}

export function transferTakeSession(input: TakeSessionTransferInput): TakeSessionTransferResult {
  switch (input.operation) {
    case "takeStream": {
      if (input.brandKey === undefined || input.producerEdgePathKey === undefined) {
        return errorTakeTransfer([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.take-session.missing-stream-fields",
            messageArguments: [{ kind: "text", value: input.sessionKey }],
            message: "takeStream requires brandKey and producerEdgePathKey",
            ownerKey: defaultOwnerKey(input.operationOriginKey, "proof-check:take-stream"),
            rootCauseKey: input.sessionKey,
            stableDetail: "takeStream:missing-fields",
          }),
        ]);
      }
      const closureObligationKey = input.obligationKey ?? `obligation:${input.sessionKey}:closure`;
      return openTakeStream({
        state: input.state,
        sessionKey: input.sessionKey,
        brandKey: input.brandKey,
        closureObligationKey,
        producerEdgePathKey: input.producerEdgePathKey,
        ...(input.memberPlaceKey === undefined ? {} : { memberPlaceKey: input.memberPlaceKey }),
        operationOriginKey: input.operationOriginKey,
      });
    }
    case "takeBuffer": {
      if (input.obligationKey === undefined || input.bufferPlaceKey === undefined) {
        return errorTakeTransfer([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.take-session.missing-buffer-fields",
            messageArguments: [{ kind: "text", value: input.sessionKey }],
            message: "takeBuffer requires obligationKey and bufferPlaceKey",
            ownerKey: defaultOwnerKey(input.operationOriginKey, "proof-check:take-buffer"),
            rootCauseKey: input.sessionKey,
            stableDetail: "takeBuffer:missing-fields",
          }),
        ]);
      }
      return openTakeBuffer({
        state: input.state,
        obligationKey: input.obligationKey,
        bufferPlaceKey: input.bufferPlaceKey,
        operationOriginKey: input.operationOriginKey,
      });
    }
    case "takeValidated": {
      if (
        input.brandKey === undefined ||
        input.validatedPlaceKey === undefined ||
        input.obligationKey === undefined
      ) {
        return errorTakeTransfer([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.take-session.missing-validated-fields",
            messageArguments: [{ kind: "text", value: input.sessionKey }],
            message: "takeValidated requires brandKey, validatedPlaceKey, and obligationKey",
            ownerKey: defaultOwnerKey(input.operationOriginKey, "proof-check:take-validated"),
            rootCauseKey: input.sessionKey,
            stableDetail: "takeValidated:missing-fields",
          }),
        ]);
      }
      return openTakeValidated({
        state: input.state,
        sessionKey: input.sessionKey,
        brandKey: input.brandKey,
        closureObligationKey: input.obligationKey,
        validatedPlaceKey: input.validatedPlaceKey,
        operationOriginKey: input.operationOriginKey,
      });
    }
    case "discharge": {
      if (input.member !== undefined) {
        return dischargeTakeMember({
          state: input.state,
          member: input.member,
          obligationKey: input.obligationKey,
          operationOriginKey: input.operationOriginKey,
        });
      }
      if (input.obligationKey === undefined) {
        return errorTakeTransfer([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.take-session.missing-discharge-target",
            messageArguments: [{ kind: "text", value: input.sessionKey }],
            message: "discharge requires obligationKey or member",
            ownerKey: defaultOwnerKey(input.operationOriginKey, "proof-check:discharge"),
            rootCauseKey: input.sessionKey,
            stableDetail: "discharge:missing-target",
          }),
        ]);
      }
      return dischargeTakeObligation({
        state: input.state,
        obligationKey: input.obligationKey,
        sessionKey: input.sessionKey,
        operationOriginKey: input.operationOriginKey,
      });
    }
    case "close":
      return closeTakeSession({
        state: input.state,
        sessionKey: input.sessionKey,
        operationOriginKey: input.operationOriginKey,
      });
  }
}

export function takeSessionTransferChain(
  state: ProofCheckState,
  transfers: readonly TakeSessionTransferInput[],
): TakeSessionTransferResult {
  let currentState = state;
  const allPatches: ProofCheckStatePatchEntry[] = [];
  const allPacketEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  for (const transfer of transfers) {
    const result = transferTakeSession({ ...transfer, state: currentState });
    if (result.kind === "error") {
      return result;
    }
    allPatches.push(...result.patches);
    allPacketEntries.push(...result.packetEntries);
    currentState = applyTakeSessionPatchesForTest(currentState, result.patches);
  }

  return { kind: "ok", patches: allPatches, packetEntries: allPacketEntries };
}

export function applyTakeSessionPatchesForTest(
  state: ProofCheckState,
  patches: readonly ProofCheckStatePatchEntry[],
): ProofCheckState {
  const obligations = new Map(state.obligations);
  const sessions = new Map(state.sessions);
  const loans = new Map(state.loans);

  for (const patch of patches) {
    switch (patch.kind) {
      case "obligation":
        obligations.set(patch.obligation.obligationKey, patch.obligation);
        break;
      case "session":
        if (patch.action === "open") {
          sessions.set(patch.session.sessionKey, patch.session);
        } else {
          sessions.delete(patch.session.sessionKey);
        }
        break;
      case "loan":
        if (patch.action === "open") {
          loans.set(patch.loan.loanKey, patch.loan);
        } else {
          loans.delete(patch.loan.loanKey);
        }
        break;
      default:
        break;
    }
  }

  return {
    ...state,
    obligations,
    sessions,
    loans,
  };
}

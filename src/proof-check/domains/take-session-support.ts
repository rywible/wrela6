import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import {
  type CheckedLoanState,
  type CheckedObligationState,
  type CheckedSessionState,
  type ProofCheckState,
  type ProofCheckStreamMember,
} from "../kernel/state";
import type {
  CheckValidatedTakePlaceOperationInput,
  TakeCrossedScopeExitKind,
  TakeSessionTransferResult,
} from "./take-session-types";

export function defaultOwnerKey(ownerKey: string | undefined, fallback: string): string {
  return ownerKey ?? fallback;
}

export function okTakeTransfer(
  patches: readonly ProofCheckStatePatchEntry[] = [],
): TakeSessionTransferResult {
  return { kind: "ok", patches, packetEntries: [] };
}

export function errorTakeTransfer(
  diagnostics: readonly ProofCheckDiagnostic[],
): TakeSessionTransferResult {
  return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
}

export function sortedOpenObligations(state: ProofCheckState): CheckedObligationState[] {
  return [...state.obligations.values()]
    .filter((obligation) => obligation.status === "open")
    .sort((left, right) => compareCodeUnitStrings(left.obligationKey, right.obligationKey));
}

export function sortedLiveSessionMembers(state: ProofCheckState): CheckedObligationState[] {
  return sortedOpenObligations(state).filter((obligation) => obligation.memberKey !== undefined);
}

export function sortedOpenSessions(state: ProofCheckState): CheckedSessionState[] {
  return [...state.sessions.values()].sort((left, right) =>
    compareCodeUnitStrings(left.sessionKey, right.sessionKey),
  );
}

export function obligationForMember(
  state: ProofCheckState,
  member: ProofCheckStreamMember,
  obligationKey: string | undefined,
): CheckedObligationState | undefined {
  if (obligationKey !== undefined) {
    return state.obligations.get(obligationKey);
  }
  return state.obligations.get(member.memberKey);
}

export function openSessionAlreadyExistsDiagnostic(input: {
  readonly sessionKey: string;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.take-session.duplicate-session",
    messageArguments: [{ kind: "text", value: input.sessionKey }],
    message: `Take session ${input.sessionKey} is already open`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.sessionKey,
    stableDetail: `operation:open:session:${input.sessionKey}:duplicate`,
  });
}

export function missingObligationDiagnostic(input: {
  readonly obligationKey: string;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.take-session.missing-obligation",
    messageArguments: [{ kind: "text", value: input.obligationKey }],
    message: `Missing take obligation ${input.obligationKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.obligationKey,
    stableDetail: `operation:discharge:obligation:${input.obligationKey}:missing`,
  });
}

export function wrongSessionDischargeDiagnostic(input: {
  readonly member: ProofCheckStreamMember;
  readonly obligation: CheckedObligationState;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
    messageTemplateId: "proof-check.take-session.wrong-session-discharge",
    messageArguments: [
      { kind: "text", value: input.member.memberKey },
      { kind: "text", value: input.member.sessionKey },
      { kind: "text", value: input.obligation.sessionKey ?? "none" },
    ],
    message: `Cannot discharge member ${input.member.memberKey} through session ${input.member.sessionKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.member.memberKey,
    stableDetail: [
      "wrong-session-discharge",
      `member:${input.member.memberKey}`,
      `requested-session:${input.member.sessionKey}`,
      `obligation-session:${input.obligation.sessionKey ?? "none"}`,
    ].join(":"),
  });
}

export function leakedObligationDiagnostic(input: {
  readonly obligationKey: string;
  readonly exitKind: TakeCrossedScopeExitKind;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_OBLIGATION",
    messageTemplateId: "proof-check.take-session.leaked-obligation",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.obligationKey },
    ],
    message: `${input.exitKind} crosses live obligation ${input.obligationKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.obligationKey,
    stableDetail: `operation:${input.exitKind}:obligation:${input.obligationKey}`,
  });
}

export function leakedSessionMemberDiagnostic(input: {
  readonly memberKey: string;
  readonly exitKind: TakeCrossedScopeExitKind;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_SESSION_MEMBER",
    messageTemplateId: "proof-check.take-session.leaked-session-member",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.memberKey },
    ],
    message: `${input.exitKind} crosses live session member ${input.memberKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.memberKey,
    stableDetail: `operation:${input.exitKind}:session-member:${input.memberKey}`,
  });
}

export function leakedValidationDiagnostic(input: {
  readonly validationKey: string;
  readonly exitKind: TakeCrossedScopeExitKind;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_VALIDATION",
    messageTemplateId: "proof-check.take-session.leaked-validation",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.validationKey },
    ],
    message: `${input.exitKind} crosses live validation ${input.validationKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.validationKey,
    stableDetail: `operation:${input.exitKind}:validation:${input.validationKey}`,
  });
}

export function leakedPacketDiagnostic(input: {
  readonly packetKey: string;
  readonly exitKind: TakeCrossedScopeExitKind;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_PACKET",
    messageTemplateId: "proof-check.take-session.leaked-packet",
    messageArguments: [
      { kind: "text", value: input.exitKind },
      { kind: "text", value: input.packetKey },
    ],
    message: `${input.exitKind} crosses live packet ${input.packetKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.packetKey,
    stableDetail: `operation:${input.exitKind}:packet:${input.packetKey}`,
  });
}

export function invalidYieldBoundaryDiagnostic(input: {
  readonly detail: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_YIELD_BOUNDARY",
    messageTemplateId: "proof-check.take-session.invalid-yield-boundary",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

export function validatedTakePlaceDiagnostic(input: {
  readonly placeKey: string;
  readonly operation: CheckValidatedTakePlaceOperationInput["operation"];
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LEAKED_OBLIGATION",
    messageTemplateId: "proof-check.take-session.validated-place-operation",
    messageArguments: [
      { kind: "text", value: input.operation },
      { kind: "text", value: input.placeKey },
    ],
    message: `Validated take place ${input.placeKey} cannot be ${input.operation}d without transfer contract`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.placeKey,
    stableDetail: `validated-take:${input.operation}:place:${input.placeKey}`,
  });
}

export function streamLoanForProducer(producerEdgePathKey: string): CheckedLoanState {
  return {
    loanKey: `loan:stream:${producerEdgePathKey}`,
    mode: "exclusive",
    placeKey: producerEdgePathKey,
  };
}

export function openObligationPatch(obligation: CheckedObligationState): ProofCheckStatePatchEntry {
  return { kind: "obligation", action: "open", obligation };
}

export function dischargeObligationPatch(
  obligation: CheckedObligationState,
): ProofCheckStatePatchEntry {
  return {
    kind: "obligation",
    action: "discharge",
    obligation: { ...obligation, status: "discharged" },
  };
}

export function closeObligationPatch(
  obligation: CheckedObligationState,
): ProofCheckStatePatchEntry {
  return {
    kind: "obligation",
    action: "close",
    obligation: { ...obligation, status: "closed" },
  };
}

export function openSessionPatch(session: CheckedSessionState): ProofCheckStatePatchEntry {
  return { kind: "session", action: "open", session };
}

export function closeSessionPatch(session: CheckedSessionState): ProofCheckStatePatchEntry {
  return { kind: "session", action: "close", session };
}

export function liveValidationKeys(state: ProofCheckState): readonly string[] {
  return [...state.validations.values()]
    .filter((validation) => validation.status === "pending" || validation.status === "live")
    .map((validation) => validation.validationKey)
    .sort(compareCodeUnitStrings);
}

export function liveAttemptKeys(state: ProofCheckState): readonly string[] {
  return [...state.attempts.values()]
    .filter((attempt) => attempt.status === "pending" || attempt.status === "live")
    .map((attempt) => attempt.attemptKey)
    .sort(compareCodeUnitStrings);
}

export function livePacketKeys(state: ProofCheckState): readonly string[] {
  return [...state.packetSources.values()]
    .filter((packetSource) => state.places.get(packetSource.packetKey)?.lifecycle === "owned")
    .map((packetSource) => packetSource.packetKey)
    .sort(compareCodeUnitStrings);
}

export function validatedSessionForPlace(
  state: ProofCheckState,
  placeKey: string,
): CheckedSessionState | undefined {
  for (const session of sortedOpenSessions(state)) {
    if (session.brandKey === `validated:${placeKey}`) {
      return session;
    }
  }
  return undefined;
}

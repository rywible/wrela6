import type { ProofSemanticsCompanion } from "../authority/semantics-companion";
import {
  semanticsJudgmentSubjectKey,
  validateProofSemanticsJudgmentResult,
  type ProofStreamLoopJudgmentInput,
  type ProofSemanticsJudgmentRequest,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { type ProofCheckTransitionId } from "../ids";
import {
  proofCheckStatePatchWithTransitionId,
  type ProofCheckStatePatch,
  type ProofCheckPatchKind,
} from "../kernel/state-patch";
import { reduceProofCheckState } from "../kernel/state-reducer";
import type { CheckedObligationState, ProofCheckState } from "../kernel/state";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";

export interface StreamLoopTransferInput {
  readonly state: ProofCheckState;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys?: readonly string[];
  readonly companion: ProofSemanticsCompanion;
  readonly transitionId: ProofCheckTransitionId;
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly operationOriginKey?: string;
}

export type StreamLoopTransferResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly patch: ProofCheckStatePatch<"streamLoop">;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function defaultOwnerKey(ownerKey: string | undefined, yieldedMemberKey: string): string {
  return ownerKey ?? `proof-check:stream-loop:${yieldedMemberKey}`;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

function missingCompanionJudgmentDiagnostic(
  judgmentKind: string,
  ownerKey: string,
): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
    messageTemplateId: "proof-check.semantics-companion.missing-judgment",
    messageArguments: [{ kind: "text", value: judgmentKind }],
    message: `Missing companion judgment: ${judgmentKind}.`,
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail: `missing-judgment:${judgmentKind}`,
  });
}

function invalidStreamLoopTransferDiagnostic(input: {
  readonly detail: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.stream-loop.invalid-transfer",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function invalidStatePatchDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
  ownerKey: string,
): readonly ProofCheckDiagnostic[] {
  return sortProofCheckDiagnostics(
    diagnostics.map((diagnostic) =>
      proofCheckDiagnostic({
        ...diagnostic,
        ownerKey,
        rootCauseKey: ownerKey,
      }),
    ),
  );
}

function sortedOpenSessionMembers(
  state: ProofCheckState,
  sessionKey: string,
): CheckedObligationState[] {
  return [...state.obligations.values()]
    .filter(
      (obligation) =>
        obligation.status === "open" &&
        obligation.sessionKey === sessionKey &&
        obligation.memberKey !== undefined,
    )
    .sort((left, right) => compareCodeUnitStrings(left.obligationKey, right.obligationKey));
}

function buildStreamLoopRequest(input: {
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys: readonly string[];
}): ProofSemanticsJudgmentRequest {
  const requestKey = `request:stream-loop:${input.streamSessionKey}:${input.yieldedMemberKey}`;
  const judgmentInput: ProofStreamLoopJudgmentInput = {
    requestKey,
    streamSessionKey: input.streamSessionKey,
    yieldedMemberKey: input.yieldedMemberKey,
    memberLocalFactKeys: [...input.memberLocalFactKeys],
  };
  return { kind: "streamLoop", input: judgmentInput };
}

function validateYieldedMember(input: {
  readonly state: ProofCheckState;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const session = input.state.sessions.get(input.streamSessionKey);
  if (session === undefined) {
    return [
      invalidStreamLoopTransferDiagnostic({
        detail: `stream loop requires open session ${input.streamSessionKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.streamSessionKey,
      }),
    ];
  }

  const obligation = input.state.obligations.get(input.yieldedMemberKey);
  if (obligation === undefined || obligation.status !== "open") {
    return [
      invalidStreamLoopTransferDiagnostic({
        detail: `stream loop requires open yielded member ${input.yieldedMemberKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.yieldedMemberKey,
      }),
    ];
  }

  if (obligation.sessionKey !== input.streamSessionKey) {
    return [
      invalidStreamLoopTransferDiagnostic({
        detail: `yielded member ${input.yieldedMemberKey} does not belong to session ${input.streamSessionKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.yieldedMemberKey,
      }),
    ];
  }

  if (obligation.memberKey !== input.yieldedMemberKey) {
    return [
      invalidStreamLoopTransferDiagnostic({
        detail: `yielded member ${input.yieldedMemberKey} is not tracked as a session member`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.yieldedMemberKey,
      }),
    ];
  }

  return [];
}

function validateStreamLoopPatchScope(input: {
  readonly state: ProofCheckState;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys: readonly string[];
  readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const memberLocalFacts = new Set(input.memberLocalFactKeys);
  const outstandingMembers = sortedOpenSessionMembers(input.state, input.streamSessionKey);
  const otherOutstandingMembers = outstandingMembers.filter(
    (obligation) => obligation.memberKey !== input.yieldedMemberKey,
  );

  for (const entry of input.patch.entries) {
    switch (entry.kind) {
      case "obligation":
        if (entry.obligation.obligationKey !== input.yieldedMemberKey) {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot close obligation ${entry.obligation.obligationKey}`,
              ownerKey: input.ownerKey,
              rootCauseKey: entry.obligation.obligationKey,
            }),
          );
        }
        break;
      case "fact":
        if (entry.action !== "drop") {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot ${entry.action} fact ${entry.fact.factKey}`,
              ownerKey: input.ownerKey,
              rootCauseKey: entry.fact.factKey,
            }),
          );
          break;
        }
        if (!memberLocalFacts.has(entry.fact.factKey)) {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot drop non-member fact ${entry.fact.factKey}`,
              ownerKey: input.ownerKey,
              rootCauseKey: entry.fact.factKey,
            }),
          );
        }
        break;
      case "session":
        if (entry.action !== "close") {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot ${entry.action} session ${entry.session.sessionKey} in context ${input.streamSessionKey}`,
              ownerKey: input.ownerKey,
              rootCauseKey: entry.session.sessionKey,
            }),
          );
          break;
        }
        if (entry.session.sessionKey !== input.streamSessionKey) {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot close session ${entry.session.sessionKey} in context ${input.streamSessionKey}`,
              ownerKey: input.ownerKey,
              rootCauseKey: entry.session.sessionKey,
            }),
          );
          break;
        }
        if (otherOutstandingMembers.length > 0) {
          diagnostics.push(
            invalidStreamLoopTransferDiagnostic({
              detail: `stream loop cannot close session ${input.streamSessionKey} with outstanding members`,
              ownerKey: input.ownerKey,
              rootCauseKey: input.streamSessionKey,
            }),
          );
        }
        break;
      case "validation":
      case "attempt":
      case "capability":
        diagnostics.push(
          invalidStreamLoopTransferDiagnostic({
            detail: `stream loop cannot mutate ${entry.kind} during member transfer`,
            ownerKey: input.ownerKey,
            rootCauseKey: input.yieldedMemberKey,
          }),
        );
        break;
      default:
        diagnostics.push(
          invalidStreamLoopTransferDiagnostic({
            detail: `stream loop cannot apply ${entry.kind} patch entry`,
            ownerKey: input.ownerKey,
            rootCauseKey: input.yieldedMemberKey,
          }),
        );
        break;
    }
  }

  return diagnostics;
}

function applyStreamLoopPatch(input: {
  readonly state: ProofCheckState;
  readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
  readonly transitionId: ProofCheckTransitionId;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys: readonly string[];
  readonly ownerKey: string;
}):
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const reduction = reduceProofCheckState(input.state, {
    ...proofCheckStatePatchWithTransitionId(input.patch, input.transitionId),
    constraints: {
      ...input.patch.constraints,
      namedYieldedMemberKey: input.yieldedMemberKey,
      allowedDropFactKeys: input.memberLocalFactKeys,
    },
  });
  if (reduction.kind === "error") {
    return {
      kind: "error",
      diagnostics: invalidStatePatchDiagnostics(reduction.diagnostics, input.ownerKey),
    };
  }
  return { kind: "ok", state: reduction.state };
}

export function checkStreamLoopTransfer(input: StreamLoopTransferInput): StreamLoopTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, input.yieldedMemberKey);
  const memberLocalFactKeys = sortedUnique(input.memberLocalFactKeys ?? []);
  const dependencyKeys = input.dependencyKeys ?? new Set<string>();

  const memberDiagnostics = validateYieldedMember({
    state: input.state,
    streamSessionKey: input.streamSessionKey,
    yieldedMemberKey: input.yieldedMemberKey,
    ownerKey,
  });
  if (memberDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(memberDiagnostics),
    };
  }

  const request = buildStreamLoopRequest({
    streamSessionKey: input.streamSessionKey,
    yieldedMemberKey: input.yieldedMemberKey,
    memberLocalFactKeys,
  });

  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });
  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(
        validation.diagnostics.map((diagnostic) =>
          proofCheckDiagnostic({
            ...diagnostic,
            ownerKey,
            rootCauseKey: ownerKey,
          }),
        ),
      ),
    };
  }
  if (validation.result.kind !== "streamLoop") {
    return {
      kind: "error",
      diagnostics: [missingCompanionJudgmentDiagnostic("streamLoop", ownerKey)],
    };
  }

  if (validation.result.subjectKey !== semanticsJudgmentSubjectKey(request)) {
    return {
      kind: "error",
      diagnostics: [
        invalidStreamLoopTransferDiagnostic({
          detail: `stream loop subject key mismatch for ${input.yieldedMemberKey}`,
          ownerKey,
          rootCauseKey: input.yieldedMemberKey,
        }),
      ],
    };
  }

  const patchScopeDiagnostics = validateStreamLoopPatchScope({
    state: input.state,
    streamSessionKey: input.streamSessionKey,
    yieldedMemberKey: input.yieldedMemberKey,
    memberLocalFactKeys,
    patch: validation.result.patch,
    ownerKey,
  });
  if (patchScopeDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(patchScopeDiagnostics),
    };
  }

  const applied = applyStreamLoopPatch({
    state: input.state,
    patch: validation.result.patch,
    transitionId: input.transitionId,
    yieldedMemberKey: input.yieldedMemberKey,
    memberLocalFactKeys,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  return {
    kind: "ok",
    state: applied.state,
    patch: proofCheckStatePatchWithTransitionId(validation.result.patch, input.transitionId),
  };
}

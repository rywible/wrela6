import type { ProofSemanticsCompanion } from "../authority/semantics-companion";
import {
  semanticsJudgmentSubjectKey,
  validateProofSemanticsJudgmentResult,
  type ProofYieldResumeJudgmentInput,
  type ProofSemanticsJudgmentRequest,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofCheckTransitionId } from "../ids";
import {
  proofCheckStatePatchWithTransitionId,
  type ProofCheckStatePatch,
  type ProofCheckPatchKind,
} from "../kernel/state-patch";
import { reduceProofCheckState } from "../kernel/state-reducer";
import type { ProofCheckState } from "../kernel/state";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { checkCrossedScopeExit } from "./take-sessions";

export interface YieldResumeTransferInput {
  readonly state: ProofCheckState;
  readonly yieldPointKey: string;
  readonly resumePointKey: string;
  readonly wakeCapabilityKey: string;
  readonly wakeReceiverPlaceKey: string;
  readonly companion: ProofSemanticsCompanion;
  readonly transitionId: ProofCheckTransitionId;
  readonly preservedFactKeys?: readonly string[];
  readonly openPrivateStateTransitionKeys?: readonly string[];
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly operationOriginKey?: string;
}

export type YieldResumeTransferResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly patch: ProofCheckStatePatch<"yieldResume">;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

const YIELD_DEPENDENCY_PREFIX = "yield:";

function defaultOwnerKey(ownerKey: string | undefined, yieldPointKey: string): string {
  return ownerKey ?? `proof-check:yield:${yieldPointKey}`;
}

function invalidYieldBoundaryDiagnostic(input: {
  readonly detail: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_YIELD_BOUNDARY",
    messageTemplateId: "proof-check.yield-resume.invalid-boundary",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
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

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

function collectInvalidatableFactKeys(input: {
  readonly state: ProofCheckState;
  readonly preservedFactKeys: readonly string[];
}): readonly string[] {
  const preserved = new Set(input.preservedFactKeys);
  return sortedUnique([...input.state.facts.keys()].filter((factKey) => !preserved.has(factKey)));
}

function buildYieldResumeDependencyKeys(input: {
  readonly wakeCapabilityKey: string;
  readonly wakeReceiverPlaceKey: string;
  readonly invalidatableFactKeys: readonly string[];
  readonly preservedFactKeys: readonly string[];
}): readonly string[] {
  return sortedUnique([
    `${YIELD_DEPENDENCY_PREFIX}stable-capability:${input.wakeCapabilityKey}`,
    `${YIELD_DEPENDENCY_PREFIX}wake-receiver:${input.wakeReceiverPlaceKey}`,
    ...input.invalidatableFactKeys.map(
      (factKey) => `${YIELD_DEPENDENCY_PREFIX}invalidate:${factKey}`,
    ),
    ...input.preservedFactKeys.map((factKey) => `${YIELD_DEPENDENCY_PREFIX}preserve:${factKey}`),
  ]);
}

function buildYieldResumeRequest(input: {
  readonly yieldPointKey: string;
  readonly resumePointKey: string;
  readonly wakeCapabilityKey: string;
  readonly invalidatableFactKeys: readonly string[];
}): ProofSemanticsJudgmentRequest {
  const requestKey = `request:yield:${input.yieldPointKey}:${input.resumePointKey}`;
  const judgmentInput: ProofYieldResumeJudgmentInput = {
    requestKey,
    yieldPointKey: input.yieldPointKey,
    resumePointKey: input.resumePointKey,
    stableCapabilityKeys: [input.wakeCapabilityKey],
    invalidatableFactKeys: [...input.invalidatableFactKeys],
  };
  return { kind: "yieldResume", input: judgmentInput };
}

function validateWakeCapabilityBoundary(input: {
  readonly state: ProofCheckState;
  readonly wakeCapabilityKey: string;
  readonly wakeReceiverPlaceKey: string;
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];

  if (!input.state.capabilities.has(input.wakeCapabilityKey)) {
    diagnostics.push(
      invalidYieldBoundaryDiagnostic({
        detail: `yield requires live wake capability ${input.wakeCapabilityKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.wakeCapabilityKey,
      }),
    );
  }

  const receiver = input.state.places.get(input.wakeReceiverPlaceKey);
  if (receiver === undefined || receiver.lifecycle !== "owned") {
    diagnostics.push(
      invalidYieldBoundaryDiagnostic({
        detail: `yield requires owned wake receiver ${input.wakeReceiverPlaceKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.wakeReceiverPlaceKey,
      }),
    );
  }

  const borrowedForYield = [...input.state.loans.values()].some(
    (loan) =>
      loan.mode === "exclusive" &&
      (loan.placeKey === input.wakeReceiverPlaceKey || loan.placeKey === input.wakeCapabilityKey),
  );
  if (!borrowedForYield) {
    diagnostics.push(
      invalidYieldBoundaryDiagnostic({
        detail: `yield requires wake capability ${input.wakeCapabilityKey} to be borrowed for yield`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.wakeCapabilityKey,
      }),
    );
  }

  return diagnostics;
}

function validateOpenPrivateStateTransitions(input: {
  readonly state: ProofCheckState;
  readonly openPrivateStateTransitionKeys: readonly string[];
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  for (const transitionKey of [...input.openPrivateStateTransitionKeys].sort(
    compareCodeUnitStrings,
  )) {
    const factKey = `private-transition:${transitionKey}:open`;
    if (input.state.facts.has(factKey)) {
      diagnostics.push(
        invalidYieldBoundaryDiagnostic({
          detail: `yield crosses unclosed private-state transition ${transitionKey}`,
          ownerKey: input.ownerKey,
          rootCauseKey: transitionKey,
        }),
      );
    }
  }
  return diagnostics;
}

function validateWakeCapabilityAfterResume(input: {
  readonly state: ProofCheckState;
  readonly wakeCapabilityKey: string;
  readonly wakeReceiverPlaceKey: string;
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];

  if (!input.state.capabilities.has(input.wakeCapabilityKey)) {
    diagnostics.push(
      invalidYieldBoundaryDiagnostic({
        detail: `resume must preserve wake capability ${input.wakeCapabilityKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.wakeCapabilityKey,
      }),
    );
  }

  const receiver = input.state.places.get(input.wakeReceiverPlaceKey);
  if (receiver === undefined || receiver.lifecycle !== "owned") {
    diagnostics.push(
      invalidYieldBoundaryDiagnostic({
        detail: `resume must preserve wake receiver ownership for ${input.wakeReceiverPlaceKey}`,
        ownerKey: input.ownerKey,
        rootCauseKey: input.wakeReceiverPlaceKey,
      }),
    );
  }

  return diagnostics;
}

function applyYieldResumePatch(input: {
  readonly state: ProofCheckState;
  readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
  readonly transitionId: ProofCheckTransitionId;
  readonly invalidatableFactKeys: readonly string[];
  readonly ownerKey: string;
}):
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const reduction = reduceProofCheckState(input.state, {
    ...proofCheckStatePatchWithTransitionId(input.patch, input.transitionId),
    constraints: {
      ...input.patch.constraints,
      allowedDropFactKeys: input.invalidatableFactKeys,
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

export function checkYieldResumeTransfer(
  input: YieldResumeTransferInput,
): YieldResumeTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, input.yieldPointKey);
  const preservedFactKeys = sortedUnique(input.preservedFactKeys ?? []);
  const openPrivateStateTransitionKeys = sortedUnique(input.openPrivateStateTransitionKeys ?? []);

  const crossedScope = checkCrossedScopeExit({
    state: input.state,
    exitKind: "yield",
    operationOriginKey: ownerKey,
  });
  if (crossedScope.kind === "error") {
    return crossedScope;
  }

  const boundaryDiagnostics = [
    ...validateOpenPrivateStateTransitions({
      state: input.state,
      openPrivateStateTransitionKeys,
      ownerKey,
    }),
    ...validateWakeCapabilityBoundary({
      state: input.state,
      wakeCapabilityKey: input.wakeCapabilityKey,
      wakeReceiverPlaceKey: input.wakeReceiverPlaceKey,
      ownerKey,
    }),
  ];
  if (boundaryDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(boundaryDiagnostics),
    };
  }

  const invalidatableFactKeys = collectInvalidatableFactKeys({
    state: input.state,
    preservedFactKeys,
  });
  const dependencyKeys =
    input.dependencyKeys ??
    new Set(
      buildYieldResumeDependencyKeys({
        wakeCapabilityKey: input.wakeCapabilityKey,
        wakeReceiverPlaceKey: input.wakeReceiverPlaceKey,
        invalidatableFactKeys,
        preservedFactKeys,
      }),
    );

  const request = buildYieldResumeRequest({
    yieldPointKey: input.yieldPointKey,
    resumePointKey: input.resumePointKey,
    wakeCapabilityKey: input.wakeCapabilityKey,
    invalidatableFactKeys,
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
  if (validation.result.kind !== "yieldResume") {
    return {
      kind: "error",
      diagnostics: [missingCompanionJudgmentDiagnostic("yieldResume", ownerKey)],
    };
  }

  if (validation.result.subjectKey !== semanticsJudgmentSubjectKey(request)) {
    return {
      kind: "error",
      diagnostics: [
        invalidYieldBoundaryDiagnostic({
          detail: `yield/resume subject key mismatch for ${input.yieldPointKey}`,
          ownerKey,
          rootCauseKey: input.yieldPointKey,
        }),
      ],
    };
  }

  const applied = applyYieldResumePatch({
    state: input.state,
    patch: validation.result.patch,
    transitionId: input.transitionId,
    invalidatableFactKeys,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  const resumeDiagnostics = validateWakeCapabilityAfterResume({
    state: applied.state,
    wakeCapabilityKey: input.wakeCapabilityKey,
    wakeReceiverPlaceKey: input.wakeReceiverPlaceKey,
    ownerKey,
  });
  if (resumeDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(resumeDiagnostics),
    };
  }

  return {
    kind: "ok",
    state: applied.state,
    patch: proofCheckStatePatchWithTransitionId(validation.result.patch, input.transitionId),
  };
}

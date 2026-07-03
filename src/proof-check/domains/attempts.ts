import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableJson } from "../../shared/stable-json";
import type { ProofMirFunction, ProofMirPlace } from "../../proof-mir/model/graph";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { computeProofCheckCoreMeet } from "../kernel/graph-worklist";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import {
  type CheckedAttemptState,
  type CheckedPlaceLifecycle,
  type ProofCheckState,
  type ProofCheckStructuredPlace,
} from "../kernel/state";
import type { ProofCheckPlaceResolver } from "../kernel/registry/transition-helpers";
import {
  canonicalProofCheckPlaceKey,
  proofMirPlaceIdForPlaceKey,
  tryResolveProofMirPlaceIdForPlaceKey,
} from "../kernel/registry/transition-helpers";

export interface AttemptTransferInput {
  readonly state: ProofCheckState;
  readonly attemptKey: string;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
  readonly pendingResultPlace?: ProofCheckStructuredPlace;
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface AttemptMatchInput {
  readonly state: ProofCheckState;
  readonly attemptKey: string;
  readonly operationOriginKey?: string;
}

export interface AttemptSuccessEdgeInput {
  readonly originalState: ProofCheckState;
  readonly armState: ProofCheckState;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
  readonly internalConsumedPlaces?: readonly ProofCheckStructuredPlace[];
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}

export interface AttemptErrorEdgeInput {
  readonly originalState: ProofCheckState;
  readonly edgeState: ProofCheckState;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface AttemptSplitJoinInput {
  readonly attemptKey: string;
  readonly successState: ProofCheckState;
  readonly errorState: ProofCheckState;
  readonly operationOriginKey?: string;
}

export type AttemptTransferResult =
  | { readonly kind: "ok"; readonly patches: readonly ProofCheckStatePatchEntry[] }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type AttemptSplitJoinResult =
  | {
      readonly kind: "ok";
      readonly joinedState: ProofCheckState;
      readonly meetKind: "exact" | "coreMeet";
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

type DivergentSplitComponentKind =
  | "place"
  | "loan"
  | "obligation"
  | "session"
  | "validation"
  | "attempt"
  | "fact"
  | "packetSource"
  | "privateState"
  | "capability"
  | "layout"
  | "terminal"
  | "divergence"
  | "erasure";

interface DivergentSplitComponent {
  readonly kind: DivergentSplitComponentKind;
  readonly key: string;
}

function defaultOwnerKey(ownerKey: string | undefined, fallback: string): string {
  return ownerKey ?? fallback;
}

function okAttemptTransfer(
  patches: readonly ProofCheckStatePatchEntry[] = [],
): AttemptTransferResult {
  return { kind: "ok", patches };
}

function errorAttemptTransfer(diagnostics: readonly ProofCheckDiagnostic[]): AttemptTransferResult {
  return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
}

function declaredInputPlaceKeys(
  declaredInputs: readonly ProofCheckStructuredPlace[],
  placeResolver?: ProofCheckPlaceResolver,
): ReadonlySet<string> {
  return new Set(
    declaredInputs.map((place) => canonicalProofCheckPlaceKey(place.placeKey, placeResolver)),
  );
}

function placeProjectionIsStrictPrefix(input: {
  readonly candidate: ProofMirPlace["projection"];
  readonly source: ProofMirPlace["projection"];
}): boolean {
  if (input.candidate.length >= input.source.length) {
    return false;
  }
  return input.candidate.every(
    (projection, index) => stableJson(projection) === stableJson(input.source[index]),
  );
}

function placeIsGraphAncestorOfDeclaredInput(input: {
  readonly placeKey: string;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}): boolean {
  if (input.functionGraph === undefined) {
    return false;
  }
  const candidatePlaceId = tryResolveProofMirPlaceIdForPlaceKey(
    input.placeKey,
    input.placeResolver,
  );
  if (candidatePlaceId === undefined) {
    return false;
  }
  const candidate = input.functionGraph.places.get(candidatePlaceId);
  if (candidate === undefined) {
    return false;
  }

  for (const declaredInput of input.declaredInputs) {
    const declaredPlaceId = tryResolveProofMirPlaceIdForPlaceKey(
      declaredInput.placeKey,
      input.placeResolver,
    );
    if (declaredPlaceId === undefined) {
      continue;
    }
    const declared = input.functionGraph.places.get(declaredPlaceId);
    if (declared === undefined) {
      continue;
    }
    if (stableJson(candidate.root) !== stableJson(declared.root)) {
      continue;
    }
    if (
      placeProjectionIsStrictPrefix({
        candidate: candidate.projection,
        source: declared.projection,
      })
    ) {
      return true;
    }
  }
  return false;
}

function placeStatePatch(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly lifecycle: CheckedPlaceLifecycle;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): ProofCheckStatePatchEntry {
  const placeKey = canonicalProofCheckPlaceKey(input.place.placeKey, input.placeResolver);
  return {
    kind: "placeState",
    place: proofMirPlaceIdForPlaceKey(placeKey, input.placeResolver),
    state: { placeKey, lifecycle: input.lifecycle },
  };
}

function isUsablePlaceLifecycle(lifecycle: CheckedPlaceLifecycle): boolean {
  return lifecycle === "owned";
}

function placeLifecycleChanged(
  left: CheckedPlaceLifecycle | undefined,
  right: CheckedPlaceLifecycle | undefined,
): boolean {
  return left !== right;
}

function invalidAttemptSplitDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_ATTEMPT_SPLIT",
    messageTemplateId: "proof-check.attempt.invalid-split",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  });
}

function divergentSplitStateDiagnostic(input: {
  readonly attemptKey: string;
  readonly component: DivergentSplitComponent;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  const stableDetail = `attempt:${input.attemptKey}:divergent:${input.component.kind}:${input.component.key}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
    messageTemplateId: "proof-check.attempt.divergent-split-state",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.component.key,
    stableDetail,
  });
}

function pendingAttemptForKey(attemptKey: string): CheckedAttemptState {
  return {
    attemptKey,
    status: "pending",
  };
}

function consumedAttemptForKey(attemptKey: string): CheckedAttemptState {
  return {
    attemptKey,
    status: "consumed",
  };
}

function sortedUnionKeys(left: Iterable<string>, right: Iterable<string>): readonly string[] {
  return [...new Set([...left, ...right])].sort(compareCodeUnitStrings);
}

function findFirstMapEntryDivergence<Key extends string, Value>(
  left: ReadonlyMap<Key, Value>,
  right: ReadonlyMap<Key, Value>,
  serialize: (value: Value) => string,
  componentKind: DivergentSplitComponentKind,
): DivergentSplitComponent | undefined {
  for (const key of sortedUnionKeys(left.keys(), right.keys())) {
    const leftValue = left.get(key as Key);
    const rightValue = right.get(key as Key);
    if (leftValue === undefined || rightValue === undefined) {
      return { kind: componentKind, key };
    }
    if (serialize(leftValue) !== serialize(rightValue)) {
      return { kind: componentKind, key };
    }
  }
  return undefined;
}

function packetSourcesEqual(
  left: ProofCheckState["packetSources"],
  right: ProofCheckState["packetSources"],
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left.keys()) {
    const leftValue = left.get(key)!;
    const rightValue = right.get(key);
    if (
      rightValue === undefined ||
      leftValue.packetKey !== rightValue.packetKey ||
      leftValue.sourceKey !== rightValue.sourceKey
    ) {
      return false;
    }
  }
  return true;
}

function findFirstDivergentPacketSource(
  left: ProofCheckState,
  right: ProofCheckState,
): DivergentSplitComponent | undefined {
  return findFirstMapEntryDivergence(
    left.packetSources,
    right.packetSources,
    (packetSource) => `${packetSource.packetKey}:${packetSource.sourceKey}`,
    "packetSource",
  );
}

function findFirstDivergentSplitComponent(
  left: ProofCheckState,
  right: ProofCheckState,
): DivergentSplitComponent | undefined {
  const placeDivergence = findFirstMapEntryDivergence(
    left.places,
    right.places,
    (place) => `${place.placeKey}:${place.lifecycle}`,
    "place",
  );
  if (placeDivergence !== undefined) {
    return placeDivergence;
  }

  const loanDivergence = findFirstMapEntryDivergence(
    left.loans,
    right.loans,
    (loan) => `${loan.loanKey}:${loan.mode}:${loan.placeKey}`,
    "loan",
  );
  if (loanDivergence !== undefined) {
    return loanDivergence;
  }

  const obligationDivergence = findFirstMapEntryDivergence(
    left.obligations,
    right.obligations,
    (obligation) =>
      `${obligation.obligationKey}:${obligation.status}:${obligation.sessionKey ?? ""}:${obligation.memberKey ?? ""}`,
    "obligation",
  );
  if (obligationDivergence !== undefined) {
    return obligationDivergence;
  }

  const sessionDivergence = findFirstMapEntryDivergence(
    left.sessions,
    right.sessions,
    (session) => `${session.sessionKey}:${session.brandKey ?? ""}`,
    "session",
  );
  if (sessionDivergence !== undefined) {
    return sessionDivergence;
  }

  const validationDivergence = findFirstMapEntryDivergence(
    left.validations,
    right.validations,
    (validation) => `${validation.validationKey}:${validation.status}`,
    "validation",
  );
  if (validationDivergence !== undefined) {
    return validationDivergence;
  }

  const attemptDivergence = findFirstMapEntryDivergence(
    left.attempts,
    right.attempts,
    (attempt) => `${attempt.attemptKey}:${attempt.status}`,
    "attempt",
  );
  if (attemptDivergence !== undefined) {
    return attemptDivergence;
  }

  const factDivergence = findFirstMapEntryDivergence(
    left.facts,
    right.facts,
    (fact) => `${fact.factKey}:${fact.termKey}`,
    "fact",
  );
  if (factDivergence !== undefined) {
    return factDivergence;
  }

  const packetSourceDivergence = findFirstMapEntryDivergence(
    left.packetSources,
    right.packetSources,
    (packetSource) => `${packetSource.packetKey}:${packetSource.sourceKey}`,
    "packetSource",
  );
  if (packetSourceDivergence !== undefined) {
    return packetSourceDivergence;
  }

  const privateStateDivergence = findFirstMapEntryDivergence(
    left.privateState,
    right.privateState,
    (privateState) => `${privateState.placeKey}:${privateState.generationKey}`,
    "privateState",
  );
  if (privateStateDivergence !== undefined) {
    return privateStateDivergence;
  }

  const capabilityDivergence = findFirstMapEntryDivergence(
    left.capabilities,
    right.capabilities,
    (capability) => `${capability.capabilityKey}:${capability.capabilityKind}`,
    "capability",
  );
  if (capabilityDivergence !== undefined) {
    return capabilityDivergence;
  }

  const layoutDivergence = findFirstMapEntryDivergence(
    left.layout,
    right.layout,
    (layout) => `${layout.bufferKey}:${layout.layoutKey}`,
    "layout",
  );
  if (layoutDivergence !== undefined) {
    return layoutDivergence;
  }

  const terminalDivergence = findFirstMapEntryDivergence(
    left.terminal,
    right.terminal,
    (terminal) => terminal.terminalKey,
    "terminal",
  );
  if (terminalDivergence !== undefined) {
    return terminalDivergence;
  }

  const divergenceDivergence = findFirstMapEntryDivergence(
    left.divergence,
    right.divergence,
    (divergence) => `${divergence.divergenceKey}:${divergence.kind}`,
    "divergence",
  );
  if (divergenceDivergence !== undefined) {
    return divergenceDivergence;
  }

  return findFirstMapEntryDivergence(
    left.erasures,
    right.erasures,
    (erasure) => `${erasure.erasureKey}:${erasure.subjectKey}`,
    "erasure",
  );
}

function placeIsUsableAfterSplitJoin(
  leftLifecycle: CheckedPlaceLifecycle | undefined,
  rightLifecycle: CheckedPlaceLifecycle | undefined,
): boolean {
  if (leftLifecycle === undefined || rightLifecycle === undefined) {
    return leftLifecycle === rightLifecycle;
  }
  const leftUsable = isUsablePlaceLifecycle(leftLifecycle);
  const rightUsable = isUsablePlaceLifecycle(rightLifecycle);
  if (leftUsable || rightUsable) {
    return leftUsable && rightUsable && leftLifecycle === rightLifecycle;
  }
  return leftLifecycle === rightLifecycle;
}

export function recordAttempt(input: AttemptTransferInput): AttemptTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "operation:attempt:record");
  const existing = input.state.attempts.get(input.attemptKey);
  if (existing !== undefined && existing.status !== "closed") {
    return errorAttemptTransfer([
      invalidAttemptSplitDiagnostic({
        ownerKey,
        rootCauseKey: input.attemptKey,
        stableDetail: `attempt:${input.attemptKey}:duplicate`,
      }),
    ]);
  }

  const diagnostics: ProofCheckDiagnostic[] = [];
  for (const declaredInput of input.declaredInputs) {
    const placeKey = canonicalProofCheckPlaceKey(declaredInput.placeKey, input.placeResolver);
    const place = input.state.places.get(placeKey);
    if (place === undefined || !isUsablePlaceLifecycle(place.lifecycle)) {
      diagnostics.push(
        invalidAttemptSplitDiagnostic({
          ownerKey,
          rootCauseKey: placeKey,
          stableDetail: `attempt:${input.attemptKey}:input-not-usable:${placeKey}`,
        }),
      );
    }
  }

  const patches: ProofCheckStatePatchEntry[] = [
    {
      kind: "attempt",
      action: "open",
      attempt: pendingAttemptForKey(input.attemptKey),
    },
  ];
  if (input.pendingResultPlace !== undefined) {
    const pendingPlaceKey = canonicalProofCheckPlaceKey(
      input.pendingResultPlace.placeKey,
      input.placeResolver,
    );
    const pendingPlace = input.state.places.get(pendingPlaceKey);
    if (
      pendingPlace === undefined ||
      (pendingPlace.lifecycle !== "owned" && pendingPlace.lifecycle !== "uninitialized")
    ) {
      diagnostics.push(
        invalidAttemptSplitDiagnostic({
          ownerKey,
          rootCauseKey: pendingPlaceKey,
          stableDetail: `attempt:${input.attemptKey}:pending-result-not-usable:${pendingPlaceKey}`,
        }),
      );
    } else if (pendingPlace.lifecycle === "uninitialized") {
      patches.push(
        placeStatePatch({
          place: input.pendingResultPlace,
          lifecycle: "owned",
          placeResolver: input.placeResolver,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return errorAttemptTransfer(diagnostics);
  }

  return okAttemptTransfer(patches);
}

export function matchAttempt(input: AttemptMatchInput): AttemptTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "operation:attempt:match");
  const attempt = input.state.attempts.get(input.attemptKey);
  if (attempt === undefined || attempt.status !== "pending") {
    return errorAttemptTransfer([
      invalidAttemptSplitDiagnostic({
        ownerKey,
        rootCauseKey: input.attemptKey,
        stableDetail: `attempt:${input.attemptKey}:missing-pending-result`,
      }),
    ]);
  }

  return okAttemptTransfer([
    {
      kind: "attempt",
      action: "consume",
      attempt: consumedAttemptForKey(input.attemptKey),
    },
  ]);
}

export function checkAttemptSuccessEdge(input: AttemptSuccessEdgeInput): AttemptTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "operation:attempt:success");
  const allowedInputs = declaredInputPlaceKeys(
    [...input.declaredInputs, ...(input.internalConsumedPlaces ?? [])],
    input.placeResolver,
  );
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const placeKey of sortedUnionKeys(
    input.originalState.places.keys(),
    input.armState.places.keys(),
  )) {
    const original = input.originalState.places.get(placeKey)?.lifecycle;
    const current = input.armState.places.get(placeKey)?.lifecycle;
    if (!placeLifecycleChanged(original, current)) {
      continue;
    }
    if (
      !allowedInputs.has(placeKey) &&
      !placeIsGraphAncestorOfDeclaredInput({
        placeKey,
        declaredInputs: input.declaredInputs,
        placeResolver: input.placeResolver,
        functionGraph: input.functionGraph,
      })
    ) {
      diagnostics.push(
        invalidAttemptSplitDiagnostic({
          ownerKey,
          rootCauseKey: placeKey,
          stableDetail: `attempt:success:undeclared-consumption:${placeKey}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return errorAttemptTransfer(diagnostics);
  }

  return okAttemptTransfer();
}

export function checkAttemptErrorEdge(input: AttemptErrorEdgeInput): AttemptTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "operation:attempt:error");
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const declaredInput of input.declaredInputs) {
    const declaredPlaceKey = canonicalProofCheckPlaceKey(
      declaredInput.placeKey,
      input.placeResolver,
    );
    const original = input.originalState.places.get(declaredPlaceKey);
    const edgePlace = input.edgeState.places.get(declaredPlaceKey);
    if (original === undefined) {
      if (edgePlace !== undefined) {
        diagnostics.push(
          invalidAttemptSplitDiagnostic({
            ownerKey,
            rootCauseKey: declaredPlaceKey,
            stableDetail: `attempt:error:input-state-mismatch:${declaredPlaceKey}`,
          }),
        );
      }
      continue;
    }
    if (edgePlace === undefined || edgePlace.lifecycle !== original.lifecycle) {
      diagnostics.push(
        invalidAttemptSplitDiagnostic({
          ownerKey,
          rootCauseKey: declaredPlaceKey,
          stableDetail: `attempt:error:input-state-mismatch:${declaredPlaceKey}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return errorAttemptTransfer(diagnostics);
  }

  return okAttemptTransfer();
}

export function checkAttemptSplitJoin(input: AttemptSplitJoinInput): AttemptSplitJoinResult {
  const ownerKey = defaultOwnerKey(
    input.operationOriginKey,
    `operation:attempt:join:${input.attemptKey}`,
  );

  for (const placeKey of sortedUnionKeys(
    input.successState.places.keys(),
    input.errorState.places.keys(),
  )) {
    const successLifecycle = input.successState.places.get(placeKey)?.lifecycle;
    const errorLifecycle = input.errorState.places.get(placeKey)?.lifecycle;
    if (!placeIsUsableAfterSplitJoin(successLifecycle, errorLifecycle)) {
      const component: DivergentSplitComponent = { kind: "place", key: placeKey };
      return {
        kind: "error",
        diagnostics: [
          divergentSplitStateDiagnostic({
            attemptKey: input.attemptKey,
            component,
            ownerKey,
          }),
        ],
      };
    }
  }

  if (!packetSourcesEqual(input.successState.packetSources, input.errorState.packetSources)) {
    const component =
      findFirstDivergentPacketSource(input.successState, input.errorState) ??
      ({ kind: "packetSource", key: input.attemptKey } satisfies DivergentSplitComponent);
    return {
      kind: "error",
      diagnostics: [
        divergentSplitStateDiagnostic({
          attemptKey: input.attemptKey,
          component,
          ownerKey,
        }),
      ],
    };
  }

  const meet = computeProofCheckCoreMeet([input.successState, input.errorState]);
  if (meet === undefined) {
    return {
      kind: "error",
      diagnostics: [
        divergentSplitStateDiagnostic({
          attemptKey: input.attemptKey,
          component: { kind: "attempt", key: input.attemptKey },
          ownerKey,
        }),
      ],
    };
  }

  if (meet.kind === "failed") {
    const component =
      findFirstDivergentSplitComponent(input.successState, input.errorState) ??
      ({ kind: "attempt", key: input.attemptKey } satisfies DivergentSplitComponent);
    return {
      kind: "error",
      diagnostics: [
        divergentSplitStateDiagnostic({
          attemptKey: input.attemptKey,
          component,
          ownerKey,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    joinedState: meet.state,
    meetKind: meet.kind,
  };
}

import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  checkedActiveFactKey,
  checkedAttemptStateKey,
  checkedCapabilityStateKey,
  checkedDivergenceFactKey,
  checkedErasureFactKey,
  checkedLoanStateKey,
  checkedObligationStateKey,
  checkedPacketSourceFactKey,
  checkedPlaceStateKey,
  checkedSessionStateKey,
  checkedTerminalClosureFactKey,
  checkedValidatedBufferFactKey,
  checkedValidationStateKey,
  createProofCheckState,
  type CheckedActiveFact,
  type CheckedAttemptState,
  type CheckedCapabilityState,
  type CheckedDivergenceFact,
  type CheckedErasureFact,
  type CheckedLoanState,
  type CheckedObligationState,
  type CheckedPacketSourceFact,
  type CheckedPlaceLifecycle,
  type CheckedPlaceState,
  type CheckedPrivateStateFact,
  type CheckedSessionState,
  type CheckedTerminalClosureFact,
  type CheckedValidatedBufferFact,
  type CheckedValidationState,
  type ProofCheckState,
} from "./state";
import {
  validatePatchCapabilityAction,
  validatePatchEntryKindAllowed,
  validatePatchFactAction,
  validatePatchObligationAction,
  validatePatchPrivateStateAdvance,
  type PatchPermissionViolation,
} from "./patch-permission-policy";
import {
  proofCheckPatchKind,
  proofCheckStatePatchEntryKind,
  type ProofCheckPatchKind,
  type ProofCheckPrivateStateAdvance,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchConstraints,
  type ProofCheckStatePatchEntry,
  type ProofCheckStatePatchEntryKind,
} from "./state-patch";

export type ProofCheckStateReductionResult =
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | {
      readonly kind: "error";
      readonly state: ProofCheckState;
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    };

function generationKey(value: ProofCheckPrivateStateAdvance["previous"]): string {
  return String(value);
}

function invalidStatePatchDiagnostic(stableDetail: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_STATE_PATCH",
    messageTemplateId: "proof-check.state-patch.invalid",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: "proof-check:state-reducer",
    rootCauseKey: "proof-check:state-reducer",
    stableDetail,
  });
}

function errorResult(
  state: ProofCheckState,
  violations: readonly PatchPermissionViolation[],
): ProofCheckStateReductionResult {
  const diagnostics = sortProofCheckDiagnostics(
    violations.map((violation) => invalidStatePatchDiagnostic(violation.stableDetail)),
  );
  return {
    kind: "error",
    state,
    diagnostics,
  };
}

function isOwnedLifecycle(lifecycle: CheckedPlaceLifecycle): boolean {
  return lifecycle === "owned";
}

function allowsCompanionPlaceStateChange(
  patchKind: ProofCheckPatchKind,
  currentLifecycle: CheckedPlaceLifecycle | undefined,
  nextLifecycle: CheckedPlaceLifecycle,
): boolean {
  if (patchKind === "crossCoreOwnership") {
    return true;
  }
  if (patchKind === "stateJoin" || patchKind === "loopConvergence") {
    if (currentLifecycle === undefined) {
      return false;
    }
    if (
      isOwnedLifecycle(nextLifecycle) &&
      currentLifecycle !== "owned" &&
      currentLifecycle !== "uninitialized"
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function validateFactDropConstraints(
  patchKind: ProofCheckPatchKind,
  factKey: string,
  constraints: ProofCheckStatePatchConstraints | undefined,
): PatchPermissionViolation | undefined {
  if (constraints?.allowedDropFactKeys === undefined) {
    return undefined;
  }
  if (!constraints.allowedDropFactKeys.includes(factKey)) {
    return {
      stableDetail: `patch-kind:${patchKind}:fact-drop:${factKey}:outside-dependency-set`,
    };
  }
  return undefined;
}

function validateExtensionEntryKind(
  entryKind: ProofCheckStatePatchEntryKind,
  constraints: ProofCheckStatePatchConstraints | undefined,
): PatchPermissionViolation | undefined {
  if (constraints?.allowedExtensionEntryKinds === undefined) {
    return { stableDetail: "patch-kind:extensionTransfer:missing-allowed-entry-kinds" };
  }
  if (!constraints.allowedExtensionEntryKinds.includes(entryKind)) {
    return {
      stableDetail: `patch-kind:extensionTransfer:entry:${entryKind}:outside-extension-schema`,
    };
  }
  return undefined;
}

function validatePlaceStateEntry(
  patchKind: ProofCheckPatchKind,
  state: ProofCheckState,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "placeState" }>,
  constraints: ProofCheckStatePatchConstraints | undefined,
): PatchPermissionViolation | undefined {
  const placeKey = entry.state.placeKey;
  const current = state.places.get(placeKey);

  if (patchKind === "crossCoreOwnership") {
    if (
      constraints?.namedSourcePlaceKey !== undefined &&
      placeKey !== constraints.namedSourcePlaceKey
    ) {
      return {
        stableDetail: `patch-kind:crossCoreOwnership:place:${placeKey}:not-named-source`,
      };
    }
  }

  if (patchKind !== "coreTransfer") {
    if (!allowsCompanionPlaceStateChange(patchKind, current?.lifecycle, entry.state.lifecycle)) {
      return {
        stableDetail: `patch-kind:${patchKind}:manufactured-ownership:${placeKey}`,
      };
    }
  }

  if (
    patchKind === "coreTransfer" &&
    current === undefined &&
    isOwnedLifecycle(entry.state.lifecycle)
  ) {
    return {
      stableDetail: `patch-kind:coreTransfer:manufactured-ownership:${placeKey}`,
    };
  }

  return undefined;
}

function validatePatchEntryPermission(
  state: ProofCheckState,
  patch: ProofCheckStatePatch,
  entry: ProofCheckStatePatchEntry,
): PatchPermissionViolation | undefined {
  const patchKind = patch.kind;
  const entryKind = proofCheckStatePatchEntryKind(entry);
  const constraints = patch.constraints;

  const kindViolation = validatePatchEntryKindAllowed(patchKind, entryKind);
  if (kindViolation !== undefined) {
    return kindViolation;
  }

  if (patchKind === "extensionTransfer") {
    const extensionViolation = validateExtensionEntryKind(entryKind, constraints);
    if (extensionViolation !== undefined) {
      return extensionViolation;
    }
  }

  switch (entry.kind) {
    case "placeState":
      return validatePlaceStateEntry(patchKind, state, entry, constraints);
    case "loan":
      if (patchKind !== "coreTransfer") {
        return { stableDetail: `patch-kind:${patchKind}:loan:not-allowed` };
      }
      return undefined;
    case "fact": {
      const actionViolation = validatePatchFactAction(patchKind, entry.action);
      if (actionViolation !== undefined) {
        return actionViolation;
      }
      if (entry.action === "drop" || entry.action === "weaken") {
        return validateFactDropConstraints(patchKind, entry.fact.factKey, constraints);
      }
      return undefined;
    }
    case "obligation":
      return validatePatchObligationAction(
        patchKind,
        entry.action,
        entry.obligation.obligationKey,
        constraints,
      );
    case "session":
      if (patchKind === "coreTransfer" || patchKind === "streamLoop") {
        return undefined;
      }
      return { stableDetail: `patch-kind:${patchKind}:session:not-allowed` };
    case "validation":
    case "attempt":
      if (patchKind === "coreTransfer") {
        return undefined;
      }
      if (patchKind === "stateJoin" || patchKind === "loopConvergence") {
        if (entry.action !== "close") {
          return {
            stableDetail: `patch-kind:${patchKind}:${entry.kind}-action:${entry.action}:not-allowed`,
          };
        }
        return undefined;
      }
      return { stableDetail: `patch-kind:${patchKind}:${entry.kind}:not-allowed` };
    case "privateState":
      return validatePatchPrivateStateAdvance(patchKind, entry.advance, constraints);
    case "capability":
      return validatePatchCapabilityAction(patchKind, entry.action);
    case "terminal":
      if (patchKind === "coreTransfer") {
        return undefined;
      }
      return { stableDetail: `patch-kind:${patchKind}:terminal:not-allowed` };
    case "divergence":
    case "layout":
    case "erasure":
      if (patchKind === "coreTransfer") {
        return undefined;
      }
      if (patchKind === "extensionTransfer") {
        return undefined;
      }
      return { stableDetail: `patch-kind:${patchKind}:${entry.kind}:not-allowed` };
    case "packetSource":
      if (
        patchKind === "coreTransfer" ||
        patchKind === "stateJoin" ||
        patchKind === "loopConvergence"
      ) {
        if (
          constraints?.allowedPacketSourceKeys !== undefined &&
          !constraints.allowedPacketSourceKeys.includes(
            `${entry.packetSource.packetKey}->${entry.packetSource.sourceKey}`,
          )
        ) {
          return {
            stableDetail: `patch-kind:${patchKind}:packet-source:${entry.packetSource.packetKey}->${entry.packetSource.sourceKey}:outside-allowed-set`,
          };
        }
        return undefined;
      }
      return { stableDetail: `patch-kind:${patchKind}:packetSource:not-allowed` };
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

function mapEntries<MapValue>(map: ReadonlyMap<string, MapValue>): Map<string, MapValue> {
  return new Map(map);
}

function applyPlaceStateEntry(
  places: Map<string, CheckedPlaceState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "placeState" }>,
): void {
  places.set(checkedPlaceStateKey(entry.state), entry.state);
}

function applyLoanEntry(
  loans: Map<string, CheckedLoanState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "loan" }>,
): void {
  const key = checkedLoanStateKey(entry.loan);
  if (entry.action === "open") {
    loans.set(key, entry.loan);
    return;
  }
  loans.delete(key);
}

function applyFactEntry(
  facts: Map<string, CheckedActiveFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "fact" }>,
): void {
  const key = checkedActiveFactKey(entry.fact);
  if (entry.action === "add") {
    facts.set(key, entry.fact);
    return;
  }
  facts.delete(key);
}

function applyObligationEntry(
  obligations: Map<string, CheckedObligationState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "obligation" }>,
): void {
  obligations.set(checkedObligationStateKey(entry.obligation), entry.obligation);
}

function applySessionEntry(
  sessions: Map<string, CheckedSessionState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "session" }>,
): void {
  const key = checkedSessionStateKey(entry.session);
  if (entry.action === "open") {
    sessions.set(key, entry.session);
    return;
  }
  sessions.delete(key);
}

function applyValidationEntry(
  validations: Map<string, CheckedValidationState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "validation" }>,
): void {
  const key = checkedValidationStateKey(entry.validation);
  validations.set(key, entry.validation);
}

function applyAttemptEntry(
  attempts: Map<string, CheckedAttemptState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "attempt" }>,
): void {
  const key = checkedAttemptStateKey(entry.attempt);
  attempts.set(key, entry.attempt);
}

function applyPrivateStateEntry(
  privateState: Map<string, CheckedPrivateStateFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "privateState" }>,
): void {
  privateState.set(entry.advance.placeKey, {
    placeKey: entry.advance.placeKey,
    generationKey: generationKey(entry.advance.next),
  });
}

function applyCapabilityEntry(
  capabilities: Map<string, CheckedCapabilityState>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "capability" }>,
): void {
  const key = checkedCapabilityStateKey(entry.capability);
  if (entry.action === "produce" || entry.action === "transfer") {
    capabilities.set(key, entry.capability);
    return;
  }
  capabilities.delete(key);
}

function applyTerminalEntry(
  terminal: Map<string, CheckedTerminalClosureFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "terminal" }>,
): void {
  terminal.set(checkedTerminalClosureFactKey(entry.terminal), entry.terminal);
}

function applyDivergenceEntry(
  divergence: Map<string, CheckedDivergenceFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "divergence" }>,
): void {
  divergence.set(checkedDivergenceFactKey(entry.divergence), entry.divergence);
}

function applyLayoutEntry(
  layout: Map<string, CheckedValidatedBufferFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "layout" }>,
): void {
  layout.set(checkedValidatedBufferFactKey(entry.layout), entry.layout);
}

function applyPacketSourceEntry(
  packetSources: Map<string, CheckedPacketSourceFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "packetSource" }>,
): void {
  packetSources.set(checkedPacketSourceFactKey(entry.packetSource), entry.packetSource);
}

function applyErasureEntry(
  erasures: Map<string, CheckedErasureFact>,
  entry: Extract<ProofCheckStatePatchEntry, { readonly kind: "erasure" }>,
): void {
  erasures.set(checkedErasureFactKey(entry.erasure), entry.erasure);
}

function applyPatchEntry(
  stateMaps: {
    readonly places: Map<string, CheckedPlaceState>;
    readonly loans: Map<string, CheckedLoanState>;
    readonly obligations: Map<string, CheckedObligationState>;
    readonly sessions: Map<string, CheckedSessionState>;
    readonly validations: Map<string, CheckedValidationState>;
    readonly attempts: Map<string, CheckedAttemptState>;
    readonly facts: Map<string, CheckedActiveFact>;
    readonly privateState: Map<string, CheckedPrivateStateFact>;
    readonly layout: Map<string, CheckedValidatedBufferFact>;
    readonly packetSources: Map<string, CheckedPacketSourceFact>;
    readonly capabilities: Map<string, CheckedCapabilityState>;
    readonly terminal: Map<string, CheckedTerminalClosureFact>;
    readonly divergence: Map<string, CheckedDivergenceFact>;
    readonly erasures: Map<string, CheckedErasureFact>;
  },
  entry: ProofCheckStatePatchEntry,
): void {
  switch (entry.kind) {
    case "placeState":
      applyPlaceStateEntry(stateMaps.places, entry);
      break;
    case "loan":
      applyLoanEntry(stateMaps.loans, entry);
      break;
    case "fact":
      applyFactEntry(stateMaps.facts, entry);
      break;
    case "obligation":
      applyObligationEntry(stateMaps.obligations, entry);
      break;
    case "session":
      applySessionEntry(stateMaps.sessions, entry);
      break;
    case "validation":
      applyValidationEntry(stateMaps.validations, entry);
      break;
    case "attempt":
      applyAttemptEntry(stateMaps.attempts, entry);
      break;
    case "privateState":
      applyPrivateStateEntry(stateMaps.privateState, entry);
      break;
    case "capability":
      applyCapabilityEntry(stateMaps.capabilities, entry);
      break;
    case "terminal":
      applyTerminalEntry(stateMaps.terminal, entry);
      break;
    case "divergence":
      applyDivergenceEntry(stateMaps.divergence, entry);
      break;
    case "layout":
      applyLayoutEntry(stateMaps.layout, entry);
      break;
    case "packetSource":
      applyPacketSourceEntry(stateMaps.packetSources, entry);
      break;
    case "erasure":
      applyErasureEntry(stateMaps.erasures, entry);
      break;
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

export function reduceProofCheckState(
  state: ProofCheckState,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
): ProofCheckStateReductionResult {
  proofCheckPatchKind(patch.kind);

  const violations: PatchPermissionViolation[] = [];
  for (const entry of patch.entries) {
    const violation = validatePatchEntryPermission(state, patch, entry);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }

  if (violations.length > 0) {
    return errorResult(state, violations);
  }

  const stateMaps = {
    places: mapEntries(state.places),
    loans: mapEntries(state.loans),
    obligations: mapEntries(state.obligations),
    sessions: mapEntries(state.sessions),
    validations: mapEntries(state.validations),
    attempts: mapEntries(state.attempts),
    facts: mapEntries(state.facts),
    privateState: mapEntries(state.privateState),
    layout: mapEntries(state.layout),
    packetSources: mapEntries(state.packetSources),
    capabilities: mapEntries(state.capabilities),
    terminal: mapEntries(state.terminal),
    divergence: mapEntries(state.divergence),
    erasures: mapEntries(state.erasures),
  };

  for (const entry of patch.entries) {
    applyPatchEntry(stateMaps, entry);
  }

  const nextState = createProofCheckState({
    places: [...stateMaps.places.values()],
    loans: [...stateMaps.loans.values()],
    obligations: [...stateMaps.obligations.values()],
    sessions: [...stateMaps.sessions.values()],
    validations: [...stateMaps.validations.values()],
    attempts: [...stateMaps.attempts.values()],
    facts: [...stateMaps.facts.values()],
    privateState: [...stateMaps.privateState.values()],
    layout: [...stateMaps.layout.values()],
    packetSources: [...stateMaps.packetSources.values()],
    capabilities: [...stateMaps.capabilities.values()],
    terminal: [...stateMaps.terminal.values()],
    divergence: [...stateMaps.divergence.values()],
    erasures: [...stateMaps.erasures.values()],
  });

  return {
    kind: "ok",
    state: nextState,
  };
}

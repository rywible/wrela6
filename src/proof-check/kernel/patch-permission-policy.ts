import type {
  ProofCheckPatchKind,
  ProofCheckPrivateStateAdvance,
  ProofCheckStatePatchConstraints,
  ProofCheckStatePatchEntryKind,
} from "./state-patch";

export interface PatchPermissionViolation {
  readonly stableDetail: string;
}

export type PatchFactAction = "add" | "drop" | "weaken";
export type PatchCapabilityAction = "produce" | "consume" | "transfer";
export type PatchObligationAction = "open" | "discharge" | "close";

export interface PatchKindPermissionPolicy {
  readonly allowedEntryKinds: ReadonlySet<ProofCheckStatePatchEntryKind> | "all";
  readonly factActions: ReadonlySet<PatchFactAction> | "all" | "none";
  readonly allowsFacts: boolean;
}

export const COMPANION_PATCH_ALLOWED_ENTRY_KINDS: Record<
  Exclude<ProofCheckPatchKind, "coreTransfer" | "terminalClosure">,
  ReadonlySet<ProofCheckStatePatchEntryKind>
> = {
  stateJoin: new Set(["placeState", "fact", "packetSource", "obligation", "validation", "attempt"]),
  loopConvergence: new Set([
    "placeState",
    "fact",
    "packetSource",
    "obligation",
    "validation",
    "attempt",
    "privateState",
  ]),
  yieldResume: new Set(["fact"]),
  crossCoreOwnership: new Set(["placeState", "capability", "fact"]),
  streamLoop: new Set(["obligation", "fact", "session"]),
  extensionTransfer: new Set([
    "placeState",
    "loan",
    "fact",
    "obligation",
    "session",
    "validation",
    "attempt",
    "privateState",
    "capability",
    "terminal",
    "divergence",
    "layout",
    "packetSource",
    "erasure",
  ]),
};

export const PATCH_KIND_PERMISSION_POLICIES: Record<
  ProofCheckPatchKind,
  PatchKindPermissionPolicy
> = {
  coreTransfer: {
    allowedEntryKinds: "all",
    factActions: "all",
    allowsFacts: true,
  },
  terminalClosure: {
    allowedEntryKinds: new Set(),
    factActions: "none",
    allowsFacts: false,
  },
  stateJoin: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.stateJoin,
    factActions: new Set(["drop", "weaken"]),
    allowsFacts: true,
  },
  loopConvergence: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.loopConvergence,
    factActions: new Set(["drop", "weaken"]),
    allowsFacts: true,
  },
  yieldResume: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.yieldResume,
    factActions: new Set(["add", "drop"]),
    allowsFacts: true,
  },
  crossCoreOwnership: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.crossCoreOwnership,
    factActions: new Set(["add"]),
    allowsFacts: true,
  },
  streamLoop: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.streamLoop,
    factActions: new Set(["drop"]),
    allowsFacts: true,
  },
  extensionTransfer: {
    allowedEntryKinds: COMPANION_PATCH_ALLOWED_ENTRY_KINDS.extensionTransfer,
    factActions: "none",
    allowsFacts: false,
  },
};

export function isCompanionPatchEntryKindAllowed(
  patchKind: ProofCheckPatchKind,
  entryKind: ProofCheckStatePatchEntryKind,
): boolean {
  const policy = PATCH_KIND_PERMISSION_POLICIES[patchKind];
  if (policy.allowedEntryKinds === "all") {
    return true;
  }
  return policy.allowedEntryKinds.has(entryKind);
}

export function companionPatchEntryKindViolation(
  patchKind: ProofCheckPatchKind,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (isCompanionPatchEntryKindAllowed(patchKind, entryKind)) {
    return undefined;
  }
  if (patchKind === "terminalClosure") {
    return `patch-kind:terminalClosure:entry:${entryKind}:not-allowed`;
  }
  return `patch-kind:${patchKind}:entry:${entryKind}:not-allowed`;
}

export function validatePatchEntryKindAllowed(
  patchKind: ProofCheckPatchKind,
  entryKind: ProofCheckStatePatchEntryKind,
): PatchPermissionViolation | undefined {
  const violation = companionPatchEntryKindViolation(patchKind, entryKind);
  if (violation === undefined) {
    return undefined;
  }
  return { stableDetail: violation };
}

export function validatePatchFactAction(
  patchKind: ProofCheckPatchKind,
  action: PatchFactAction,
): PatchPermissionViolation | undefined {
  const policy = PATCH_KIND_PERMISSION_POLICIES[patchKind];
  if (!policy.allowsFacts) {
    return { stableDetail: `patch-kind:${patchKind}:fact:not-allowed` };
  }
  if (policy.factActions === "all") {
    return undefined;
  }
  if (policy.factActions === "none" || !policy.factActions.has(action)) {
    return { stableDetail: `patch-kind:${patchKind}:fact-action:${action}:not-allowed` };
  }
  return undefined;
}

export function validatePatchCapabilityAction(
  patchKind: ProofCheckPatchKind,
  action: PatchCapabilityAction,
): PatchPermissionViolation | undefined {
  if (patchKind === "coreTransfer") {
    return undefined;
  }
  if (patchKind === "crossCoreOwnership") {
    if (action !== "transfer") {
      return {
        stableDetail: `patch-kind:crossCoreOwnership:capability-action:${action}:not-allowed`,
      };
    }
    return undefined;
  }
  if (action === "produce") {
    return { stableDetail: `patch-kind:${patchKind}:capability-produce:not-allowed` };
  }
  return { stableDetail: `patch-kind:${patchKind}:capability:${action}:not-allowed` };
}

export function validatePatchObligationAction(
  patchKind: ProofCheckPatchKind,
  action: PatchObligationAction,
  obligationKey: string,
  constraints: ProofCheckStatePatchConstraints | undefined,
): PatchPermissionViolation | undefined {
  if (patchKind === "coreTransfer") {
    return undefined;
  }
  if (patchKind === "crossCoreOwnership" || patchKind === "yieldResume") {
    return {
      stableDetail: `patch-kind:${patchKind}:obligation:${obligationKey}:not-allowed`,
    };
  }
  if (patchKind === "streamLoop") {
    if (action !== "close") {
      return { stableDetail: `patch-kind:streamLoop:obligation-action:${action}:not-allowed` };
    }
    if (
      constraints?.namedYieldedMemberKey !== undefined &&
      obligationKey !== constraints.namedYieldedMemberKey
    ) {
      return {
        stableDetail: `patch-kind:streamLoop:obligation:${obligationKey}:not-named-member`,
      };
    }
    return undefined;
  }
  if (patchKind === "stateJoin" || patchKind === "loopConvergence") {
    if (action !== "close") {
      return { stableDetail: `patch-kind:${patchKind}:obligation-action:${action}:not-allowed` };
    }
    return undefined;
  }
  return { stableDetail: `patch-kind:${patchKind}:obligation:not-allowed` };
}

export function validatePatchPrivateStateAdvance(
  patchKind: ProofCheckPatchKind,
  advance: ProofCheckPrivateStateAdvance,
  constraints: ProofCheckStatePatchConstraints | undefined,
): PatchPermissionViolation | undefined {
  if (patchKind === "coreTransfer") {
    return undefined;
  }
  if (patchKind === "loopConvergence") {
    if (
      constraints?.loopCarriedPrivateStateKeys !== undefined &&
      !constraints.loopCarriedPrivateStateKeys.includes(advance.placeKey)
    ) {
      return {
        stableDetail: `patch-kind:loopConvergence:private-state:${advance.placeKey}:not-loop-carried`,
      };
    }
    return undefined;
  }
  return { stableDetail: `patch-kind:${patchKind}:private-state:${advance.placeKey}:not-allowed` };
}

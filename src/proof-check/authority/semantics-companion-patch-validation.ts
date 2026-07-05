import {
  proofCheckPatchKind,
  proofCheckStatePatchEntryKind,
  type ProofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
  type ProofCheckStatePatchEntryKind,
} from "../kernel/state-patch";
import { companionPatchEntryKindViolation } from "../kernel/patch-permission-policy";
import type {
  ProofSemanticsJudgmentKind,
  ProofSemanticsJudgmentRequest,
  ProofStateJoinJudgmentInput,
} from "./semantics-companion";

export function validateSemanticsCompanionPatchEntryPermissions(
  judgmentKind: ProofSemanticsJudgmentKind,
  request: ProofSemanticsJudgmentRequest,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
): string | undefined {
  const expectedPatchKind = judgmentKind as ProofCheckPatchKind;
  if (patch.kind !== expectedPatchKind) {
    return `patch-kind-mismatch:expected:${expectedPatchKind}:actual:${patch.kind}`;
  }

  for (const entry of patch.entries) {
    const entryKind = proofCheckStatePatchEntryKind(entry);
    const entryViolation = validatePatchEntryForJudgment(
      judgmentKind,
      request,
      patch,
      entry,
      entryKind,
    );
    if (entryViolation !== undefined) {
      return entryViolation;
    }
  }
  return undefined;
}

function validatePatchEntryForJudgment(
  judgmentKind: ProofSemanticsJudgmentKind,
  request: ProofSemanticsJudgmentRequest,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  switch (judgmentKind) {
    case "entailment":
    case "terminalClosure":
      return `patch-not-allowed:${judgmentKind}`;
    case "stateJoin":
      return validateStateJoinPatchEntry(request, entry, entryKind);
    case "loopConvergence":
      return validateLoopConvergencePatchEntry(request, entry, entryKind);
    case "yieldResume":
      return validateYieldResumePatchEntry(request, entry, entryKind);
    case "crossCoreOwnership":
      return validateCrossCoreOwnershipPatchEntry(request, entry, entryKind);
    case "streamLoop":
      return validateStreamLoopPatchEntry(request, entry, entryKind);
    case "extensionTransfer":
      return validateExtensionTransferPatchEntry(request, patch, entry, entryKind);
    default: {
      const _exhaustive: never = judgmentKind;
      return _exhaustive;
    }
  }
}

function validateStateJoinPatchEntry(
  request: ProofSemanticsJudgmentRequest,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "stateJoin") {
    return "stateJoin:request-kind-mismatch";
  }
  const violation = companionPatchEntryKindViolation("stateJoin", entryKind);
  if (violation !== undefined) {
    return `stateJoin:entry:${entryKind}:not-allowed`;
  }
  return validateJoinLikePatchEntry(request.input, entry);
}

function validateLoopConvergencePatchEntry(
  request: ProofSemanticsJudgmentRequest,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "loopConvergence") {
    return "loopConvergence:request-kind-mismatch";
  }
  const violation = companionPatchEntryKindViolation("loopConvergence", entryKind);
  if (violation !== undefined) {
    return `loopConvergence:entry:${entryKind}:not-allowed`;
  }
  if (entry.kind === "privateState") {
    if (!request.input.loopCarriedPrivateStateKeys.includes(entry.advance.placeKey)) {
      return `loopConvergence:private-state:${entry.advance.placeKey}:not-loop-carried`;
    }
    return undefined;
  }
  return validateJoinLikePatchEntryWithoutDropConstraints(entry);
}

function validateJoinLikePatchEntry(
  input: ProofStateJoinJudgmentInput,
  entry: ProofCheckStatePatchEntry,
): string | undefined {
  const allowedDropFactKeys = input.allowedDropFactKeys;
  const allowedPacketSourceKeys = input.allowedPacketSourceKeys;

  switch (entry.kind) {
    case "fact":
      if (entry.action === "add") {
        return "stateJoin:fact-action:add:not-allowed";
      }
      if (
        (entry.action === "drop" || entry.action === "weaken") &&
        !allowedDropFactKeys.includes(entry.fact.factKey)
      ) {
        return `stateJoin:fact-drop:${entry.fact.factKey}:outside-dependency-set`;
      }
      return undefined;
    case "packetSource": {
      const packetSourceKey = `${entry.packetSource.packetKey}->${entry.packetSource.sourceKey}`;
      if (!allowedPacketSourceKeys.includes(packetSourceKey)) {
        return `stateJoin:packet-source:${packetSourceKey}:outside-allowed-set`;
      }
      return undefined;
    }
    case "obligation":
    case "validation":
    case "attempt":
      if (entry.action !== "close") {
        return `stateJoin:${entry.kind}-action:${entry.action}:not-allowed`;
      }
      if (entry.kind === "validation") {
        return `stateJoin:validation:${entry.validation.validationKey}:not-owned`;
      }
      if (entry.kind === "attempt") {
        return `stateJoin:attempt:${entry.attempt.attemptKey}:not-owned`;
      }
      return undefined;
    case "placeState":
      return undefined;
    default:
      return `stateJoin:entry:${entry.kind}:not-allowed`;
  }
}

function validateJoinLikePatchEntryWithoutDropConstraints(
  entry: ProofCheckStatePatchEntry,
): string | undefined {
  switch (entry.kind) {
    case "fact":
      if (entry.action === "add") {
        return "loopConvergence:fact-action:add:not-allowed";
      }
      return undefined;
    case "packetSource":
    case "obligation":
    case "validation":
    case "attempt":
      if (entry.kind === "obligation" || entry.kind === "validation" || entry.kind === "attempt") {
        if (entry.action !== "close") {
          return `loopConvergence:${entry.kind}-action:${entry.action}:not-allowed`;
        }
        if (entry.kind === "validation") {
          return `loopConvergence:validation:${entry.validation.validationKey}:not-loop-owned`;
        }
        if (entry.kind === "attempt") {
          return `loopConvergence:attempt:${entry.attempt.attemptKey}:not-loop-owned`;
        }
      }
      return undefined;
    case "placeState":
      return undefined;
    default:
      return `loopConvergence:entry:${entry.kind}:not-allowed`;
  }
}

function validateYieldResumePatchEntry(
  request: ProofSemanticsJudgmentRequest,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "yieldResume") {
    return "yieldResume:request-kind-mismatch";
  }
  const violation = companionPatchEntryKindViolation("yieldResume", entryKind);
  if (violation !== undefined) {
    return `yieldResume:entry:${entryKind}:not-allowed`;
  }
  if (entry.kind !== "fact") {
    return undefined;
  }
  if (entry.action === "weaken") {
    return "yieldResume:fact-action:weaken:not-allowed";
  }
  if (
    entry.action === "drop" &&
    !request.input.invalidatableFactKeys.includes(entry.fact.factKey)
  ) {
    return `yieldResume:fact-drop:${entry.fact.factKey}:outside-invalidatable-set`;
  }
  return undefined;
}

function validateCrossCoreOwnershipPatchEntry(
  request: ProofSemanticsJudgmentRequest,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "crossCoreOwnership") {
    return "crossCoreOwnership:request-kind-mismatch";
  }
  const violation = companionPatchEntryKindViolation("crossCoreOwnership", entryKind);
  if (violation !== undefined) {
    return `crossCoreOwnership:entry:${entryKind}:not-allowed`;
  }
  switch (entry.kind) {
    case "placeState":
      if (entry.state.placeKey !== request.input.sourcePlaceKey) {
        return `crossCoreOwnership:place:${entry.state.placeKey}:not-named-source`;
      }
      return undefined;
    case "capability":
      if (entry.action !== "transfer") {
        return `crossCoreOwnership:capability-action:${entry.action}:not-allowed`;
      }
      if (entry.capability.capabilityKey !== request.input.sourcePlaceKey) {
        return `crossCoreOwnership:capability:${entry.capability.capabilityKey}:not-named-source`;
      }
      return undefined;
    case "fact":
      if (entry.action !== "add") {
        return `crossCoreOwnership:fact-action:${entry.action}:not-allowed`;
      }
      if (entry.fact.factKey !== request.input.orderingFactKey) {
        return `crossCoreOwnership:fact:${entry.fact.factKey}:not-ordering-fact`;
      }
      return undefined;
    default:
      return `crossCoreOwnership:entry:${entryKind}:not-allowed`;
  }
}

function validateStreamLoopPatchEntry(
  request: ProofSemanticsJudgmentRequest,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "streamLoop") {
    return "streamLoop:request-kind-mismatch";
  }
  const violation = companionPatchEntryKindViolation("streamLoop", entryKind);
  if (violation !== undefined) {
    return `streamLoop:entry:${entryKind}:not-allowed`;
  }
  switch (entry.kind) {
    case "obligation":
      if (entry.action !== "close") {
        return `streamLoop:obligation-action:${entry.action}:not-allowed`;
      }
      if (entry.obligation.obligationKey !== request.input.yieldedMemberKey) {
        return `streamLoop:obligation:${entry.obligation.obligationKey}:not-named-member`;
      }
      return undefined;
    case "fact":
      if (entry.action !== "drop") {
        return `streamLoop:fact-action:${entry.action}:not-allowed`;
      }
      if (!request.input.memberLocalFactKeys.includes(entry.fact.factKey)) {
        return `streamLoop:fact-drop:${entry.fact.factKey}:outside-member-local-set`;
      }
      return undefined;
    case "session":
      if (entry.action !== "close") {
        return `streamLoop:session-action:${entry.action}:not-allowed`;
      }
      if (entry.session.sessionKey !== request.input.streamSessionKey) {
        return `streamLoop:session-action:${entry.action}:session:${entry.session.sessionKey}:context:${request.input.streamSessionKey}:not-current-session`;
      }
      return undefined;
    default:
      return `streamLoop:entry:${entryKind}:not-allowed`;
  }
}

function validateExtensionTransferPatchEntry(
  request: ProofSemanticsJudgmentRequest,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
  entry: ProofCheckStatePatchEntry,
  entryKind: ProofCheckStatePatchEntryKind,
): string | undefined {
  if (request.kind !== "extensionTransfer") {
    return "extensionTransfer:request-kind-mismatch";
  }
  const allowedPatchKinds = request.input.allowedPatchKinds.map((kind) =>
    proofCheckPatchKind(String(kind)),
  );
  if (!allowedPatchKinds.includes("extensionTransfer")) {
    return "extensionTransfer:patch-kind:not-declared-by-schema";
  }
  if (
    patch.constraints?.allowedExtensionEntryKinds !== undefined &&
    !patch.constraints.allowedExtensionEntryKinds.includes(entryKind)
  ) {
    return `extensionTransfer:entry:${entryKind}:outside-declared-schema`;
  }
  return undefined;
}

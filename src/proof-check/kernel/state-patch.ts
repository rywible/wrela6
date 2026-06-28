import type { ProofMirPlaceId, ProofMirPrivateStateGenerationId } from "../../proof-mir/ids";
import type { ProofCheckTransitionId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import type {
  CheckedActiveFact,
  CheckedAttemptState,
  CheckedCapabilityState,
  CheckedDivergenceFact,
  CheckedErasureFact,
  CheckedLoanState,
  CheckedObligationState,
  CheckedPacketSourceFact,
  CheckedPlaceState,
  CheckedSessionState,
  CheckedTerminalClosureFact,
  CheckedValidatedBufferFact,
  CheckedValidationState,
} from "./state";

export const PROOF_CHECK_PATCH_KINDS = [
  "coreTransfer",
  "stateJoin",
  "loopConvergence",
  "yieldResume",
  "crossCoreOwnership",
  "streamLoop",
  "extensionTransfer",
  "terminalClosure",
] as const;

export type ProofCheckPatchKind = (typeof PROOF_CHECK_PATCH_KINDS)[number];

const PROOF_CHECK_PATCH_KIND_SET: ReadonlySet<string> = new Set(PROOF_CHECK_PATCH_KINDS);

export function proofCheckPatchKind(value: string): ProofCheckPatchKind {
  if (!PROOF_CHECK_PATCH_KIND_SET.has(value)) {
    throw new RangeError(`Unknown proof-check patch kind: ${value}.`);
  }
  return value as ProofCheckPatchKind;
}

export const PROOF_CHECK_STATE_PATCH_ENTRY_KINDS = [
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
] as const;

export type ProofCheckStatePatchEntryKind = (typeof PROOF_CHECK_STATE_PATCH_ENTRY_KINDS)[number];

export interface ProofCheckPrivateStateAdvance {
  readonly placeKey: string;
  readonly previous: ProofMirPrivateStateGenerationId | string;
  readonly next: ProofMirPrivateStateGenerationId | string;
  readonly transitionKey: string;
}

export type ProofCheckStatePatchEntry =
  | {
      readonly kind: "placeState";
      readonly place: ProofMirPlaceId;
      readonly state: CheckedPlaceState;
    }
  | { readonly kind: "loan"; readonly action: "open" | "close"; readonly loan: CheckedLoanState }
  | {
      readonly kind: "fact";
      readonly action: "add" | "drop" | "weaken";
      readonly fact: CheckedActiveFact;
    }
  | {
      readonly kind: "obligation";
      readonly action: "open" | "discharge" | "close";
      readonly obligation: CheckedObligationState;
    }
  | {
      readonly kind: "session";
      readonly action: "open" | "close";
      readonly session: CheckedSessionState;
    }
  | {
      readonly kind: "validation";
      readonly action: "open" | "consume" | "close";
      readonly validation: CheckedValidationState;
    }
  | {
      readonly kind: "attempt";
      readonly action: "open" | "consume" | "close";
      readonly attempt: CheckedAttemptState;
    }
  | { readonly kind: "privateState"; readonly advance: ProofCheckPrivateStateAdvance }
  | {
      readonly kind: "capability";
      readonly action: "produce" | "consume" | "transfer";
      readonly capability: CheckedCapabilityState;
    }
  | { readonly kind: "terminal"; readonly terminal: CheckedTerminalClosureFact }
  | { readonly kind: "divergence"; readonly divergence: CheckedDivergenceFact }
  | { readonly kind: "layout"; readonly layout: CheckedValidatedBufferFact }
  | { readonly kind: "packetSource"; readonly packetSource: CheckedPacketSourceFact }
  | { readonly kind: "erasure"; readonly erasure: CheckedErasureFact };

export interface ProofCheckStatePatchConstraints {
  readonly allowedDropFactKeys?: readonly string[];
  readonly allowedPrivateStateDependencyKeys?: readonly string[];
  readonly allowedExtensionEntryKinds?: readonly ProofCheckStatePatchEntryKind[];
  readonly namedSourcePlaceKey?: string;
  readonly namedYieldedMemberKey?: string;
  readonly loopCarriedPrivateStateKeys?: readonly string[];
  readonly allowedPacketSourceKeys?: readonly string[];
}

export interface ProofCheckStatePatch<Kind extends ProofCheckPatchKind = ProofCheckPatchKind> {
  readonly kind: Kind;
  readonly transitionId: ProofCheckTransitionId;
  readonly entries: readonly ProofCheckStatePatchEntry[];
  readonly certificate: ProofCheckCertificateId;
  readonly constraints?: ProofCheckStatePatchConstraints;
}

export interface ProofCheckStatePatchInput {
  readonly kind: string;
  readonly transitionId?: ProofCheckTransitionId;
  readonly certificate?: ProofCheckCertificateId;
  readonly entries?: readonly ProofCheckStatePatchEntry[];
  readonly constraints?: ProofCheckStatePatchConstraints;
}

export function proofCheckStatePatchWithTransitionId<Kind extends ProofCheckPatchKind>(
  patch: Omit<ProofCheckStatePatch<Kind>, "transitionId"> & {
    readonly transitionId?: ProofCheckTransitionId;
  },
  transitionId: ProofCheckTransitionId,
): ProofCheckStatePatch<Kind> {
  return {
    ...patch,
    transitionId,
  };
}

export function proofCheckStatePatchEntryKind(
  entry: ProofCheckStatePatchEntry,
): ProofCheckStatePatchEntryKind {
  return entry.kind as ProofCheckStatePatchEntryKind;
}

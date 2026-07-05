import type { TargetId } from "../../semantic/ids";
import type { ProofAuthorityFingerprint } from "./authority-types";
import type {
  ProofCheckStateDigest,
  ProofMirExtensionKind,
  ProofSemanticsCompanion,
  ProofSemanticsJudgmentKind,
  ProofSemanticsJudgmentRequest,
  ProofSemanticsJudgmentResult,
} from "./semantics-companion";

export function proofSemanticsCompanion(input: {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly schemaVersion: string;
  readonly providedJudgments: readonly ProofSemanticsJudgmentKind[];
  readonly judge: (
    request: ProofSemanticsJudgmentRequest,
  ) => ProofSemanticsJudgmentResult | undefined;
}): ProofSemanticsCompanion {
  return {
    fingerprint: input.fingerprint,
    targetId: input.targetId,
    schemaVersion: input.schemaVersion,
    providedJudgments: [...input.providedJudgments],
    judge: input.judge,
  };
}

export function proofCheckStateDigest(stateKey: string): ProofCheckStateDigest {
  return { stateKey };
}

export function proofMirExtensionKind(value: string): ProofMirExtensionKind {
  if (
    value !== "crossCoreOwnership" &&
    value !== "coroutineYield" &&
    value !== "streamLoop" &&
    value !== "targetSpecific"
  ) {
    throw new RangeError(`Unknown ProofMirExtensionKind: ${value}.`);
  }
  return value;
}

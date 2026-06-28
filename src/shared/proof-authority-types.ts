import type { TargetId } from "../semantic/ids";

export interface ProofAuthorityFingerprint {
  readonly authorityKind: "platform" | "runtime" | "typeFacts" | "layout" | "semantics";
  readonly targetId: TargetId;
  readonly version: string;
  readonly digestAlgorithm: "sha256";
  readonly digestHex: string;
}

export function proofAuthorityFingerprintsEqual(
  left: ProofAuthorityFingerprint | undefined,
  right: ProofAuthorityFingerprint | undefined,
): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    left.authorityKind === right.authorityKind &&
    left.targetId === right.targetId &&
    left.version === right.version &&
    left.digestAlgorithm === right.digestAlgorithm &&
    left.digestHex === right.digestHex
  );
}

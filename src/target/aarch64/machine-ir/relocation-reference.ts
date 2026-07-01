import type { AArch64RelocationReferenceId, AArch64SymbolId } from "./ids";

export type AArch64RelocationKind =
  | "CALL26"
  | "PAGE"
  | "PAGEOFF12"
  | "ADR_PREL_PG_HI21"
  | "ADD_ABS_LO12_NC"
  | "LDST64_ABS_LO12_NC"
  | "JUMP26"
  | "BRANCH19";

export interface AArch64RelocationReference {
  readonly relocationId: AArch64RelocationReferenceId;
  readonly kind: AArch64RelocationKind;
  readonly symbol: AArch64SymbolId;
  readonly addend: bigint;
  readonly targetFingerprint: string;
}

export function aarch64RelocationReference(
  input: AArch64RelocationReference,
): AArch64RelocationReference {
  if (input.targetFingerprint.length === 0) {
    throw new RangeError("relocation target fingerprint must be non-empty.");
  }
  return Object.freeze({ ...input });
}

import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirLoweringContext } from "./lowering-context";

export function activeBlockKey(
  context: ProofMirLoweringContext,
  fallbackBlockKey: ProofMirCanonicalKey,
): ProofMirCanonicalKey {
  return context.blockTracking?.currentBlockRef.blockKey ?? fallbackBlockKey;
}

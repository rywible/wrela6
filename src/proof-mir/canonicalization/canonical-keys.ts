export type ProofMirCanonicalKey = string & { readonly __brand: "ProofMirCanonicalKey" };

export function proofMirCanonicalKey(value: string): ProofMirCanonicalKey {
  return value as ProofMirCanonicalKey;
}

export type ProofCheckTransitionId = number & { readonly __brand: "ProofCheckTransitionId" };
export type ProofCheckCoreCertificateId = number & {
  readonly __brand: "ProofCheckCoreCertificateId";
};
export type ProofPacketFactId = number & { readonly __brand: "ProofPacketFactId" };
export type ProofPathCertificateId = number & { readonly __brand: "ProofPathCertificateId" };
export type ProofSemanticsCertificateId = number & {
  readonly __brand: "ProofSemanticsCertificateId";
};
export type CheckedSummaryInstantiationCertificateId = number & {
  readonly __brand: "CheckedSummaryInstantiationCertificateId";
};

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function proofCheckTransitionId(value: number): ProofCheckTransitionId {
  return denseId(value, "ProofCheckTransitionId") as ProofCheckTransitionId;
}

export function proofCheckCoreCertificateId(value: number): ProofCheckCoreCertificateId {
  return denseId(value, "ProofCheckCoreCertificateId") as ProofCheckCoreCertificateId;
}

export function proofCheckPacketFactId(value: number): ProofPacketFactId {
  return denseId(value, "ProofPacketFactId") as ProofPacketFactId;
}

export function proofCheckPathCertificateId(value: number): ProofPathCertificateId {
  return denseId(value, "ProofPathCertificateId") as ProofPathCertificateId;
}

export function proofSemanticsCertificateId(value: number): ProofSemanticsCertificateId {
  return denseId(value, "ProofSemanticsCertificateId") as ProofSemanticsCertificateId;
}

export function checkedSummaryInstantiationCertificateId(
  value: number,
): CheckedSummaryInstantiationCertificateId {
  return denseId(
    value,
    "CheckedSummaryInstantiationCertificateId",
  ) as CheckedSummaryInstantiationCertificateId;
}

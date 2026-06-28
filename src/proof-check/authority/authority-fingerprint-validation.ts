import type { ProofAuthorityFingerprint } from "./authority-types";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";

const ALLOWED_PROOF_AUTHORITY_KINDS: ReadonlySet<ProofAuthorityFingerprint["authorityKind"]> =
  new Set(["platform", "runtime", "typeFacts", "layout", "semantics"]);

const SHA256_DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/;

function invalidProofAuthorityFingerprintDiagnostic(stableDetail: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT",
    messageTemplateId: "proof-check.authority.invalid-fingerprint",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: "Proof authority fingerprint is malformed.",
    ownerKey: "proof-check:authority-fingerprint",
    rootCauseKey: "proof-check:authority-fingerprint",
    stableDetail,
  });
}

export function validateProofAuthorityFingerprint(
  fingerprint: ProofAuthorityFingerprint,
): ProofCheckDiagnostic | undefined {
  if (fingerprint.version.length === 0) {
    return invalidProofAuthorityFingerprintDiagnostic("empty-version");
  }

  if (!ALLOWED_PROOF_AUTHORITY_KINDS.has(fingerprint.authorityKind)) {
    return invalidProofAuthorityFingerprintDiagnostic(
      `invalid-authority-kind:${String(fingerprint.authorityKind)}`,
    );
  }

  if (fingerprint.digestAlgorithm !== "sha256") {
    return invalidProofAuthorityFingerprintDiagnostic(
      `invalid-digest-algorithm:${String(fingerprint.digestAlgorithm)}`,
    );
  }

  if (!SHA256_DIGEST_HEX_PATTERN.test(fingerprint.digestHex)) {
    return invalidProofAuthorityFingerprintDiagnostic("invalid-digest-hex");
  }

  return undefined;
}

import { proofAuthorityFingerprintsEqual } from "../authority/authority-types";
import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import type {
  CheckedSummaryInstantiationCertificateId,
  ProofCheckCoreCertificateId,
  ProofSemanticsCertificateId,
} from "../ids";
import type {
  ProofCheckCoreCertificate,
  ProofCheckCoreCertificateRule,
} from "../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedPacketFactKind,
} from "../model/fact-packet";
import { isKnownCheckedPacketFactKind } from "../model/fact-packet";
import { originEntryCertificateSubjectKey } from "./origin-packet-entry";
import type {
  CheckedSummaryInstantiationCertificateRecord,
  ProofCheckCertificate,
  ProofSemanticsCertificateRecord,
} from "./packet-certificate-types";
import { checkedFactSubjectKey } from "./packet-fact-keys";

export const ALLOWED_SUBJECT_KINDS_BY_FACT_KIND: Readonly<
  Record<CheckedPacketFactKind, readonly CheckedFactSubject["kind"][]>
> = {
  ownership: ["place"],
  noalias: ["place"],
  fieldDisjointness: ["place"],
  erasure: ["place", "value"],
  validatedBuffer: ["layout", "place"],
  packetSource: ["packetSource"],
  privateState: ["privateState"],
  platformEffect: ["place", "authority"],
  capabilityFlow: ["place", "authority"],
  terminalClosure: ["terminal"],
  exitClosure: ["place", "function"],
  layoutAbi: ["layout"],
  extension: ["factExtension"],
  origin: [
    "mirOrigin",
    "place",
    "value",
    "function",
    "block",
    "edge",
    "call",
    "layout",
    "authority",
    "packetSource",
    "privateState",
    "terminal",
  ],
};

export const CORE_CERTIFICATE_RULES_BY_FACT_KIND: Readonly<
  Record<CheckedPacketFactKind, readonly ProofCheckCoreCertificateRule[]>
> = {
  ownership: ["ownershipTransfer"],
  noalias: ["loanDisjointness"],
  fieldDisjointness: ["loanDisjointness"],
  erasure: ["erasure"],
  validatedBuffer: ["layoutReadRequirement"],
  packetSource: ["packetSource"],
  privateState: ["initialState", "ownershipTransfer"],
  platformEffect: ["coreEntailment", "authorityMembership"],
  capabilityFlow: ["coreEntailment", "authorityMembership"],
  terminalClosure: ["exitClosure"],
  exitClosure: ["exitClosure"],
  layoutAbi: ["layoutReadRequirement", "initialState"],
  extension: ["coreEntailment", "authorityMembership"],
  origin: ["initialState", "coreEntailment"],
};

export function isCoreCertificate(
  certificate: ProofCheckCertificate,
): certificate is ProofCheckCoreCertificate {
  return "rule" in certificate;
}

export function isSemanticsCertificate(
  certificate: ProofCheckCertificate,
): certificate is ProofSemanticsCertificateRecord {
  return "kind" in certificate && certificate.kind === "semantics";
}

export function isSummaryInstantiationCertificate(
  certificate: ProofCheckCertificate,
): certificate is CheckedSummaryInstantiationCertificateRecord {
  return "kind" in certificate && certificate.kind === "summaryInstantiation";
}

export function buildCertificateIndex(certificates: readonly ProofCheckCertificate[]): {
  readonly core: ReadonlyMap<string, ProofCheckCoreCertificate>;
  readonly semantics: ReadonlyMap<string, ProofSemanticsCertificateRecord>;
  readonly summaryInstantiation: ReadonlyMap<string, CheckedSummaryInstantiationCertificateRecord>;
} {
  const core = new Map<string, ProofCheckCoreCertificate>();
  const semantics = new Map<string, ProofSemanticsCertificateRecord>();
  const summaryInstantiation = new Map<string, CheckedSummaryInstantiationCertificateRecord>();
  for (const certificate of certificates) {
    if (isCoreCertificate(certificate)) {
      const certificateKey = String(certificate.certificateId);
      const existing = core.get(certificateKey);
      if (existing !== undefined && existing.subjectKey !== certificate.subjectKey) {
        throw new RangeError(
          `Duplicate proof-check core certificate id ${certificateKey} for subjects ${existing.subjectKey} and ${certificate.subjectKey}.`,
        );
      }
      core.set(certificateKey, certificate);
      continue;
    }
    if (isSemanticsCertificate(certificate)) {
      semantics.set(String(certificate.certificateId), certificate);
      continue;
    }
    if (isSummaryInstantiationCertificate(certificate)) {
      summaryInstantiation.set(String(certificate.certificateId), certificate);
    }
  }
  return { core, semantics, summaryInstantiation };
}

export function coreCertificateById(
  index: ReadonlyMap<string, ProofCheckCoreCertificate>,
  certificateId: ProofCheckCoreCertificateId,
): ProofCheckCoreCertificate | undefined {
  return index.get(String(certificateId));
}

export function semanticsCertificateById(
  index: ReadonlyMap<string, ProofSemanticsCertificateRecord>,
  certificateId: ProofSemanticsCertificateId,
): ProofSemanticsCertificateRecord | undefined {
  return index.get(String(certificateId));
}

export function summaryInstantiationCertificateById(
  index: ReadonlyMap<string, CheckedSummaryInstantiationCertificateRecord>,
  certificateId: CheckedSummaryInstantiationCertificateId,
): CheckedSummaryInstantiationCertificateRecord | undefined {
  return index.get(String(certificateId));
}

export function findEntryCertificate(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  index: ReturnType<typeof buildCertificateIndex>,
): ProofCheckCertificate | undefined {
  switch (entry.certificate.kind) {
    case "core":
      return coreCertificateById(index.core, entry.certificate.id);
    case "semantics":
      return semanticsCertificateById(index.semantics, entry.certificate.id);
    case "summaryInstantiation":
      return summaryInstantiationCertificateById(index.summaryInstantiation, entry.certificate.id);
    default: {
      const unreachable: never = entry.certificate;
      return unreachable;
    }
  }
}

export function authorityFingerprintIsKnown(
  fingerprint: ProofAuthorityFingerprint,
  authorityFingerprints: readonly ProofAuthorityFingerprint[],
): boolean {
  return authorityFingerprints.some((knownFingerprint) =>
    proofAuthorityFingerprintsEqual(knownFingerprint, fingerprint),
  );
}

export function certificateProvesSubject(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  certificate: ProofCheckCertificate,
): boolean {
  const factKindString = String(entry.kind);
  if (!isKnownCheckedPacketFactKind(factKindString)) {
    return false;
  }
  const factKind: CheckedPacketFactKind = factKindString;
  const subjectKey = checkedFactSubjectKey(entry.subject);

  if (isCoreCertificate(certificate)) {
    if (!CORE_CERTIFICATE_RULES_BY_FACT_KIND[factKind].includes(certificate.rule)) {
      return false;
    }
    if (factKind === "origin" && entry.subject.kind === "mirOrigin") {
      return certificate.subjectKey === originEntryCertificateSubjectKey(entry.origin.originKey);
    }
    if (certificate.subjectKey === subjectKey) {
      return true;
    }
    if (
      factKind === "validatedBuffer" &&
      certificate.rule === "layoutReadRequirement" &&
      entry.subject.kind === "place"
    ) {
      return true;
    }
    return false;
  }

  if (isSemanticsCertificate(certificate)) {
    return certificate.subjectKey === subjectKey;
  }

  if (isSummaryInstantiationCertificate(certificate)) {
    return certificate.subjectKey === subjectKey;
  }

  return false;
}

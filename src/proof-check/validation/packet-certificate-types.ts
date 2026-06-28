import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import type { CheckedSummaryInstantiationCertificateId, ProofSemanticsCertificateId } from "../ids";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import type { CheckedFactPacket } from "../model/fact-packet";

export type ProofCheckCertificate =
  | ProofCheckCoreCertificate
  | ProofSemanticsCertificateRecord
  | CheckedSummaryInstantiationCertificateRecord;

export interface ProofSemanticsCertificateRecord {
  readonly kind: "semantics";
  readonly certificateId: ProofSemanticsCertificateId;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}

export interface CheckedSummaryInstantiationCertificateRecord {
  readonly kind: "summaryInstantiation";
  readonly certificateId: CheckedSummaryInstantiationCertificateId;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}

export interface ValidateCheckedFactPacketInput {
  readonly packet: CheckedFactPacket;
  readonly certificates: readonly ProofCheckCertificate[];
  readonly authorityFingerprints?: readonly ProofAuthorityFingerprint[];
  readonly proofMirNodeKeys?: ReadonlySet<string>;
  readonly layoutFactKeys?: ReadonlySet<string>;
  readonly packetSourceKeys?: ReadonlySet<string>;
  readonly privateGenerationKeys?: ReadonlySet<string>;
}

import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  type ProofCheckCoreCertificateId,
  type ProofPacketFactId,
} from "../ids";

export interface ProofCheckCertificateRegistry {
  allocateCoreCertificateId(subjectKey: string): ProofCheckCoreCertificateId;
  allocatePacketFactId(subjectKey: string): ProofPacketFactId;
}

export function createProofCheckCertificateRegistry(): ProofCheckCertificateRegistry {
  let nextCoreCertificateId = 1;
  let nextPacketFactId = 1;
  const coreCertificateIds = new Map<string, ProofCheckCoreCertificateId>();
  const packetFactIds = new Map<string, ProofPacketFactId>();

  return {
    allocateCoreCertificateId(subjectKey: string): ProofCheckCoreCertificateId {
      const existing = coreCertificateIds.get(subjectKey);
      if (existing !== undefined) {
        return existing;
      }
      const certificateId = proofCheckCoreCertificateId(nextCoreCertificateId);
      nextCoreCertificateId += 1;
      coreCertificateIds.set(subjectKey, certificateId);
      return certificateId;
    },
    allocatePacketFactId(subjectKey: string): ProofPacketFactId {
      const existing = packetFactIds.get(subjectKey);
      if (existing !== undefined) {
        return existing;
      }
      const factId = proofCheckPacketFactId(nextPacketFactId);
      nextPacketFactId += 1;
      packetFactIds.set(subjectKey, factId);
      return factId;
    },
  };
}

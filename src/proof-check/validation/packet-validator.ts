import { sortProofCheckDiagnostics, type ProofCheckDiagnostic } from "../diagnostics";
import { buildCertificateIndex } from "./packet-certificate-index";
import type {
  CheckedSummaryInstantiationCertificateRecord,
  ProofCheckCertificate,
  ProofSemanticsCertificateRecord,
  ValidateCheckedFactPacketInput,
} from "./packet-certificate-types";
import {
  CHECKED_FACT_PACKET_DEPENDENCY_KINDS,
  CHECKED_FACT_PACKET_INVALIDATION_KINDS,
  type CheckedFactPacketDependency,
  type CheckedFactPacketDependencyKind,
  type CheckedFactPacketInvalidation,
  type CheckedFactPacketInvalidationKind,
} from "./packet-envelope-types";
import {
  sortCheckedFactPacketEntries,
  sortCheckedFactPacketEntriesForPacket,
  validateCheckedFactPacketEnvelope,
} from "./packet-envelope-validation";
import {
  packetEntryArrays,
  validatePacketEntryCertificate,
  validatePacketEntryDependencies,
  validatePacketEntrySubjectKind,
  validatePacketOrigins,
} from "./packet-entry-validation";
import {
  checkedFactCertificateKey,
  checkedFactOriginKey,
  checkedFactPacketDependencyKey,
  checkedFactPacketInvalidationKey,
  checkedFactScopeKey,
  checkedFactSubjectKey,
} from "./packet-fact-keys";

export {
  CHECKED_FACT_PACKET_DEPENDENCY_KINDS,
  CHECKED_FACT_PACKET_INVALIDATION_KINDS,
  type CheckedFactPacketDependency,
  type CheckedFactPacketDependencyKind,
  type CheckedFactPacketInvalidation,
  type CheckedFactPacketInvalidationKind,
};

export {
  checkedFactCertificateKey,
  checkedFactOriginKey,
  checkedFactPacketDependencyKey,
  checkedFactPacketInvalidationKey,
  checkedFactScopeKey,
  checkedFactSubjectKey,
};

export {
  sortCheckedFactPacketEntries,
  sortCheckedFactPacketEntriesForPacket,
  validateCheckedFactPacketEnvelope,
};

export type {
  CheckedSummaryInstantiationCertificateRecord,
  ProofCheckCertificate,
  ProofSemanticsCertificateRecord,
  ValidateCheckedFactPacketInput,
};

export function validateCheckedFactPacket(
  input: ValidateCheckedFactPacketInput,
): ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const certificateIndex = buildCertificateIndex(input.certificates);

  diagnostics.push(...validatePacketOrigins(input.packet));

  for (const entry of packetEntryArrays(input.packet)) {
    diagnostics.push(...validateCheckedFactPacketEnvelope(entry));

    const subjectDiagnostic = validatePacketEntrySubjectKind(entry);
    if (subjectDiagnostic !== undefined) {
      diagnostics.push(subjectDiagnostic);
    }

    diagnostics.push(...validatePacketEntryDependencies(entry, input, certificateIndex));
    diagnostics.push(...validatePacketEntryCertificate(entry, certificateIndex));
  }

  return sortProofCheckDiagnostics(diagnostics);
}

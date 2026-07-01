import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import {
  checkedFactKindId,
  isKnownCheckedPacketFactKind,
  type CheckedFactKindId,
  type CheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactSubject,
  type CheckedPacketFactKind,
} from "../model/fact-packet";
import {
  ALLOWED_SUBJECT_KINDS_BY_FACT_KIND,
  authorityFingerprintIsKnown,
  buildCertificateIndex,
  certificateProvesSubject,
  coreCertificateById,
  findEntryCertificate,
  semanticsCertificateById,
  summaryInstantiationCertificateById,
} from "./packet-certificate-index";
import type { ValidateCheckedFactPacketInput } from "./packet-certificate-types";
import { checkedFactSubjectKey } from "./packet-fact-keys";

export function packetDiagnostic(stableDetail: string, message: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_FACT_PACKET",
    messageTemplateId: "packet.invalid",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message,
    ownerKey: "packet:validator",
    rootCauseKey: "packet:validator",
    stableDetail,
  });
}

export function validatePacketEntrySubjectKind(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
): ProofCheckDiagnostic | undefined {
  const factKindString = String(entry.kind);
  if (!isKnownCheckedPacketFactKind(factKindString)) {
    return packetDiagnostic(
      `unknown-fact-kind:${factKindString}`,
      `Checked fact packet entry uses unknown fact kind ${factKindString}.`,
    );
  }
  const factKind: CheckedPacketFactKind = factKindString;
  const allowedSubjectKinds = ALLOWED_SUBJECT_KINDS_BY_FACT_KIND[factKind];
  if (!allowedSubjectKinds.includes(entry.subject.kind)) {
    return packetDiagnostic(
      `invalid-subject-kind:${String(entry.kind)}:${entry.subject.kind}`,
      `Fact kind ${String(entry.kind)} cannot use subject kind ${entry.subject.kind}.`,
    );
  }
  return undefined;
}

export function validatePacketEntryDependencies(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  input: ValidateCheckedFactPacketInput,
  certificateIndex: ReturnType<typeof buildCertificateIndex>,
): ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const authorityFingerprints = input.authorityFingerprints ?? [];
  const proofMirNodeKeys = input.proofMirNodeKeys;
  const layoutFactKeys = input.layoutFactKeys;
  const packetSourceKeys = input.packetSourceKeys;
  const privateGenerationKeys = input.privateGenerationKeys;

  for (const dependency of entry.dependencies) {
    switch (dependency.kind) {
      case "coreCertificate": {
        const certificate = coreCertificateById(certificateIndex.core, dependency.certificateId);
        if (certificate === undefined) {
          diagnostics.push(
            packetDiagnostic(
              `missing-core-certificate:${String(dependency.certificateId)}`,
              `Checked fact packet entry depends on missing core certificate ${String(dependency.certificateId)}.`,
            ),
          );
        }
        break;
      }
      case "semanticsCertificate": {
        const certificate = semanticsCertificateById(
          certificateIndex.semantics,
          dependency.certificateId,
        );
        if (certificate === undefined) {
          diagnostics.push(
            packetDiagnostic(
              `missing-semantics-certificate:${String(dependency.certificateId)}`,
              `Checked fact packet entry depends on missing semantics certificate ${String(dependency.certificateId)}.`,
            ),
          );
        }
        break;
      }
      case "summaryInstantiation": {
        const certificate = summaryInstantiationCertificateById(
          certificateIndex.summaryInstantiation,
          dependency.certificateId,
        );
        if (certificate === undefined) {
          diagnostics.push(
            packetDiagnostic(
              `missing-summary-instantiation-certificate:${String(dependency.certificateId)}`,
              `Checked fact packet entry depends on missing summary-instantiation certificate ${String(dependency.certificateId)}.`,
            ),
          );
        }
        break;
      }
      case "authorityEntry": {
        if (
          authorityFingerprints.length > 0 &&
          !authorityFingerprintIsKnown(dependency.fingerprint, authorityFingerprints)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `stale-authority-fingerprint:${dependency.fingerprint.digestHex}`,
              `Checked fact packet entry depends on stale authority fingerprint ${dependency.fingerprint.digestHex}.`,
            ),
          );
        }
        break;
      }
      case "proofMirFact":
        if (
          proofMirNodeKeys !== undefined &&
          !proofMirNodeKeys.has(`proofMirFact:${String(dependency.factId)}`)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-proof-mir-node:proofMirFact:${String(dependency.factId)}`,
              `Checked fact packet entry depends on missing Proof MIR fact ${String(dependency.factId)}.`,
            ),
          );
        }
        break;
      case "proofMirPlace":
        if (
          proofMirNodeKeys !== undefined &&
          !proofMirNodeKeys.has(`proofMirPlace:${String(dependency.placeId)}`)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-proof-mir-node:proofMirPlace:${String(dependency.placeId)}`,
              `Checked fact packet entry depends on missing Proof MIR place ${String(dependency.placeId)}.`,
            ),
          );
        }
        break;
      case "proofMirValue":
        if (
          proofMirNodeKeys !== undefined &&
          !proofMirNodeKeys.has(`proofMirValue:${String(dependency.valueId)}`)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-proof-mir-node:proofMirValue:${String(dependency.valueId)}`,
              `Checked fact packet entry depends on missing Proof MIR value ${String(dependency.valueId)}.`,
            ),
          );
        }
        break;
      case "proofMirEdge":
        if (
          proofMirNodeKeys !== undefined &&
          !proofMirNodeKeys.has(`proofMirEdge:${String(dependency.edgeId)}`)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-proof-mir-node:proofMirEdge:${String(dependency.edgeId)}`,
              `Checked fact packet entry depends on missing Proof MIR edge ${String(dependency.edgeId)}.`,
            ),
          );
        }
        break;
      case "proofMirCall":
        if (
          proofMirNodeKeys !== undefined &&
          !proofMirNodeKeys.has(`proofMirCall:${String(dependency.callId)}`)
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-proof-mir-node:proofMirCall:${String(dependency.callId)}`,
              `Checked fact packet entry depends on missing Proof MIR call ${String(dependency.callId)}.`,
            ),
          );
        }
        break;
      case "layoutFact":
        if (layoutFactKeys !== undefined && !layoutFactKeys.has(String(dependency.layoutKey))) {
          diagnostics.push(
            packetDiagnostic(
              `missing-layout-fact:${String(dependency.layoutKey)}`,
              `Checked fact packet entry depends on missing layout fact ${String(dependency.layoutKey)}.`,
            ),
          );
        }
        break;
      case "packetSource": {
        const packetSourceKey = `${String(dependency.packet)}:${String(dependency.source)}`;
        if (packetSourceKeys !== undefined && !packetSourceKeys.has(packetSourceKey)) {
          diagnostics.push(
            packetDiagnostic(
              `missing-packet-source:${packetSourceKey}`,
              `Checked fact packet entry depends on missing packet source ${packetSourceKey}.`,
            ),
          );
        }
        break;
      }
      case "privateGeneration":
        if (
          privateGenerationKeys !== undefined &&
          !privateGenerationKeys.has(String(dependency.generation))
        ) {
          diagnostics.push(
            packetDiagnostic(
              `missing-private-generation:${String(dependency.generation)}`,
              `Checked fact packet entry depends on missing private generation ${String(dependency.generation)}.`,
            ),
          );
        }
        break;
      default: {
        const unreachable: never = dependency;
        return unreachable;
      }
    }
  }

  if (
    entry.subject.kind === "authority" &&
    authorityFingerprints.length > 0 &&
    !authorityFingerprintIsKnown(entry.subject.fingerprint, authorityFingerprints)
  ) {
    diagnostics.push(
      packetDiagnostic(
        `stale-authority-subject:${entry.subject.fingerprint.digestHex}`,
        `Checked fact packet entry has stale authority subject fingerprint ${entry.subject.fingerprint.digestHex}.`,
      ),
    );
  }

  return diagnostics;
}

export function validatePacketEntryCertificate(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  certificateIndex: ReturnType<typeof buildCertificateIndex>,
): ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const certificate = findEntryCertificate(entry, certificateIndex);
  if (certificate === undefined) {
    diagnostics.push(
      packetDiagnostic(
        `missing-entry-certificate:${entry.certificate.kind}:${String(entry.certificate.id)}`,
        `Checked fact packet entry references missing ${entry.certificate.kind} certificate ${String(entry.certificate.id)}.`,
      ),
    );
    return diagnostics;
  }

  if (!certificateProvesSubject(entry, certificate)) {
    diagnostics.push(
      packetDiagnostic(
        `certificate-subject-mismatch:${String(entry.kind)}:${checkedFactSubjectKey(entry.subject)}`,
        `Certificate does not prove subject for fact kind ${String(entry.kind)}.`,
      ),
    );
  }

  return diagnostics;
}

export function packetEntryArrays(
  packet: CheckedFactPacket,
): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  return [
    ...packet.ownership,
    ...packet.noalias,
    ...packet.fieldDisjointness,
    ...packet.erasures,
    ...packet.validatedBuffers,
    ...packet.packetSources,
    ...packet.privateState,
    ...packet.platformEffects,
    ...packet.capabilityFlow,
    ...packet.terminalClosure,
    ...packet.exitClosure,
    ...packet.layoutAbi,
    ...packet.origins,
    ...packet.extensions,
  ];
}

export function validatePacketOrigins(packet: CheckedFactPacket): ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const originKeysFromEntries = new Set<string>();

  for (const entry of packet.origins) {
    if (entry.origin.originKey.length === 0) {
      diagnostics.push(
        packetDiagnostic(
          "invalid-packet-origin-key",
          "Checked fact packet origins must use non-empty origin keys.",
        ),
      );
    }
    if (entry.kind !== checkedFactKindId("origin")) {
      diagnostics.push(
        packetDiagnostic(
          `invalid-origin-packet-entry-kind:${String(entry.kind)}`,
          `Checked fact packet origin entries must use kind origin.`,
        ),
      );
    }
  }

  for (const entry of packetEntryArrays(packet)) {
    if (entry.origin.originKey.length === 0) {
      continue;
    }
    originKeysFromEntries.add(entry.origin.originKey);
  }

  const packetOriginKeys = new Set(packet.origins.map((entry) => entry.origin.originKey));
  for (const originKey of originKeysFromEntries) {
    if (!packetOriginKeys.has(originKey)) {
      diagnostics.push(
        packetDiagnostic(
          `missing-packet-origin:${originKey}`,
          `Checked fact packet is missing origin entry for ${originKey}.`,
        ),
      );
    }
  }

  const sortedOriginKeys = packet.origins.map((entry) => entry.origin.originKey);
  const expectedSorted = [...sortedOriginKeys].sort(compareCodeUnitStrings);
  if (sortedOriginKeys.some((originKey, index) => originKey !== expectedSorted[index])) {
    diagnostics.push(
      packetDiagnostic(
        "unsorted-packet-origins",
        "Checked fact packet origins must be sorted by origin key.",
      ),
    );
  }

  return diagnostics;
}

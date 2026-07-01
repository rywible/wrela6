import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckCertificateId } from "../model/certificates";
import {
  CHECKED_PACKET_FACT_KINDS,
  checkedFactKindId,
  type CheckedFactDependency,
  type CheckedFactInvalidation,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedPacketFactKind,
} from "../model/fact-packet";
import type {
  CheckedFactPacketDependency,
  CheckedFactPacketInvalidation,
} from "./packet-envelope-types";
import {
  checkedFactCertificateKey,
  checkedFactOriginKey,
  checkedFactPacketDependencyKey,
  checkedFactPacketInvalidationKey,
  checkedFactScopeKey,
  checkedFactSubjectKey,
} from "./packet-fact-keys";

const CHECKED_PACKET_FACT_KIND_SET: ReadonlySet<string> = new Set(CHECKED_PACKET_FACT_KINDS);

const ALLOWED_CERTIFICATE_KINDS_BY_FACT_KIND: Readonly<
  Record<CheckedPacketFactKind, readonly ProofCheckCertificateId["kind"][]>
> = {
  ownership: ["core"],
  noalias: ["core"],
  fieldDisjointness: ["core"],
  erasure: ["core"],
  validatedBuffer: ["core"],
  packetSource: ["core"],
  privateState: ["core"],
  platformEffect: ["core", "semantics"],
  capabilityFlow: ["core", "semantics"],
  terminalClosure: ["semantics"],
  exitClosure: ["core"],
  layoutAbi: ["core"],
  extension: ["core", "semantics"],
  origin: ["core", "summaryInstantiation"],
};

export function packetEnvelopeDiagnostic(
  stableDetail: string,
  message: string,
): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_FACT_PACKET",
    messageTemplateId: "packet.envelope.invalid",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message,
    ownerKey: "packet:envelope",
    rootCauseKey: "packet:envelope",
    stableDetail,
  });
}

function normalizeDependencyToEnvelope(
  dependency: CheckedFactDependency,
): CheckedFactPacketDependency | undefined {
  switch (dependency.kind) {
    case "proofMirFact":
      return { kind: "proofMirNode", nodeKey: `proofMirFact:${String(dependency.factId)}` };
    case "proofMirPlace":
      return { kind: "proofMirNode", nodeKey: `proofMirPlace:${String(dependency.placeId)}` };
    case "proofMirValue":
      return { kind: "proofMirNode", nodeKey: `proofMirValue:${String(dependency.valueId)}` };
    case "proofMirEdge":
      return { kind: "proofMirNode", nodeKey: `proofMirEdge:${String(dependency.edgeId)}` };
    case "proofMirCall":
      return { kind: "proofMirNode", nodeKey: `proofMirCall:${String(dependency.callId)}` };
    case "layoutFact":
      return { kind: "layoutFact", layoutKey: String(dependency.layoutKey) };
    case "authorityEntry":
      return {
        kind: "authorityFingerprint",
        fingerprint: dependency.fingerprint,
      };
    case "coreCertificate":
      return { kind: "coreCertificate", certificateId: dependency.certificateId };
    case "semanticsCertificate":
      return { kind: "semanticsCertificate", certificateId: dependency.certificateId };
    case "summaryInstantiation":
      return {
        kind: "summaryInstantiationCertificate",
        certificateId: dependency.certificateId,
      };
    case "packetSource":
      return {
        kind: "packetSource",
        packetSourceKey: `${String(dependency.packet)}:${String(dependency.source)}`,
      };
    case "privateGeneration":
      return {
        kind: "privateGeneration",
        generationKey: String(dependency.generation),
      };
    default:
      return undefined;
  }
}

function normalizeInvalidationToEnvelope(
  invalidation: CheckedFactInvalidation,
): CheckedFactPacketInvalidation | undefined {
  switch (invalidation.kind) {
    case "placeMutation":
    case "placeMove":
    case "placeConsume":
    case "loanConflict":
    case "privateStateAdvance":
      return {
        kind: invalidation.kind,
        placeIdKey: String(invalidation.placeId),
      };
    case "platformEffect":
      return {
        kind: "platformEffect",
        effectKindKey: String(invalidation.effectKind),
        subjectKey: checkedFactSubjectKey(invalidation.subject),
      };
    case "runtimeEffect":
      return {
        kind: "runtimeEffect",
        effectKindKey: String(invalidation.effectKind),
        subjectKey: checkedFactSubjectKey(invalidation.subject),
      };
    case "packetSourceSplit":
      return {
        kind: "packetSourceSplit",
        packetSourceKey: `${String(invalidation.packet)}:${String(invalidation.source)}`,
      };
    case "callResultRewrite":
      return { kind: "callResultRewrite", callIdKey: String(invalidation.callId) };
    case "cfgRewrite":
      return {
        kind: "cfgRewrite",
        functionInstanceIdKey: String(invalidation.functionInstanceId),
      };
    case "abiRewrite":
      return { kind: "abiRewrite", layoutKey: String(invalidation.layoutKey) };
    case "authorityChange":
      return {
        kind: "authorityChange",
        fingerprintKey: invalidation.fingerprint.digestHex,
      };
    default:
      return undefined;
  }
}

function isEmptySubject(subject: CheckedFactSubject): boolean {
  if (subject.kind === "authority" && subject.entryKey.length === 0) {
    return true;
  }
  if (subject.kind === "function" && String(subject.functionInstanceId).length === 0) {
    return true;
  }
  return checkedFactSubjectKey(subject).length === 0;
}

function isEmptyScope(scope: CheckedFactScope): boolean {
  switch (scope.kind) {
    case "wholeImage":
      return false;
    case "function":
      return String(scope.functionInstanceId).length === 0;
    case "blockEntry":
      return String(scope.functionInstanceId).length === 0;
    case "edge":
      return String(scope.functionInstanceId).length === 0;
    case "afterStatement":
      return String(scope.functionInstanceId).length === 0;
    case "callResult":
      return String(scope.functionInstanceId).length === 0;
    case "path":
      return false;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

function isMissingCertificate(certificate: ProofCheckCertificateId | undefined): boolean {
  if (certificate === undefined) {
    return true;
  }
  return checkedFactCertificateKey(certificate).length === 0;
}

function validateFactKind(kind: CheckedFactKindId): ProofCheckDiagnostic | undefined {
  if (!CHECKED_PACKET_FACT_KIND_SET.has(String(kind))) {
    return packetEnvelopeDiagnostic(
      `unknown-fact-kind:${String(kind)}`,
      `Checked fact packet entry has unknown fact kind ${String(kind)}.`,
    );
  }
  try {
    checkedFactKindId(String(kind));
  } catch {
    return packetEnvelopeDiagnostic(
      `unknown-fact-kind:${String(kind)}`,
      `Checked fact packet entry has unknown fact kind ${String(kind)}.`,
    );
  }
  return undefined;
}

function certificateCanProveFactKind(
  factKind: CheckedPacketFactKind,
  certificate: ProofCheckCertificateId,
): boolean {
  const allowedKinds = ALLOWED_CERTIFICATE_KINDS_BY_FACT_KIND[factKind];
  return allowedKinds.includes(certificate.kind);
}

export function validateCheckedFactPacketEnvelope<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
>(entry: CheckedFactPacketEntry<Kind, Subject>): ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];

  const kindDiagnostic = validateFactKind(entry.kind);
  if (kindDiagnostic !== undefined) {
    diagnostics.push(kindDiagnostic);
  }

  if (isEmptySubject(entry.subject)) {
    diagnostics.push(
      packetEnvelopeDiagnostic(
        "empty-subject-key",
        "Checked fact packet entry has an empty subject key.",
      ),
    );
  }

  if (isEmptyScope(entry.scope)) {
    diagnostics.push(
      packetEnvelopeDiagnostic(
        "empty-validity-scope",
        "Checked fact packet entry has an empty validity scope.",
      ),
    );
  }

  if (isMissingCertificate(entry.certificate)) {
    diagnostics.push(
      packetEnvelopeDiagnostic(
        "missing-certificate",
        "Checked fact packet entry is missing a certificate reference.",
      ),
    );
  } else if (
    CHECKED_PACKET_FACT_KIND_SET.has(String(entry.kind)) &&
    !certificateCanProveFactKind(String(entry.kind) as CheckedPacketFactKind, entry.certificate)
  ) {
    diagnostics.push(
      packetEnvelopeDiagnostic(
        `certificate-kind-mismatch:${String(entry.kind)}:${entry.certificate.kind}`,
        `Certificate kind ${entry.certificate.kind} cannot prove fact kind ${String(entry.kind)}.`,
      ),
    );
  }

  if (entry.origin.originKey.length === 0) {
    diagnostics.push(
      packetEnvelopeDiagnostic(
        "empty-origin-key",
        "Checked fact packet entry has an empty origin key.",
      ),
    );
  }

  const dependencyKeys = new Set<string>();
  for (const dependency of entry.dependencies) {
    const envelopeDependency = normalizeDependencyToEnvelope(dependency);
    if (envelopeDependency === undefined) {
      diagnostics.push(
        packetEnvelopeDiagnostic(
          `unknown-dependency-kind:${String((dependency as { kind: string }).kind)}`,
          `Checked fact packet entry has unknown dependency kind ${String((dependency as { kind: string }).kind)}.`,
        ),
      );
      continue;
    }

    const dependencyKey = checkedFactPacketDependencyKey(envelopeDependency);
    if (dependencyKeys.has(dependencyKey)) {
      diagnostics.push(
        packetEnvelopeDiagnostic(
          `duplicate-dependency:${dependencyKey}`,
          `Checked fact packet entry has duplicate dependency key ${dependencyKey}.`,
        ),
      );
    }
    dependencyKeys.add(dependencyKey);
  }

  const invalidationKeys = new Set<string>();
  for (const invalidation of entry.invalidatedBy) {
    const envelopeInvalidation = normalizeInvalidationToEnvelope(invalidation);
    if (envelopeInvalidation === undefined) {
      diagnostics.push(
        packetEnvelopeDiagnostic(
          `unknown-invalidation-kind:${String((invalidation as { kind: string }).kind)}`,
          `Checked fact packet entry has unknown invalidation kind ${String((invalidation as { kind: string }).kind)}.`,
        ),
      );
      continue;
    }

    const invalidationKey = checkedFactPacketInvalidationKey(envelopeInvalidation);
    if (invalidationKeys.has(invalidationKey)) {
      diagnostics.push(
        packetEnvelopeDiagnostic(
          `duplicate-invalidation:${invalidationKey}`,
          `Checked fact packet entry has duplicate invalidation key ${invalidationKey}.`,
        ),
      );
    }
    invalidationKeys.add(invalidationKey);
  }

  return diagnostics;
}

export function sortCheckedFactPacketEntries<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
>(
  entries: readonly CheckedFactPacketEntry<Kind, Subject>[],
): CheckedFactPacketEntry<Kind, Subject>[] {
  return [...entries].sort((left, right) => {
    const kindCmp = compareCodeUnitStrings(String(left.kind), String(right.kind));
    if (kindCmp !== 0) return kindCmp;

    const subjectCmp = compareCodeUnitStrings(
      checkedFactSubjectKey(left.subject),
      checkedFactSubjectKey(right.subject),
    );
    if (subjectCmp !== 0) return subjectCmp;

    const scopeCmp = compareCodeUnitStrings(
      checkedFactScopeKey(left.scope),
      checkedFactScopeKey(right.scope),
    );
    if (scopeCmp !== 0) return scopeCmp;

    const certificateCmp = compareCodeUnitStrings(
      checkedFactCertificateKey(left.certificate),
      checkedFactCertificateKey(right.certificate),
    );
    if (certificateCmp !== 0) return certificateCmp;

    return compareCodeUnitStrings(
      checkedFactOriginKey(left.origin),
      checkedFactOriginKey(right.origin),
    );
  });
}

export function sortCheckedFactPacketEntriesForPacket<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
>(
  entries: readonly CheckedFactPacketEntry<Kind, Subject>[],
): CheckedFactPacketEntry<Kind, Subject>[] {
  return [...entries].sort((left, right) => {
    const kindCmp = compareCodeUnitStrings(String(left.kind), String(right.kind));
    if (kindCmp !== 0) return kindCmp;

    const subjectCmp = compareCodeUnitStrings(
      checkedFactSubjectKey(left.subject),
      checkedFactSubjectKey(right.subject),
    );
    if (subjectCmp !== 0) return subjectCmp;

    const scopeCmp = compareCodeUnitStrings(
      checkedFactScopeKey(left.scope),
      checkedFactScopeKey(right.scope),
    );
    if (scopeCmp !== 0) return scopeCmp;

    return compareCodeUnitStrings(
      checkedFactOriginKey(left.origin),
      checkedFactOriginKey(right.origin),
    );
  });
}

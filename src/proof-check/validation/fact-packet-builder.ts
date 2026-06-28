import type { CheckedMirFunction } from "../model/checked-mir";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactSubject,
  type CheckedOriginFact,
  type CheckedPacketFactKind,
  CHECKED_PACKET_FACT_KINDS,
} from "../model/fact-packet";
import {
  checkedFactSubjectKey,
  sortCheckedFactPacketEntriesForPacket,
  type ProofCheckCertificate,
  type ProofSemanticsCertificateRecord,
  type CheckedSummaryInstantiationCertificateRecord,
} from "./packet-validator";
import {
  buildOriginPacketEntry,
  collectUniqueOrigins,
  originEntryCertificateSubjectKey,
} from "./origin-packet-entry";

export interface CheckedFactPacketBuilderInput {
  readonly acceptedFunctions: readonly CheckedMirFunction[];
  readonly stagedEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly explicitOrigins?: readonly CheckedOriginFact[];
  readonly certificates: readonly ProofCheckCertificate[];
}

export type BuildCheckedFactPacketResult =
  | { readonly kind: "ok"; readonly packet: CheckedFactPacket }
  | { readonly kind: "error"; readonly stableDetail: string };

function acceptedFunctionIds(
  acceptedFunctions: readonly CheckedMirFunction[],
): ReadonlySet<string> {
  return new Set(
    acceptedFunctions.map((acceptedFunction) => String(acceptedFunction.functionInstanceId)),
  );
}

function entryBelongsToAcceptedFunction(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  acceptedFunctionIds: ReadonlySet<string>,
): boolean {
  switch (entry.scope.kind) {
    case "wholeImage":
    case "path":
      return true;
    default:
      return acceptedFunctionIds.has(String(entry.scope.functionInstanceId));
  }
}

function isCoreCertificate(
  certificate: ProofCheckCertificate,
): certificate is ProofCheckCoreCertificate {
  return "rule" in certificate;
}

function isSemanticsCertificate(
  certificate: ProofCheckCertificate,
): certificate is ProofSemanticsCertificateRecord {
  return "kind" in certificate && certificate.kind === "semantics";
}

function isSummaryInstantiationCertificate(
  certificate: ProofCheckCertificate,
): certificate is CheckedSummaryInstantiationCertificateRecord {
  return "kind" in certificate && certificate.kind === "summaryInstantiation";
}

function certificateIndex(
  certificates: readonly ProofCheckCertificate[],
): Map<string, ProofCheckCertificate> {
  const index = new Map<string, ProofCheckCertificate>();
  for (const certificate of certificates) {
    if (isCoreCertificate(certificate)) {
      index.set(`core:${String(certificate.certificateId)}`, certificate);
      continue;
    }
    if (isSemanticsCertificate(certificate)) {
      index.set(`semantics:${String(certificate.certificateId)}`, certificate);
      continue;
    }
    if (isSummaryInstantiationCertificate(certificate)) {
      index.set(`summaryInstantiation:${String(certificate.certificateId)}`, certificate);
    }
  }
  return index;
}

function entryCertificateExists(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  certificatesByKey: Map<string, ProofCheckCertificate>,
): boolean {
  switch (entry.certificate.kind) {
    case "core":
      return certificatesByKey.has(`core:${String(entry.certificate.id)}`);
    case "semantics":
      return certificatesByKey.has(`semantics:${String(entry.certificate.id)}`);
    case "summaryInstantiation":
      return certificatesByKey.has(`summaryInstantiation:${String(entry.certificate.id)}`);
    default: {
      const unreachable: never = entry.certificate;
      return unreachable;
    }
  }
}

function isCheckedPacketFactKind(kind: string): kind is CheckedPacketFactKind {
  return (CHECKED_PACKET_FACT_KINDS as readonly string[]).includes(kind);
}

function packetArrayKeyForFactKind(
  factKind: CheckedPacketFactKind,
): keyof Omit<CheckedFactPacket, "origins"> | "origins" {
  switch (factKind) {
    case "ownership":
      return "ownership";
    case "noalias":
      return "noalias";
    case "fieldDisjointness":
      return "fieldDisjointness";
    case "erasure":
      return "erasures";
    case "validatedBuffer":
      return "validatedBuffers";
    case "packetSource":
      return "packetSources";
    case "privateState":
      return "privateState";
    case "platformEffect":
      return "platformEffects";
    case "capabilityFlow":
      return "capabilityFlow";
    case "terminalClosure":
      return "terminalClosure";
    case "exitClosure":
      return "exitClosure";
    case "layoutAbi":
      return "layoutAbi";
    case "origin":
      return "origins";
    default: {
      const unreachable: never = factKind;
      return unreachable;
    }
  }
}

function coreCertificateBySubjectKey(
  certificates: readonly ProofCheckCertificate[],
  subjectKey: string,
): ProofCheckCoreCertificate | undefined {
  for (const certificate of certificates) {
    if (isCoreCertificate(certificate) && certificate.subjectKey === subjectKey) {
      return certificate;
    }
  }
  return undefined;
}

function buildOriginPacketEntries(input: {
  readonly stagedEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly explicitOrigins?: readonly CheckedOriginFact[];
  readonly certificates: readonly ProofCheckCertificate[];
}):
  | {
      readonly kind: "ok";
      readonly entries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const stagedOriginEntries = input.stagedEntries.filter(
    (entry) => entry.kind === checkedFactKindId("origin"),
  );
  const uniqueOrigins = collectUniqueOrigins({
    stagedEntries: input.stagedEntries,
    explicitOrigins: input.explicitOrigins,
  });
  const coveredOriginKeys = new Set(stagedOriginEntries.map((entry) => entry.origin.originKey));
  const originEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [
    ...stagedOriginEntries,
  ];

  for (const [originKey, origin] of uniqueOrigins) {
    if (coveredOriginKeys.has(originKey)) {
      continue;
    }
    const certificateSubjectKey = originEntryCertificateSubjectKey(originKey);
    const certificate = coreCertificateBySubjectKey(input.certificates, certificateSubjectKey);
    if (certificate === undefined) {
      return {
        kind: "error",
        stableDetail: `origin-entry-missing-certificate:${originKey}`,
      };
    }
    originEntries.push(
      buildOriginPacketEntry({
        origin,
        certificate: { kind: "core", id: certificate.certificateId },
      }),
    );
  }

  return {
    kind: "ok",
    entries: [...originEntries].sort((left, right) =>
      compareCodeUnitStrings(left.origin.originKey, right.origin.originKey),
    ),
  };
}

export function buildCheckedFactPacket(
  input: CheckedFactPacketBuilderInput,
): BuildCheckedFactPacketResult {
  const acceptedIds = acceptedFunctionIds(input.acceptedFunctions);
  const certificatesByKey = certificateIndex(input.certificates);
  const partitioned = new Map<
    keyof Omit<CheckedFactPacket, "origins">,
    CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[]
  >();

  for (const entry of input.stagedEntries) {
    if (!entryBelongsToAcceptedFunction(entry, acceptedIds)) {
      return {
        kind: "error",
        stableDetail: `staged-entry-outside-accepted-function:${checkedFactSubjectKey(entry.subject)}`,
      };
    }

    if (!entryCertificateExists(entry, certificatesByKey)) {
      return {
        kind: "error",
        stableDetail: `staged-entry-missing-certificate:${String(entry.kind)}:${checkedFactSubjectKey(entry.subject)}`,
      };
    }

    const factKindString = String(entry.kind);
    if (!isCheckedPacketFactKind(factKindString)) {
      return {
        kind: "error",
        stableDetail: `staged-entry-unknown-fact-kind:${factKindString}:${checkedFactSubjectKey(entry.subject)}`,
      };
    }
    const factKind = factKindString;
    const arrayKey = packetArrayKeyForFactKind(factKind);
    if (arrayKey === "origins") {
      continue;
    }

    const bucket = partitioned.get(arrayKey) ?? [];
    bucket.push(entry);
    partitioned.set(arrayKey, bucket);
  }

  const originEntriesResult = buildOriginPacketEntries({
    stagedEntries: input.stagedEntries,
    explicitOrigins: input.explicitOrigins,
    certificates: input.certificates,
  });
  if (originEntriesResult.kind === "error") {
    return originEntriesResult;
  }

  const assembled: CheckedFactPacket = {
    ownership: sortCheckedFactPacketEntriesForPacket(partitioned.get("ownership") ?? []),
    noalias: sortCheckedFactPacketEntriesForPacket(partitioned.get("noalias") ?? []),
    fieldDisjointness: sortCheckedFactPacketEntriesForPacket(
      partitioned.get("fieldDisjointness") ?? [],
    ),
    erasures: sortCheckedFactPacketEntriesForPacket(partitioned.get("erasures") ?? []),
    validatedBuffers: sortCheckedFactPacketEntriesForPacket(
      partitioned.get("validatedBuffers") ?? [],
    ),
    packetSources: sortCheckedFactPacketEntriesForPacket(partitioned.get("packetSources") ?? []),
    privateState: sortCheckedFactPacketEntriesForPacket(partitioned.get("privateState") ?? []),
    platformEffects: sortCheckedFactPacketEntriesForPacket(
      partitioned.get("platformEffects") ?? [],
    ),
    capabilityFlow: sortCheckedFactPacketEntriesForPacket(partitioned.get("capabilityFlow") ?? []),
    terminalClosure: sortCheckedFactPacketEntriesForPacket(
      partitioned.get("terminalClosure") ?? [],
    ),
    exitClosure: sortCheckedFactPacketEntriesForPacket(partitioned.get("exitClosure") ?? []),
    layoutAbi: sortCheckedFactPacketEntriesForPacket(partitioned.get("layoutAbi") ?? []),
    origins: originEntriesResult.entries,
  };

  return { kind: "ok", packet: assembled };
}

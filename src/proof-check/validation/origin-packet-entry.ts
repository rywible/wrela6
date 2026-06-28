import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import { stableNumericSeed } from "../stable-numeric-seed";

import type { ProofCheckCoreCertificate } from "../model/certificates";

export function originEntryCertificateSubjectKey(originKey: string): string {
  return `origin-entry:${originKey}`;
}

export function buildOriginPacketEntry(input: {
  readonly origin: CheckedOriginFact;
  readonly certificate: ProofCheckCertificateId;
  readonly scope?: CheckedFactScope;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`origin-packet:${input.origin.originKey}`)),
    kind: checkedFactKindId("origin"),
    subject: {
      kind: "mirOrigin",
      proofMirOriginId: input.origin.proofMirOriginId,
    },
    scope: input.scope ?? { kind: "wholeImage" },
    dependencies: [],
    invalidatedBy: [],
    certificate: input.certificate,
    origin: input.origin,
  };
}

export function originCertificateIdForOriginKey(
  originKey: string,
): ReturnType<typeof proofCheckCoreCertificateId> {
  return proofCheckCoreCertificateId(
    stableNumericSeed(originEntryCertificateSubjectKey(originKey)),
  );
}

export function collectUniqueOrigins(input: {
  readonly stagedEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly explicitOrigins?: readonly CheckedOriginFact[];
}): Map<string, CheckedOriginFact> {
  const origins = new Map<string, CheckedOriginFact>();
  for (const entry of input.stagedEntries) {
    if (entry.origin.originKey.length === 0) {
      continue;
    }
    origins.set(entry.origin.originKey, entry.origin);
  }
  for (const origin of input.explicitOrigins ?? []) {
    origins.set(origin.originKey, origin);
  }
  return origins;
}

export function ensureOriginEntryCoreCertificates(input: {
  readonly origins: readonly CheckedOriginFact[];
  readonly coreCertificates: ProofCheckCoreCertificate[];
  readonly allocateCoreCertificateId: (
    subjectKey: string,
  ) => ReturnType<typeof proofCheckCoreCertificateId>;
}): void {
  for (const origin of input.origins) {
    const subjectKey = originEntryCertificateSubjectKey(origin.originKey);
    const certificateId = input.allocateCoreCertificateId(subjectKey);
    if (
      !input.coreCertificates.some(
        (certificate) => String(certificate.certificateId) === String(certificateId),
      )
    ) {
      input.coreCertificates.push({
        certificateId,
        rule: "initialState",
        subjectKey,
        dependencyKeys: [],
      });
    }
  }
}

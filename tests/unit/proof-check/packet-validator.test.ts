import { describe, expect, test } from "bun:test";
import { targetId } from "../../../src/semantic/ids";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCoreCertificate } from "../../../src/proof-check/model/certificates";
import {
  checkedFactKindId,
  emptyCheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../../../src/proof-check/model/fact-packet";
import {
  validateCheckedFactPacket,
  type ValidateCheckedFactPacketInput,
} from "../../../src/proof-check/validation/packet-validator";
import {
  buildOriginPacketEntry,
  originEntryCertificateSubjectKey,
} from "../../../src/proof-check/validation/origin-packet-entry";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { proofMirOriginId } from "../../../src/proof-mir/ids";
import { compareCodeUnitStrings } from "../../../src/semantic/surface/deterministic-sort";
import { checkedPacketEnvelopeForTest } from "./packet-envelope-validator.test";

function originPacketEntriesForTest(
  entries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[],
  certificateIdForOrigin: (originKey: string) => ReturnType<typeof proofCheckCoreCertificateId>,
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  const originFacts = new Map<string, CheckedOriginFact>();
  for (const entry of entries) {
    if (entry.origin.originKey.length === 0) {
      continue;
    }
    originFacts.set(entry.origin.originKey, entry.origin);
  }
  return [...originFacts.values()]
    .sort((left, right) => compareCodeUnitStrings(left.originKey, right.originKey))
    .map((origin) =>
      buildOriginPacketEntry({
        origin,
        certificate: {
          kind: "core",
          id: certificateIdForOrigin(origin.originKey),
        },
      }),
    );
}

function collectOriginsForTest(
  entries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[],
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  return originPacketEntriesForTest(entries, () => proofCheckCoreCertificateId(100));
}

function proofAuthorityFingerprintForTest(digestHex = "aa".repeat(32)): ProofAuthorityFingerprint {
  return {
    authorityKind: "platform",
    targetId: targetId("uefi-aarch64"),
    version: "platform-v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

function coreCertificateForTest(
  overrides: Partial<ProofCheckCoreCertificate> = {},
): ProofCheckCoreCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(1),
    rule: "ownershipTransfer",
    subjectKey: "place:3",
    dependencyKeys: [],
    ...overrides,
  };
}

export function ownershipFactForTest(
  overrides: Partial<CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>> = {},
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  return checkedPacketEnvelopeForTest({
    kind: checkedFactKindId("ownership"),
    certificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
    ...overrides,
  });
}

export function checkedFactPacketForTest(
  overrides: Partial<
    ValidateCheckedFactPacketInput & {
      readonly ownership?: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    }
  > = {},
): ValidateCheckedFactPacketInput {
  const ownership = overrides.ownership ?? [ownershipFactForTest()];
  const origins = overrides.packet?.origins ?? collectOriginsForTest(ownership);
  const certificates = overrides.certificates ?? [
    ...ownership.map(() =>
      coreCertificateForTest({ certificateId: proofCheckCoreCertificateId(1) }),
    ),
    ...origins.map((originEntry) =>
      coreCertificateForTest({
        certificateId: originEntry.certificate.id as ReturnType<typeof proofCheckCoreCertificateId>,
        subjectKey: originEntryCertificateSubjectKey(originEntry.origin.originKey),
        rule: "initialState",
      }),
    ),
  ];

  return {
    packet: {
      ...emptyCheckedFactPacket(),
      ownership,
      origins,
      ...overrides.packet,
    },
    certificates,
    authorityFingerprints: overrides.authorityFingerprints ?? [proofAuthorityFingerprintForTest()],
    proofMirNodeKeys:
      overrides.proofMirNodeKeys ??
      new Set([
        "proofMirPlace:3",
        ...ownership.flatMap((entry) =>
          entry.dependencies.flatMap((dependency) => {
            if (dependency.kind === "proofMirPlace") {
              return [`proofMirPlace:${String(dependency.placeId)}`];
            }
            return [];
          }),
        ),
      ]),
    layoutFactKeys: overrides.layoutFactKeys,
    packetSourceKeys: overrides.packetSourceKeys,
    privateGenerationKeys: overrides.privateGenerationKeys,
  };
}

describe("validateCheckedFactPacket", () => {
  test("packet validator rejects dependency on missing core certificate", () => {
    const packet = checkedFactPacketForTest({
      ownership: [
        ownershipFactForTest({
          dependencies: [
            { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(99) },
          ],
        }),
      ],
      certificates: [],
    });

    const diagnostics = validateCheckedFactPacket(packet);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("missing-core-certificate"),
      ),
    ).toBe(true);
  });

  test("packet validator accepts a well-formed ownership packet", () => {
    const diagnostics = validateCheckedFactPacket(checkedFactPacketForTest());

    expect(diagnostics).toEqual([]);
  });

  test("packet validator rejects invalid subject kinds for fact categories", () => {
    const diagnostics = validateCheckedFactPacket(
      checkedFactPacketForTest({
        ownership: [
          ownershipFactForTest({
            subject: {
              kind: "terminal",
              terminalKey: checkedTerminalClosureKey("terminal:self"),
            },
          }),
        ],
      }),
    );

    expect(
      diagnostics.some((diagnostic) => diagnostic.stableDetail.includes("invalid-subject-kind")),
    ).toBe(true);
  });

  test("packet validator rejects unknown fact kinds even when cast by a caller", () => {
    const diagnostics = validateCheckedFactPacket(
      checkedFactPacketForTest({
        ownership: [
          ownershipFactForTest({
            kind: "forged" as CheckedFactKindId,
          }),
        ],
      }),
    );

    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("unknown-fact-kind:forged"),
      ),
    ).toBe(true);
    expect(() => validateCheckedFactPacket(checkedFactPacketForTest())).not.toThrow();
  });

  test("packet validator rejects stale authority fingerprints on dependencies", () => {
    const staleFingerprint = proofAuthorityFingerprintForTest("cc".repeat(32));
    const diagnostics = validateCheckedFactPacket(
      checkedFactPacketForTest({
        ownership: [
          ownershipFactForTest({
            dependencies: [
              {
                kind: "authorityEntry",
                fingerprint: staleFingerprint,
                entryKey: "platform:send",
              },
            ],
          }),
        ],
        authorityFingerprints: [proofAuthorityFingerprintForTest()],
      }),
    );

    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("stale-authority-fingerprint"),
      ),
    ).toBe(true);
  });

  test("packet validator rejects certificates that do not prove the subject", () => {
    const diagnostics = validateCheckedFactPacket(
      checkedFactPacketForTest({
        ownership: [
          ownershipFactForTest({
            certificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
          }),
        ],
        certificates: [
          coreCertificateForTest({
            certificateId: proofCheckCoreCertificateId(1),
            rule: "packetSource",
            subjectKey: "packet:source",
          }),
        ],
      }),
    );

    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("certificate-subject-mismatch"),
      ),
    ).toBe(true);
  });

  test("packet validator rejects missing entry certificates", () => {
    const diagnostics = validateCheckedFactPacket(
      checkedFactPacketForTest({
        ownership: [
          ownershipFactForTest({
            certificate: { kind: "core", id: proofCheckCoreCertificateId(42) },
          }),
        ],
        certificates: [],
      }),
    );

    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("missing-entry-certificate"),
      ),
    ).toBe(true);
  });

  test("terminal closure accepts semantics certificates that prove the subject", () => {
    const terminalKey = checkedTerminalClosureKey("terminal:self");
    const terminalClosure = [
      checkedPacketEnvelopeForTest({
        factId: proofCheckPacketFactId(2),
        kind: checkedFactKindId("terminalClosure"),
        subject: { kind: "terminal", terminalKey },
        certificate: { kind: "semantics", id: proofSemanticsCertificateId(9) },
        dependencies: [],
        invalidatedBy: [],
        origin: {
          originKey: "origin:terminal:1",
          proofMirOriginId: proofMirOriginId(5),
        },
      }),
    ];
    const diagnostics = validateCheckedFactPacket({
      packet: {
        ...emptyCheckedFactPacket(),
        terminalClosure,
        origins: collectOriginsForTest(terminalClosure),
      },
      certificates: [
        {
          kind: "semantics",
          certificateId: proofSemanticsCertificateId(9),
          subjectKey: `terminal:${terminalKey}`,
          dependencyKeys: [],
        },
        coreCertificateForTest({
          certificateId: proofCheckCoreCertificateId(100),
          subjectKey: "origin-entry:origin:terminal:1",
          rule: "initialState",
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
  });

  test("rejects packet origins with empty origin keys", () => {
    const input = checkedFactPacketForTest();
    const emptyOriginEntry = buildOriginPacketEntry({
      origin: { originKey: "", proofMirOriginId: proofMirOriginId(1) },
      certificate: { kind: "core", id: proofCheckCoreCertificateId(200) },
    });
    const diagnostics = validateCheckedFactPacket({
      ...input,
      packet: {
        ...input.packet,
        origins: [emptyOriginEntry],
      },
      certificates: [
        ...input.certificates,
        coreCertificateForTest({
          certificateId: proofCheckCoreCertificateId(200),
          subjectKey: "origin-entry:",
          rule: "initialState",
        }),
      ],
    });

    expect(
      diagnostics.some((diagnostic) => diagnostic.stableDetail === "invalid-packet-origin-key"),
    ).toBe(true);
  });
});

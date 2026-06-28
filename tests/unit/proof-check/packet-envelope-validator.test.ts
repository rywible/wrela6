import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  checkedFactKindId,
  layoutFactKey,
  type CheckedFactDependency,
  type CheckedFactInvalidation,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactSubject,
} from "../../../src/proof-check/model/fact-packet";
import {
  CHECKED_FACT_PACKET_DEPENDENCY_KINDS,
  CHECKED_FACT_PACKET_INVALIDATION_KINDS,
  sortCheckedFactPacketEntries,
  validateCheckedFactPacketEnvelope,
  type CheckedFactPacketDependency,
  type CheckedFactPacketInvalidation,
} from "../../../src/proof-check/validation/packet-validator";
import {
  proofMirOriginId,
  proofMirPlaceId,
  proofMirPrivateStateGenerationId,
} from "../../../src/proof-mir/ids";

function proofAuthorityFingerprintForTest(digestHex = "aa".repeat(32)): ProofAuthorityFingerprint {
  return {
    authorityKind: "platform",
    targetId: targetId("uefi-aarch64"),
    version: "platform-v1",
    digestAlgorithm: "sha256",
    digestHex,
  };
}

export function checkedPacketEnvelopeForTest(
  overrides: Partial<CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>> = {},
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const certificate: ProofCheckCertificateId = {
    kind: "core",
    id: proofCheckCoreCertificateId(1),
  };

  return {
    factId: proofCheckPacketFactId(1),
    kind: checkedFactKindId("ownership"),
    subject: { kind: "place", placeId: proofMirPlaceId(3) },
    scope: { kind: "wholeImage" },
    dependencies: [{ kind: "proofMirPlace", placeId: proofMirPlaceId(3) }],
    invalidatedBy: [{ kind: "placeMove", placeId: proofMirPlaceId(3) }],
    certificate,
    origin: {
      originKey: "origin:ownership:1",
      proofMirOriginId: proofMirOriginId(4),
    },
    ...overrides,
  };
}

describe("checked fact packet envelope dependency and invalidation kinds", () => {
  test("dependency kinds are the closed Task 5A envelope set", () => {
    expect([...CHECKED_FACT_PACKET_DEPENDENCY_KINDS]).toEqual([
      "proofMirNode",
      "layoutFact",
      "authorityFingerprint",
      "coreCertificate",
      "semanticsCertificate",
      "summaryInstantiationCertificate",
      "packetSource",
      "privateGeneration",
    ]);
  });

  test("invalidation kinds are the closed Task 5A envelope set", () => {
    expect([...CHECKED_FACT_PACKET_INVALIDATION_KINDS]).toEqual([
      "placeMutation",
      "placeMove",
      "placeConsume",
      "loanConflict",
      "privateStateAdvance",
      "platformEffect",
      "runtimeEffect",
      "packetSourceSplit",
      "callResultRewrite",
      "cfgRewrite",
      "abiRewrite",
      "authorityChange",
    ]);
  });

  test("CheckedFactPacketDependency union covers every dependency kind label", () => {
    const dependencies: CheckedFactPacketDependency[] = [
      { kind: "proofMirNode", nodeKey: "proofMirPlace:3" },
      { kind: "layoutFact", layoutKey: "layout:buffer" },
      {
        kind: "authorityFingerprint",
        fingerprint: proofAuthorityFingerprintForTest(),
      },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
      { kind: "semanticsCertificate", certificateId: proofSemanticsCertificateId(2) },
      {
        kind: "summaryInstantiationCertificate",
        certificateId: checkedSummaryInstantiationCertificateId(3),
      },
      { kind: "packetSource", packetSourceKey: "4:5" },
      { kind: "privateGeneration", generationKey: "generation:1" },
    ];

    expect(dependencies.map((dependency) => dependency.kind)).toEqual([
      ...CHECKED_FACT_PACKET_DEPENDENCY_KINDS,
    ]);
  });

  test("CheckedFactPacketInvalidation union covers every invalidation kind label", () => {
    const invalidations: CheckedFactPacketInvalidation[] = [
      { kind: "placeMutation", placeIdKey: "3" },
      { kind: "placeMove", placeIdKey: "3" },
      { kind: "placeConsume", placeIdKey: "3" },
      { kind: "loanConflict", placeIdKey: "3" },
      { kind: "privateStateAdvance", placeIdKey: "3" },
      {
        kind: "platformEffect",
        effectKindKey: "send",
        subjectKey: "place:3",
      },
      {
        kind: "runtimeEffect",
        effectKindKey: "alloc",
        subjectKey: "place:3",
      },
      { kind: "packetSourceSplit", packetSourceKey: "4:5" },
      { kind: "callResultRewrite", callIdKey: "7" },
      { kind: "cfgRewrite", functionInstanceIdKey: "fn:main" },
      { kind: "abiRewrite", layoutKey: "layout:abi" },
      { kind: "authorityChange", fingerprintKey: "bb".repeat(32) },
    ];

    expect(invalidations.map((invalidation) => invalidation.kind)).toEqual([
      ...CHECKED_FACT_PACKET_INVALIDATION_KINDS,
    ]);
  });
});

describe("validateCheckedFactPacketEnvelope", () => {
  test("accepts a well-formed ownership packet envelope", () => {
    const diagnostics = validateCheckedFactPacketEnvelope(checkedPacketEnvelopeForTest());

    expect(diagnostics).toEqual([]);
  });

  test("packet envelope rejects duplicate dependency keys", () => {
    const entry = checkedPacketEnvelopeForTest({
      dependencies: [
        { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
        { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
      ],
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("duplicate-dependency");
  });

  test("packet envelope rejects duplicate invalidation keys", () => {
    const entry = checkedPacketEnvelopeForTest({
      invalidatedBy: [
        { kind: "placeMove", placeId: proofMirPlaceId(3) },
        { kind: "placeMove", placeId: proofMirPlaceId(3) },
      ],
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("duplicate-invalidation");
  });

  test("packet envelope rejects unknown fact kind labels even when cast by a caller", () => {
    const entry = checkedPacketEnvelopeForTest({
      kind: "not-a-proof-check-fact" as CheckedFactKindId,
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("unknown-fact-kind");
  });

  test("packet envelope rejects empty subject keys", () => {
    const entry = checkedPacketEnvelopeForTest({
      subject: {
        kind: "authority",
        fingerprint: proofAuthorityFingerprintForTest(),
        entryKey: "",
      },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toBe("empty-subject-key");
  });

  test("packet envelope rejects empty validity scopes", () => {
    const entry = checkedPacketEnvelopeForTest({
      scope: { kind: "function", functionInstanceId: monoInstanceId("") },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toBe("empty-validity-scope");
  });

  test("packet envelope rejects missing certificate references", () => {
    const entry = checkedPacketEnvelopeForTest({
      certificate: undefined as unknown as ProofCheckCertificateId,
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toBe("missing-certificate");
  });

  test("packet envelope rejects certificate kinds that cannot prove the entry fact kind", () => {
    const entry = checkedPacketEnvelopeForTest({
      kind: checkedFactKindId("terminalClosure"),
      certificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("certificate-kind-mismatch");
  });

  test("packet envelope rejects unknown dependency kinds", () => {
    const entry = checkedPacketEnvelopeForTest({
      dependencies: [{ kind: "forgedDependency", value: 1 } as unknown as CheckedFactDependency],
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("unknown-dependency-kind");
  });

  test("packet envelope rejects unknown invalidation kinds", () => {
    const entry = checkedPacketEnvelopeForTest({
      invalidatedBy: [
        { kind: "forgedInvalidation", value: 1 } as unknown as CheckedFactInvalidation,
      ],
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toContain("unknown-invalidation-kind");
  });

  test("packet envelope rejects empty origin keys", () => {
    const entry = checkedPacketEnvelopeForTest({
      origin: {
        originKey: "",
        proofMirOriginId: proofMirOriginId(4),
      },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
    expect(diagnostics[0]?.stableDetail).toBe("empty-origin-key");
  });

  test("terminal closure accepts semantics certificates", () => {
    const entry = checkedPacketEnvelopeForTest({
      kind: checkedFactKindId("terminalClosure"),
      certificate: { kind: "semantics", id: proofSemanticsCertificateId(9) },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics).toEqual([]);
  });

  test("origin facts accept summary-instantiation certificates", () => {
    const entry = checkedPacketEnvelopeForTest({
      kind: checkedFactKindId("origin"),
      subject: {
        kind: "privateState",
        placeId: proofMirPlaceId(3),
        generation: proofMirPrivateStateGenerationId(1),
      },
      certificate: {
        kind: "summaryInstantiation",
        id: checkedSummaryInstantiationCertificateId(2),
      },
    });

    const diagnostics = validateCheckedFactPacketEnvelope(entry);

    expect(diagnostics).toEqual([]);
  });
});

describe("sortCheckedFactPacketEntries", () => {
  test("sorts by fact kind, subject key, validity scope key, certificate key, and origin key", () => {
    const entries = [
      checkedPacketEnvelopeForTest({
        kind: checkedFactKindId("noalias"),
        subject: { kind: "place", placeId: proofMirPlaceId(2) },
        origin: { originKey: "origin:b", proofMirOriginId: proofMirOriginId(2) },
      }),
      checkedPacketEnvelopeForTest({
        kind: checkedFactKindId("ownership"),
        subject: { kind: "place", placeId: proofMirPlaceId(1) },
        origin: { originKey: "origin:a", proofMirOriginId: proofMirOriginId(1) },
      }),
      checkedPacketEnvelopeForTest({
        kind: checkedFactKindId("ownership"),
        subject: { kind: "place", placeId: proofMirPlaceId(2) },
        scope: { kind: "function", functionInstanceId: monoInstanceId("fn:a") },
        origin: { originKey: "origin:c", proofMirOriginId: proofMirOriginId(3) },
      }),
      checkedPacketEnvelopeForTest({
        kind: checkedFactKindId("ownership"),
        subject: { kind: "place", placeId: proofMirPlaceId(2) },
        scope: { kind: "function", functionInstanceId: monoInstanceId("fn:b") },
        certificate: { kind: "core", id: proofCheckCoreCertificateId(2) },
        origin: { originKey: "origin:d", proofMirOriginId: proofMirOriginId(4) },
      }),
      checkedPacketEnvelopeForTest({
        kind: checkedFactKindId("ownership"),
        subject: { kind: "layout", layoutKey: layoutFactKey("layout:z") },
        origin: { originKey: "origin:z", proofMirOriginId: proofMirOriginId(5) },
      }),
    ];

    const sorted = sortCheckedFactPacketEntries(entries);

    expect(sorted.map((entry) => entry.kind)).toEqual([
      checkedFactKindId("noalias"),
      checkedFactKindId("ownership"),
      checkedFactKindId("ownership"),
      checkedFactKindId("ownership"),
      checkedFactKindId("ownership"),
    ]);
    expect(sorted.map((entry) => entry.origin.originKey)).toEqual([
      "origin:b",
      "origin:z",
      "origin:a",
      "origin:c",
      "origin:d",
    ]);
  });
});

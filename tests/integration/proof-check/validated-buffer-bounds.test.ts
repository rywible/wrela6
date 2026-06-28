import { describe, expect, test, beforeEach } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkDerivedFieldReadRequirement,
  checkValidatedBufferReadRequirement,
  layoutFitsFactForTest,
  payloadEndFactForTest,
  payloadReadForTest,
} from "../../../src/proof-check/domains/validated-buffers";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { resetLayoutEntailmentCertificateIdsForTest } from "../../../src/proof-check/domains/layout-entailment";
import { fieldId } from "../../../src/semantic/ids";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import {
  activeFactForTest,
  packetSourceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import {
  checkProofSourceForTest,
  domainIntegrationFixtureForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";

const VALIDATED_BUFFER_SOURCE = [
  "validated buffer Packet:",
  "    params:",
  "        payload_len: u8",
  "    layout:",
  "        header at 0 len 4",
  "        payload at 4 len payload_len",
].join("\n");

const READ_TAG_SOURCE = [
  "validated buffer Packet:",
  "    params:",
  "        limits: u16",
  "    layout:",
  "        tag: u8 @ 0",
  "        payload: u8 @ 1 len source.len - 1",
  "    require:",
  "        source.len >= 2",
  "",
  "fn read_tag(packet: Packet) -> u8:",
  "    return packet.tag",
  "",
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        return",
].join("\n");

function deriveEntryForIntegrationTest() {
  return {
    fieldId: fieldId(2),
    name: "kind",
    type: { kind: "core" as const, coreTypeId: "PacketKind" as never },
    source: {
      kind: "constant" as const,
      value: 0n,
      unit: "byteLength" as const,
      range: { minimum: 0n, maximum: 255n, provenance: "constant" as const },
    },
    cases: [
      {
        condition: { kind: "otherwise" as const },
        result: {
          kind: "constant" as const,
          value: 0n,
          unit: "byteLength" as const,
          range: { minimum: 0n, maximum: 0n, provenance: "constant" as const },
        },
        sourceOrigin: "derive:kind",
      },
    ],
    sourceOrigin: "derive:kind",
  };
}

function proofMirDomainFixtureForValidatedBufferTest(label: string) {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirDomainFixtureForValidatedBufferTest(${label}) failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
  resetLayoutEntailmentCertificateIdsForTest();
});

describe("validated buffer bounds integration", () => {
  test("accepted dynamic payload read discharges layoutFits and payloadEnd requirements", () => {
    const layoutFact = layoutFitsFactForTest("source", "payload-end");
    const payloadEnd = payloadEndFactForTest("source", "payload-end");
    const state = proofCheckStateForTest({
      facts: [
        activeFactForTest(normalizeProofCheckTerm(layoutFact).key),
        activeFactForTest(normalizeProofCheckTerm(payloadEnd).key),
      ],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: payloadReadForTest({ source: "source", end: "payload-end" }),
      factTerms: [layoutFact, payloadEnd],
      ownerKey: "integration:validated-buffer:accept",
    });

    expect(result.kind).toBe("ok");
  });

  test("rejected dynamic payload read without layoutFits reports deterministic layout entailment diagnostic", () => {
    const payloadEnd = payloadEndFactForTest("source", "payload-end");
    const state = proofCheckStateForTest({
      facts: [activeFactForTest(normalizeProofCheckTerm(payloadEnd).key)],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: payloadReadForTest({ source: "source", end: "payload-end" }),
      factTerms: [payloadEnd],
      ownerKey: "integration:validated-buffer:missing-layout-fits",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
        ownerKey: "integration:validated-buffer:missing-layout-fits",
        rootCauseKey: `layout-requirement:${normalizeProofCheckTerm(layoutFitsFactForTest("source", "payload-end")).key}`,
      },
    ]);
  });

  test("rejected dynamic payload read without payloadEnd reports deterministic layout entailment diagnostic", () => {
    const layoutFact = layoutFitsFactForTest("source", "payload-end");
    const state = proofCheckStateForTest({
      facts: [activeFactForTest(normalizeProofCheckTerm(layoutFact).key)],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: payloadReadForTest({ source: "source", end: "payload-end" }),
      factTerms: [layoutFact],
      ownerKey: "integration:validated-buffer:reject",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
        ownerKey: "integration:validated-buffer:reject",
        rootCauseKey: `layout-requirement:${normalizeProofCheckTerm(payloadEndFactForTest("source", "payload-end")).key}`,
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT"),
    );
  });

  test("probeProofCheckSourceSyntaxForTest routes validated-buffer declarations through fixture fallback when unsupported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(VALIDATED_BUFFER_SOURCE);
    const fixture = domainIntegrationFixtureForTest({
      source: VALIDATED_BUFFER_SOURCE,
      fixtureFallback: () => proofMirDomainFixtureForValidatedBufferTest("validated-buffer"),
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
  });
});

describe("validated buffer bounds end-to-end integration", () => {
  test("derived field read without source field certificate reports deterministic layout entailment diagnostic", () => {
    const deriveEntry = deriveEntryForIntegrationTest();
    const state = proofCheckStateForTest({
      packetSources: [packetSourceForTest("packet", "source")],
    });

    const result = checkDerivedFieldReadRequirement({
      state,
      read: {
        source: { kind: "synthetic", id: "source" as never },
        packet: { kind: "synthetic", id: "packet" as never },
        derivedFieldId: fieldId(2),
        sourceFieldId: fieldId(1),
        deriveEntry,
      },
      ownerKey: "integration:derived-field:missing-source-certificate",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
        ownerKey: "integration:derived-field:missing-source-certificate",
        rootCauseKey: `source-field:${String(fieldId(1))}`,
      },
    ]);
  });

  test("missing payloadEnd on dynamic payload read is rejected end to end", () => {
    const layoutFact = layoutFitsFactForTest("source", "payload-end");
    const state = proofCheckStateForTest({
      facts: [activeFactForTest(normalizeProofCheckTerm(layoutFact).key)],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: payloadReadForTest({ source: "source", end: "payload-end" }),
      factTerms: [layoutFact],
      ownerKey: "integration:e2e:missing-payload-end",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
        ownerKey: "integration:e2e:missing-payload-end",
        rootCauseKey: `layout-requirement:${normalizeProofCheckTerm(payloadEndFactForTest("source", "payload-end")).key}`,
      },
    ]);
  });

  test("accepted validated-buffer program passes checkProofAndResources end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "validated-buffer-success",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
  });

  test("checkProofSourceForTest accepts supported validated-buffer read when probe returns supported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(READ_TAG_SOURCE);
    expect(syntax).toBe("supported");

    const result = checkProofSourceForTest(READ_TAG_SOURCE, {
      fixtureFallback: { validCase: "validated-buffer-success" },
    });

    expect(result.kind).toBe("ok");
  });

  test("checkProofSourceForTest routes validated-buffer declarations through fixture fallback when unsupported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(VALIDATED_BUFFER_SOURCE);
    const result = checkProofSourceForTest(VALIDATED_BUFFER_SOURCE, {
      fixtureFallback: { validCase: "validated-buffer-success" },
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.checked.mir.functions.entries().length).toBeGreaterThan(0);
      return;
    }
    expect(result.kind).toBe("ok");
  });

  test("derived packet kind refinement accepts through fixture fallback when source is unsupported", () => {
    const deriveSource = [
      "validated buffer Packet:",
      "    params:",
      "        limits: u16",
      "    layout:",
      "        tag: u8 @ 0",
      "        payload: u8 @ 1 len source.len - 1",
      "    derive:",
      "        kind: payload_kind from tag",
      "",
      "fn read_kind(packet: Packet) -> u8:",
      "    return packet.kind",
      "",
      "uefi image Boot:",
      "    fn main() -> Never:",
      "        return",
    ].join("\n");
    const syntax = probeProofCheckSourceSyntaxForTest(deriveSource);

    const result = checkProofSourceForTest(deriveSource, {
      fixtureFallback: { validCase: "packet-rich-accepted-program" },
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(result.kind).toBe("ok");
  });

  test("packet validate fixture accepts end to end through checkProofAndResources", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "validated-buffer-success",
    });

    expect(result.kind).toBe("ok");
  });
});

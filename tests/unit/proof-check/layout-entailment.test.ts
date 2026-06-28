import { describe, expect, test, beforeEach } from "bun:test";
import { fieldId } from "../../../src/semantic/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  bindValidationGuardLayoutFits,
  normalizeLayoutExpressionKey,
  normalizeLayoutOperand,
  proveLayoutEntailment,
  resetLayoutEntailmentCertificateIdsForTest,
} from "../../../src/proof-check/domains/layout-entailment";
import {
  checkDerivedFieldReadRequirement,
  checkValidatedBufferReadRequirement,
  fixedFieldReadForTest,
  layoutFitsFactForTest,
  payloadEndFactForTest,
  payloadReadForTest,
} from "../../../src/proof-check/domains/validated-buffers";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import {
  activeFactForTest,
  packetSourceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";
import { factEnvironmentForTest } from "./entailment.test";

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
  resetLayoutEntailmentCertificateIdsForTest();
});

describe("normalizeLayoutOperand", () => {
  test("layout terms normalize to bounded affine expressions over constants and symbols", () => {
    const constant = normalizeLayoutOperand(literalInt(14n));
    expect(constant).toBeDefined();
    if (constant === undefined) return;
    expect(constant.expression.constant).toBe(14n);
    expect(constant.expression.coefficients.size).toBe(0);

    const symbol = normalizeLayoutOperand(valueTerm("payload-end"));
    expect(symbol).toBeDefined();
    if (symbol === undefined) return;
    expect(symbol.expression.constant).toBe(0n);
    expect(symbol.expression.coefficients.get("payload-end")).toBe(1n);

    const sumKey = normalizeLayoutExpressionKey(literalInt(2n), "add", valueTerm("payload_len"));
    expect(sumKey).toContain("affine:");
    expect(sumKey).toContain("2");
    expect(sumKey).toContain("payload_len");
  });
});

describe("proveLayoutEntailment", () => {
  test("layoutFits is proved from direct active fact membership", () => {
    const layoutFact = layoutFitsFactForTest("source", "payload-end");
    const environment = factEnvironmentForTest([layoutFact]);

    const result = proveLayoutEntailment(environment, layoutFact);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificate.normalizedTermKey).toBe(normalizeProofCheckTerm(layoutFact).key);
    expect(result.certificate.certificate.rule).toBe("layoutReadRequirement");
  });

  test("payloadEnd and fieldAvailable are proved only from matching active facts", () => {
    const payloadEnd = payloadEndFactForTest("source", "payload-end");
    const environment = factEnvironmentForTest([payloadEnd]);

    const result = proveLayoutEntailment(environment, payloadEnd);
    expect(result.kind).toBe("ok");

    const missing = proveLayoutEntailment(factEnvironmentForTest([]), payloadEnd);
    expect(missing.kind).toBe("missing");
  });

  test("rangeConstraint is proved from comparison entailment", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("left"), "le", valueTerm("right")),
    ]);

    const result = proveLayoutEntailment(environment, {
      kind: "rangeConstraint",
      left: valueTerm("left"),
      relation: "<=",
      right: valueTerm("right"),
      width: { kind: "target", targetTypeId: "usize" as never },
    });

    expect(result.kind).toBe("ok");
  });

  test("noUnsignedOverflow is proved from upper-bound comparison facts", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("sum"), "le", literalInt(255n)),
    ]);

    const result = proveLayoutEntailment(environment, {
      kind: "noUnsignedOverflow",
      expression: valueTerm("sum"),
      width: { kind: "target", targetTypeId: "usize" as never },
    });

    expect(result.kind).toBe("ok");
  });
});

describe("bindValidationGuardLayoutFits", () => {
  test("runtime validation guard binding produces layoutFits only on the successful edge", () => {
    const end = valueTerm("payload-end");
    const endKey = normalizeProofCheckTerm({
      kind: "layoutFits",
      source: { kind: "synthetic", id: "source" as never },
      end,
    })
      .key.split(":")
      .slice(2)
      .join(":");

    const success = bindValidationGuardLayoutFits({
      source: { kind: "synthetic", id: "source" as never },
      end,
      dominatesSuccessfulEdge: true,
      guardEndTermKey: endKey,
    });
    expect(success.kind).toBe("ok");
    if (success.kind !== "ok") return;
    expect(success.fact?.kind).toBe("layoutFits");

    const failure = bindValidationGuardLayoutFits({
      source: { kind: "synthetic", id: "source" as never },
      end,
      dominatesSuccessfulEdge: false,
      guardEndTermKey: endKey,
    });
    expect(failure.kind).toBe("skipped");
    expect(failure.fact).toBeUndefined();
  });
});

describe("checkValidatedBufferReadRequirement", () => {
  test("payload read without payloadEnd is rejected even when fixed fields fit", () => {
    const layoutFact = layoutFitsFactForTest("source", "payload-end");
    const state = proofCheckStateForTest({
      facts: [activeFactForTest(normalizeProofCheckTerm(layoutFact).key)],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: payloadReadForTest({ source: "source", end: "payload-end" }),
      factTerms: [layoutFact],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT"),
    );
  });

  test("dynamic payload read succeeds when payloadEnd and layoutFits are both certified", () => {
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
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificates.length).toBe(2);
  });

  test("fixed field read requires layoutFits but not payloadEnd", () => {
    const layoutFact = layoutFitsFactForTest("source", "fixed-end");
    const state = proofCheckStateForTest({
      facts: [activeFactForTest(normalizeProofCheckTerm(layoutFact).key)],
    });

    const result = checkValidatedBufferReadRequirement({
      state,
      read: fixedFieldReadForTest({ source: "source", end: "fixed-end" }),
      factTerms: [layoutFact],
    });

    expect(result.kind).toBe("ok");
  });
});

describe("checkDerivedFieldReadRequirement", () => {
  test("derived fields require derive-table entry, source certificate, and packet/source relationship", () => {
    const sourceCertificate = {
      certificate: {
        certificateId: 0 as never,
        rule: "layoutReadRequirement" as const,
        subjectKey: "source-field-read",
        dependencyKeys: ["fact:source-field"],
      },
      normalizedTermKey: "fieldAvailable:source:1",
      dependencyKeys: ["fact:source-field"],
    };

    const deriveEntry = {
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

    const missingPacket = checkDerivedFieldReadRequirement({
      state: proofCheckStateForTest(),
      read: {
        source: { kind: "synthetic", id: "source" as never },
        packet: { kind: "synthetic", id: "packet" as never },
        derivedFieldId: fieldId(2),
        sourceFieldId: fieldId(1),
        deriveEntry,
        sourceFieldReadCertificate: sourceCertificate,
      },
    });
    expect(missingPacket.kind).toBe("error");

    const accepted = checkDerivedFieldReadRequirement({
      state: proofCheckStateForTest({
        packetSources: [packetSourceForTest("packet", "source")],
      }),
      read: {
        source: { kind: "synthetic", id: "source" as never },
        packet: { kind: "synthetic", id: "packet" as never },
        derivedFieldId: fieldId(2),
        sourceFieldId: fieldId(1),
        deriveEntry,
        sourceFieldReadCertificate: sourceCertificate,
      },
    });
    expect(accepted.kind).toBe("ok");
  });
});

import { describe, expect, test, beforeEach } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  buildProofCheckFactEnvironment,
  checkCallRequirementsEntailment,
  resetProofCheckCoreCertificateIdsForTest,
} from "../../../src/proof-check/domains/facts";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import {
  checkProofSourceForTest,
  domainIntegrationFixtureForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  PROOF_CHECK_SUPPORTED_CLOSED_SOURCE,
} from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import { factEnvironmentForTest } from "../../unit/proof-check/entailment.test";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";

const CALL_REQUIRES_SOURCE = [
  "fn make_len(value: Length) -> Length:",
  "    requires:",
  "        value <= 8",
  "    return value",
  "",
  "fn main(value: Length) -> Length:",
  "    requires:",
  "        value <= 8",
  "    make_len(value)",
].join("\n");

function proofMirDomainFixtureForCallRequirementsTest(label: string) {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirDomainFixtureForCallRequirementsTest(${label}) failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
});

describe("call requirements integration", () => {
  test("accepted call requirement is discharged when active facts entail callee requires", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("value"), "le", literalInt(8n)),
    ]);

    const result = checkCallRequirementsEntailment(environment, [
      comparisonTerm(valueTerm("value"), "le", literalInt(8n)),
    ]);

    expect(result.kind).toBe("ok");
  });

  test("rejected call requirement reports unsatisfied requirement deterministically", () => {
    const environment = factEnvironmentForTest([]);

    const requirement = comparisonTerm(valueTerm("value"), "le", literalInt(8n));

    const result = checkCallRequirementsEntailment(environment, [requirement], {
      ownerKey: "call:make_len",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
        ownerKey: "call:make_len",
        rootCauseKey: `call-requirement:${normalizeProofCheckTerm(requirement).key}`,
      },
    ]);
  });

  test("probeProofCheckSourceSyntaxForTest routes unsupported requires syntax through fixture fallback", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(CALL_REQUIRES_SOURCE);
    const fixture = domainIntegrationFixtureForTest({
      source: CALL_REQUIRES_SOURCE,
      fixtureFallback: () => proofMirDomainFixtureForCallRequirementsTest("requires-blocks"),
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
    if (syntax === "unsupported-source-syntax") {
      expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    }
  });

  test("fixture-backed rejected case when unsupported inline requires syntax is named", () => {
    const fixture = domainIntegrationFixtureForTest({
      source: "fn main() -> Never { unsupported_inline_body() }",
      fixtureFallback: () =>
        proofMirDomainFixtureForCallRequirementsTest("unsupported-inline-body"),
    });

    const environment = buildProofCheckFactEnvironment({
      terms: [comparisonTerm(valueTerm("bound"), "le", literalInt(4n))],
      ownerKey: "integration:call-requirements",
    });

    const result = checkCallRequirementsEntailment(
      environment,
      [comparisonTerm(valueTerm("value"), "le", literalInt(8n))],
      { ownerKey: "integration:call-requirements" },
    );

    expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
  });
});

describe("call requirements public API integration", () => {
  test("supported closed source accepts end to end through checkProofSourceForTest", () => {
    const result = checkProofSourceForTest(PROOF_CHECK_SUPPORTED_CLOSED_SOURCE);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.mir.functions.entries().length).toBeGreaterThan(0);
  });

  test("source call with requires blocks routes through fixture fallback when unsupported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(CALL_REQUIRES_SOURCE);
    const result = checkProofSourceForTest(CALL_REQUIRES_SOURCE, {
      fixtureFallback: {},
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("ok");
    }
  });

  test("missing platform precondition rejects through public checker", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED"),
    );
    const platformDiagnostic = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED"),
    );
    expect(platformDiagnostic).toBeDefined();
    if (platformDiagnostic === undefined) return;
    expect(platformDiagnostic.rootCauseKey).toContain("call-requirement:");
  });
});

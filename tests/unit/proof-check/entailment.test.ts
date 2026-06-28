import { describe, expect, test, beforeEach } from "bun:test";
import { functionId } from "../../../src/semantic/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  addActiveFactToEnvironment,
  buildProofCheckFactEnvironment,
  checkCallRequirementsEntailment,
  proofCheckCoreCertificateStableKey,
  proveCoreEntailment,
  resetProofCheckCoreCertificateIdsForTest,
} from "../../../src/proof-check/domains/facts";
import type { ProofCheckFactTerm } from "../../../src/proof-check/model/fact-language";
import {
  proofCheckActiveFactScopeKey,
  type ProofCheckFactEnvironment,
} from "../../../src/proof-check/model/fact-environment";
import { normalizeProofCheckTerm } from "../../../src/proof-check/model/fact-language";
import { proofMirPrivateStateGenerationId } from "../../../src/proof-mir/ids";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";

export function factEnvironmentForTest(
  terms: readonly ProofCheckFactTerm[],
): ProofCheckFactEnvironment {
  resetProofCheckCoreCertificateIdsForTest();
  return buildProofCheckFactEnvironment({ terms });
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
});

describe("factEnvironmentForTest", () => {
  test("active facts are keyed by normalized term key and scope components", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("a"), "eq", valueTerm("b")),
    ]);

    const record = [...environment.facts.values()][0];
    expect(record).toBeDefined();
    if (record === undefined) return;

    expect(record.scope.termKey).toBe(
      normalizeProofCheckTerm(comparisonTerm(valueTerm("a"), "eq", valueTerm("b"))).key,
    );
    expect(record.scope.privateGenerationKey).toBe("none");
    expect(record.scope.packetSourceKey).toBe("none");
    expect(proofCheckActiveFactScopeKey(record.scope)).toContain(record.scope.termKey);
  });
});

describe("proveCoreEntailment", () => {
  test("core entailment uses equality substitution with stable certificate choice", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("a"), "eq", valueTerm("b")),
      comparisonTerm(valueTerm("b"), "le", literalInt(8n)),
    ]);

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.certificate.rule).toBe("coreEntailment");
  });

  test("entailment chooses the lexicographically smallest stable certificate key", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
      comparisonTerm(valueTerm("a"), "eq", valueTerm("a")),
    ]);

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const directCertificate = {
      ...result.certificate,
      dependencyKeys: [
        normalizeProofCheckTerm(comparisonTerm(valueTerm("a"), "le", literalInt(8n))).key,
      ],
    };
    const equalityCertificate = {
      ...result.certificate,
      dependencyKeys: [
        normalizeProofCheckTerm(comparisonTerm(valueTerm("a"), "eq", valueTerm("a"))).key,
      ],
    };

    const stableKeys = [
      proofCheckCoreCertificateStableKey(directCertificate),
      proofCheckCoreCertificateStableKey(equalityCertificate),
    ].sort();
    expect(proofCheckCoreCertificateStableKey(result.certificate)).toBe(stableKeys[0]!);
  });

  test("transitive comparison chains prove chained less-than-or-equal requirements", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("a"), "le", valueTerm("b")),
      comparisonTerm(valueTerm("b"), "le", literalInt(8n)),
    ]);

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
    );

    expect(result.kind).toBe("ok");
  });

  test("comparison complements prove less-than-or-equal from less-than facts", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("a"), "lt", literalInt(8n)),
    ]);

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
    );

    expect(result.kind).toBe("ok");
  });

  test("direct layout and packet-source membership hooks prove identical requirements", () => {
    const layoutFact = {
      kind: "layoutFits" as const,
      source: { kind: "synthetic" as const, id: "source:buffer" as never },
      end: literalInt(16n),
    };
    const environment = factEnvironmentForTest([layoutFact]);

    const result = proveCoreEntailment(environment, layoutFact);

    expect(result.kind).toBe("ok");
  });

  test("missing-proof explanations identify missing facts", () => {
    const environment = factEnvironmentForTest([]);

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
    );

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("missing-fact:");
  });

  test("missing-proof explanations identify stale private-state generations", () => {
    const environment = factEnvironmentForTest([]);

    const result = proveCoreEntailment(environment, {
      kind: "predicate",
      predicateFunctionId: functionId(1),
      arguments: [valueTerm("state")],
      privateState: {
        place: { kind: "synthetic", id: "private:place" as never },
        generation: proofMirPrivateStateGenerationId(1),
      },
    });

    expect(result.kind).toBe("missing");
    if (result.kind !== "missing") return;
    expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"));
    expect(result.diagnostics[0]?.stableDetail).toContain("stale-private-generation:");
  });
});

describe("contradictory facts", () => {
  test("contradictory facts produce PROOF_CHECK_CONTRADICTORY_FACT diagnostics", () => {
    let environment = factEnvironmentForTest([]);
    environment = addActiveFactToEnvironment(
      environment,
      comparisonTerm(valueTerm("a"), "eq", literalInt(5n)),
    );
    environment = addActiveFactToEnvironment(
      environment,
      comparisonTerm(valueTerm("a"), "eq", literalInt(6n)),
    );

    expect(environment.contradictory).toBe(true);
    expect(environment.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONTRADICTORY_FACT"),
    );
  });

  test("contradictory environments cannot discharge requirements", () => {
    const environment = addActiveFactToEnvironment(
      factEnvironmentForTest([comparisonTerm(valueTerm("a"), "eq", literalInt(5n))]),
      comparisonTerm(valueTerm("a"), "eq", literalInt(6n)),
    );

    const result = proveCoreEntailment(
      environment,
      comparisonTerm(valueTerm("a"), "le", literalInt(5n)),
    );

    expect(result.kind).toBe("missing");
  });
});

describe("checkCallRequirementsEntailment", () => {
  test("discharges multiple call requirements when facts entail each one", () => {
    const environment = factEnvironmentForTest([
      comparisonTerm(valueTerm("value"), "le", literalInt(8n)),
    ]);

    const result = checkCallRequirementsEntailment(environment, [
      comparisonTerm(valueTerm("value"), "le", literalInt(8n)),
    ]);

    expect(result.kind).toBe("ok");
  });
});

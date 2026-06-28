import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import {
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  sortProofCheckDiagnostics,
} from "../../../src/proof-check/diagnostics";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import {
  domainIntegrationFixtureForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
  proofCheckIntegrationFixtureKeysForMir,
} from "../../support/proof-check/integration-fixtures";

const SUPPORTED_SOURCE = ["uefi image Boot:", "    fn main() -> Never:", "        return"].join(
  "\n",
);

function proofMirDomainFixtureForTask12ATest(label: string): ProofMirProgram {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirDomainFixtureForTask12ATest(${label}) failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

describe("probeProofCheckSourceSyntaxForTest", () => {
  test("returns supported for source that parses and lowers end to end", () => {
    expect(probeProofCheckSourceSyntaxForTest(SUPPORTED_SOURCE)).toBe("supported");
  });

  test("returns unsupported-source-syntax for curly-brace body syntax", () => {
    expect(
      probeProofCheckSourceSyntaxForTest("fn main() -> Never { unsupported_inline_body() }"),
    ).toBe("unsupported-source-syntax");
  });
});

describe("domainIntegrationFixtureForTest", () => {
  test("domain integration fixture falls back when syntax is unsupported", () => {
    const fixture = domainIntegrationFixtureForTest({
      source: "fn main() -> Never { unsupported_inline_body() }",
      fixtureFallback: () => proofMirDomainFixtureForTask12ATest("unsupported-inline-body"),
    });

    expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
    expect(fixture.originKeys.length).toBeGreaterThan(0);
    expect(fixture.functionKeys.length).toBeGreaterThan(0);
    expect(fixture.blockKeys.length).toBeGreaterThan(0);
    expect(fixture.programPointKeys.length).toBeGreaterThan(0);
  });

  test("builds Proof MIR from supported source without fixture fallback", () => {
    const fixture = domainIntegrationFixtureForTest({
      source: SUPPORTED_SOURCE,
    });

    expect(fixture.sourceSyntax).toBe("supported");
    expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
    expect(fixture.programPointKeys).toEqual(
      proofCheckIntegrationFixtureKeysForMir(fixture.mir).programPointKeys,
    );
  });

  test("requires fixtureFallback when source syntax is unsupported", () => {
    expect(() =>
      domainIntegrationFixtureForTest({
        source: "fn main() -> Never { unsupported_inline_body() }",
      }),
    ).toThrow("fixtureFallback");
  });
});

describe("proofCheckIntegrationFixtureKeysForMir", () => {
  test("integration fixture keys are deterministic across repeated builds", () => {
    const first = domainIntegrationFixtureForTest({ source: SUPPORTED_SOURCE });
    const second = domainIntegrationFixtureForTest({ source: SUPPORTED_SOURCE });

    expect(first.originKeys).toEqual(second.originKeys);
    expect(first.functionKeys).toEqual(second.functionKeys);
    expect(first.blockKeys).toEqual(second.blockKeys);
    expect(first.programPointKeys).toEqual(second.programPointKeys);
  });
});

describe("expectProofCheckDiagnosticOrderForTest", () => {
  test("asserts diagnostic code order plus owner and root-cause keys", () => {
    const diagnostics = sortProofCheckDiagnostics([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_USE_AFTER_MOVE",
        messageTemplateId: "move.use-after",
        messageArguments: [{ kind: "text", value: "second" }],
        message: "second",
        sourceOrigin: "main.wr:2:1",
        ownerKey: "owner:b",
        rootCauseKey: "move:place:b",
        stableDetail: "place:b",
      }),
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
        messageTemplateId: "requirement.missing",
        messageArguments: [{ kind: "text", value: "first" }],
        message: "first",
        sourceOrigin: "main.wr:1:1",
        ownerKey: "owner:a",
        rootCauseKey: "requirement:fact:a",
        stableDetail: "fact:a",
      }),
    ]);

    expect(() =>
      expectProofCheckDiagnosticOrderForTest(diagnostics, [
        {
          code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
          ownerKey: "owner:a",
          rootCauseKey: "requirement:fact:a",
        },
        {
          code: "PROOF_CHECK_USE_AFTER_MOVE",
          ownerKey: "owner:b",
          rootCauseKey: "move:place:b",
        },
      ]),
    ).not.toThrow();
  });

  test("fails when owner keys are out of order", () => {
    const diagnostics = [
      proofCheckDiagnostic({
        severity: "error",
        code: proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
        messageTemplateId: "requirement.missing",
        messageArguments: [{ kind: "text", value: "detail" }],
        message: "detail",
        ownerKey: "owner:z",
        rootCauseKey: "root:z",
        stableDetail: "z",
      }),
    ];

    expect(() =>
      expectProofCheckDiagnosticOrderForTest(diagnostics, [
        {
          code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
          ownerKey: "owner:a",
          rootCauseKey: "root:z",
        },
      ]),
    ).toThrow();
  });
});

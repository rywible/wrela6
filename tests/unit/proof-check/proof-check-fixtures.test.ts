import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { validateProofCheckInput } from "../../../src/proof-check/validation/input-validator";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";
import { platformCallProofMirFixture } from "../../support/proof-mir/proof-mir-layout-fixtures";
import {
  checkProofAndResourcesForClosedFixture,
  checkProofAndResourcesForTest,
  proofCheckClosedFixture,
  withProofCheckAuthoritiesForTest,
  type ProofCheckInvalidFixtureCase,
} from "../../support/proof-check/proof-check-fixtures";

const DEFAULT_CLOSED_SOURCE = [
  "uefi image Boot:",
  "    fn main() -> Never:",
  "        return",
].join("\n");

const INVALID_FIXTURE_CASES = [
  "forged-summary-facts",
  "live-loan-return",
  "live-session-member-return",
  "wrong-session-discharge",
  "ignored-validation-result",
  "divergent-validation-split",
  "divergent-attempt-split",
  "wrapper-hidden-affine-linear-content",
  "runtime-catalog-fingerprint-mismatch",
  "terminal-self-cycle",
  "terminal-mutual-cycle",
  "unsupported-extension",
  "missing-cross-core-certificate",
  "non-core-movable-move-ring-transfer",
  "missing-platform-precondition",
] as const satisfies readonly ProofCheckInvalidFixtureCase[];

describe("proofCheckClosedFixture", () => {
  test("closed fixture synthesizes authorities that satisfy input validation", () => {
    const input = proofCheckClosedFixture({
      source: DEFAULT_CLOSED_SOURCE,
    });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
  });

  test("default closed fixture passes input validation", () => {
    const input = proofCheckClosedFixture();

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
  });

  test("explicit mir wrapped with authorities passes input validation", () => {
    const buildResult = buildProofMir(closedProofMirFixture());
    if (buildResult.kind !== "ok") {
      throw new Error("expected closed proof mir fixture to build");
    }

    const input = proofCheckClosedFixture({ mir: buildResult.mir });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
  });

  test("platform-call mir passes input validation with synthesized contracts", () => {
    const buildResult = buildProofMir(platformCallProofMirFixture());
    if (buildResult.kind !== "ok") {
      throw new Error("expected platform-call proof mir fixture to build");
    }

    const input = withProofCheckAuthoritiesForTest({ mir: buildResult.mir });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
    expect(input.platformContracts.entries().length).toBeGreaterThan(0);
  });

  test("fixture mutations are pure and return new program objects", () => {
    const buildResult = buildProofMir(closedProofMirFixture());
    if (buildResult.kind !== "ok") {
      throw new Error("expected closed proof mir fixture to build");
    }

    const first = proofCheckClosedFixture({ mir: buildResult.mir });
    const second = proofCheckClosedFixture({ mir: buildResult.mir });

    expect(first).not.toBe(second);
    expect(first.mir).not.toBe(second.mir);
    expect(first.layout).toBe(second.layout);
    expect(first.platformContracts).not.toBe(second.platformContracts);
    expect(first.runtimeCatalog).not.toBe(second.runtimeCatalog);
    expect(first.typeFacts).not.toBe(second.typeFacts);
    expect(first.semantics).not.toBe(second.semantics);
  });

  test("runtime catalog fingerprint mismatch is rejected by input validation", () => {
    const input = proofCheckClosedFixture({
      runtimeCatalogFingerprintName: "selected-runtime",
      embeddedRuntimeCatalogFingerprintName: "embedded-runtime",
    });

    const diagnostics = validateProofCheckInput(input).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
  });

  test("missing-platform-precondition keeps input validation closed while omitting preconditions", () => {
    const input = proofCheckClosedFixture({ invalidCase: "missing-platform-precondition" });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
    expect(input.platformContracts.entries()[0]?.preconditions).toEqual([]);
  });

  test("missing-loop-convergence invalid fixture omits loop convergence judgment", () => {
    const input = proofCheckClosedFixture({ invalidCase: "missing-loop-convergence" });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
    expect(input.semantics.providedJudgments.map(String)).not.toContain("loopConvergence");
  });

  test.each(INVALID_FIXTURE_CASES.map((invalidCase) => [invalidCase] as const))(
    "invalidCase %s rejects checkProofAndResources on repeated calls with same input",
    (invalidCase) => {
      const input = proofCheckClosedFixture({ invalidCase });
      const first = checkProofAndResourcesForTest(input);
      const second = checkProofAndResourcesForTest(input);

      expect(first.kind).toBe("error");
      expect(second.kind).toBe("error");
      if (first.kind !== "error" || second.kind !== "error") return;
      expect(second.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        first.diagnostics.map((diagnostic) => diagnostic.code),
      );
      expect(second.diagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual(
        first.diagnostics.map((diagnostic) => diagnostic.rootCauseKey),
      );
    },
  );

  test.each(INVALID_FIXTURE_CASES.map((invalidCase) => [invalidCase] as const))(
    "invalidCase %s rejects checkProofAndResources",
    (invalidCase) => {
      const result = checkProofAndResourcesForClosedFixture({ invalidCase });

      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );

  test.each(INVALID_FIXTURE_CASES.map((invalidCase) => [invalidCase] as const))(
    "invalidCase %s produces deterministic fixture input",
    (invalidCase) => {
      const first = proofCheckClosedFixture({ invalidCase });
      const second = proofCheckClosedFixture({ invalidCase });

      expect(first.mir).not.toBe(second.mir);
      expect(first.platformContracts).not.toBe(second.platformContracts);
      expect(first.runtimeCatalog).not.toBe(second.runtimeCatalog);
      expect(first.semantics).not.toBe(second.semantics);
    },
  );

  test.each([
    "source-call-summary-import",
    "cross-core-success-transfer",
    "validated-buffer-success",
    "packet-rich-accepted-program",
  ] as const)("validCase %s passes input validation", (validCase) => {
    const input = proofCheckClosedFixture({ validCase });

    expect(validateProofCheckInput(input).diagnostics).toEqual([]);
  });

  test.each([
    "source-call-summary-import",
    "cross-core-success-transfer",
    "validated-buffer-success",
    "packet-rich-accepted-program",
  ] as const)("validCase %s passes checkProofAndResources", (validCase) => {
    const result = checkProofAndResourcesForClosedFixture({ validCase });

    expect(result.kind).toBe("ok");
  });

  test("terminalPlatformBase produces platform-backed terminal fixture input", () => {
    const input = proofCheckClosedFixture({ terminalPlatformBase: true });

    const diagnostics = validateProofCheckInput(input).diagnostics;
    const terminalFunction = input.mir.functions
      .entries()
      .find((functionGraph) => functionGraph.signature.modifiers.isTerminal);

    expect(terminalFunction).toBeDefined();
    expect(input.platformContracts.entries().length).toBeGreaterThan(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_CONTRACT_MISSING"),
    );
  });

  test("terminalPlatformBase passes checkProofAndResources with terminalClosure facts", () => {
    const result = checkProofAndResourcesForClosedFixture({ terminalPlatformBase: true });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.terminalClosure.length).toBeGreaterThan(0);
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
  });

  test("cross-core-success-transfer produces capabilityFlow packet facts", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "cross-core-success-transfer",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.capabilityFlow.length).toBeGreaterThan(0);
  });

  test("validated-buffer-success produces validatedBuffers packet facts", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "validated-buffer-success",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.validatedBuffers.length).toBeGreaterThan(0);
  });
});

describe("withProofCheckAuthoritiesForTest", () => {
  test("derives runtime catalog content from embedded Proof MIR runtime catalog", () => {
    const buildResult = buildProofMir(closedProofMirFixture());
    if (buildResult.kind !== "ok") {
      throw new Error("expected closed proof mir fixture to build");
    }

    const input = withProofCheckAuthoritiesForTest({ mir: buildResult.mir });

    expect(input.runtimeCatalog.targetId).toBe(buildResult.mir.runtimeCatalog.targetId);
    expect([...input.runtimeCatalog.features].map(String)).toEqual(
      [...buildResult.mir.runtimeCatalog.features].map(String),
    );
    expect(input.runtimeCatalog.entries().map((entry) => entry.authorityKey)).toEqual(
      buildResult.mir.runtimeCatalog
        .entries()
        .map((operation) => operation.authorityKey ?? `runtime:${operation.name}`),
    );
  });

  test("derives semantics companion judgments required by reachable MIR constructs", () => {
    const buildResult = buildProofMir(closedProofMirFixture());
    if (buildResult.kind !== "ok") {
      throw new Error("expected closed proof mir fixture to build");
    }

    const loopMir = proofCheckClosedFixture({
      mir: buildResult.mir,
      invalidCase: "missing-loop-convergence",
    }).mir;
    const closedInput = withProofCheckAuthoritiesForTest({ mir: buildResult.mir });
    const loopInput = withProofCheckAuthoritiesForTest({
      mir: loopMir,
      invalidCase: "missing-loop-convergence",
    });

    expect(closedInput.semantics.providedJudgments.map(String)).not.toContain("loopConvergence");
    expect(loopInput.semantics.providedJudgments.map(String)).not.toContain("loopConvergence");
    expect(
      validateProofCheckInput(withProofCheckAuthoritiesForTest({ mir: loopMir })).diagnostics,
    ).toEqual([]);
  });
});

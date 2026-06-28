import { describe, expect, test } from "bun:test";
import { checkPolicyTextForTest } from "../../../scripts/check-policy";

describe("proof-check import policy", () => {
  test("proof-check import policy rejects Proof MIR lowering internals", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/proof-check/domains/source-calls.ts",
      sourceText: 'import { lowerProofMirFunction } from "../proof-mir/lower/function-lowerer";',
    });

    expect(violations.map((violation) => violation.message)).toContain(
      "src/proof-check must not import frontend, lexer, parser, semantic internals, HIR lowering internals, Proof MIR lowering internals, optimization, target backend, linker, PE-COFF, Bun, or filesystem modules.",
    );
  });

  test("proof-check import policy rejects frontend barrel imports", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/proof-check/domains/source-calls.ts",
      sourceText: 'import { parseSource } from "../../frontend";',
    });

    expect(violations.length).toBeGreaterThan(0);
  });

  test("proof-check import policy allows public proof-mir model imports", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/proof-check/domains/source-calls.ts",
      sourceText: 'import type { ProofMirProgram } from "../proof-mir/model/program";',
    });

    expect(violations).toEqual([]);
  });
});

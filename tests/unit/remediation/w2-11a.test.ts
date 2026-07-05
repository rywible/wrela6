import { describe, expect, test } from "bun:test";
import { checkPolicyTextForTest } from "../../../scripts/check-policy";
import { importParsingPolicyFixture } from "../../fixtures/policy/import-parsing";

const proofCheckImportPolicyMessage =
  "src/proof-check must not import frontend, lexer, parser, semantic internals, HIR lowering internals, Proof MIR lowering internals, optimization, target backend, linker, PE-COFF, Bun, or filesystem modules.";

describe("W2-11a policy import parsing", () => {
  test("reports commented multi-line import and re-export module specifiers with source locations", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/proof-check/domains/source-calls.ts",
      sourceText: importParsingPolicyFixture,
    }).filter((violation) => violation.message === proofCheckImportPolicyMessage);

    expect(violations).toEqual([
      {
        filePath: "src/proof-check/domains/source-calls.ts",
        line: 4,
        column: 30,
        message: proofCheckImportPolicyMessage,
      },
    ]);
  });
});

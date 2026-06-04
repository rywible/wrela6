import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { makeLexerHarness } from "../support/lexer-fakes";
import { expectValidLexerResult } from "../support/lexer-invariants";

describe("lexer fuzz invariants", () => {
  test("never throws and preserves source text", () => {
    fastCheck.assert(
      fastCheck.property(fastCheck.string(), (input) => {
        const { lexer, diagnostics, source } = makeLexerHarness("fuzz.wr", input);

        const result = lexer.lex(source);

        expect(result.tokens.eofCount()).toBe(1);
        expect(result.tokens.reconstruct()).toBe(input);
        expectValidLexerResult(source, result.tokens, diagnostics.diagnostics);
      }),
      { numRuns: 5_000, seed: 0x1eaf },
    );
  });
});

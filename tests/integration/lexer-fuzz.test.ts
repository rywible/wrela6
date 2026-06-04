import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { makeLexerHarness } from "../support/lexer-fakes";
import { expectValidLexerResult, expectBalancedLayout } from "../support/lexer-invariants";

describe("lexer fuzz invariants", () => {
  test("never throws and preserves source text for arbitrary strings", () => {
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

  test("preserves source text for code-like patterns", () => {
    const codeLine = fastCheck
      .tuple(
        fastCheck.constantFrom("foo", "bar", "image", "uefi", "fn", "class"),
        fastCheck.constantFrom("", " "),
        fastCheck.constantFrom("x", "name", "value", "Main"),
        fastCheck.constantFrom("", ":"),
      )
      .map(([keyword, space, identifier, punct]) => {
        return `${keyword}${space}${identifier}${punct}\n`;
      });

    fastCheck.assert(
      fastCheck.property(fastCheck.array(codeLine, { minLength: 1, maxLength: 10 }), (lines) => {
        const input = lines.join("");
        const { lexer, diagnostics, source } = makeLexerHarness("fuzz.wr", input);

        const result = lexer.lex(source);

        expect(result.tokens.eofCount()).toBe(1);
        expect(result.tokens.reconstruct()).toBe(input);
        expectBalancedLayout(result.tokens);
        expect(
          diagnostics.diagnostics.every(
            (diagnostic) => diagnostic.span.start >= 0 && diagnostic.span.end <= source.length,
          ),
        ).toBe(true);
      }),
      { numRuns: 1_000, seed: 0x2eaf },
    );
  });

  test("handles comment-heavy content without losing text", () => {
    const commentGenerator = fastCheck.constantFrom("// ", "// comment", "// trailing");
    const contentToken = fastCheck.constantFrom("foo", "main", "value");

    const lineWithComment = fastCheck
      .tuple(
        fastCheck.constantFrom(0, 4).map((indentWidth) => " ".repeat(indentWidth)),
        contentToken,
        fastCheck.constantFrom("", "  "),
        commentGenerator,
        fastCheck.constantFrom("", "\n"),
      )
      .map(([indent, content, space, commentText, newlineChar]) => {
        return `${indent}${content}${space}${commentText}${newlineChar}`;
      });

    fastCheck.assert(
      fastCheck.property(
        fastCheck.array(lineWithComment, { minLength: 1, maxLength: 30 }),
        (lines) => {
          const input = lines.join("");
          const { lexer, source } = makeLexerHarness("fuzz.wr", input);

          const result = lexer.lex(source);

          expect(result.tokens.reconstruct()).toBe(input);
          expect(result.tokens.eofCount()).toBe(1);
        },
      ),
      { numRuns: 1_000, seed: 0x3eaf },
    );
  });

  test("preserves source for string-literal-heavy content", () => {
    const stringContent = fastCheck
      .tuple(
        fastCheck.constantFrom(0, 4).map((indentWidth) => " ".repeat(indentWidth)),
        fastCheck.constantFrom('"hello"', '""', '"a"', '"path"'),
        fastCheck.constantFrom("", "\n"),
      )
      .map(([indent, stringValue, newlineChar]) => `${indent}${stringValue}${newlineChar}`);

    fastCheck.assert(
      fastCheck.property(
        fastCheck.array(stringContent, { minLength: 1, maxLength: 20 }),
        (lines) => {
          const input = lines.join("");
          const { lexer, source } = makeLexerHarness("fuzz.wr", input);

          const result = lexer.lex(source);

          expect(result.tokens.eofCount()).toBe(1);
          expect(result.tokens.reconstruct()).toBe(input);
        },
      ),
      { numRuns: 500, seed: 0x4eaf },
    );
  });

  test("handles deeply nested indentation deterministically", () => {
    const depth = fastCheck.integer({ min: 1, max: 10 });

    fastCheck.assert(
      fastCheck.property(depth, (nestingDepth) => {
        const lines: string[] = [];

        lines.push("image Main:\n");

        for (let index = 0; index < nestingDepth; index++) {
          const indent = " ".repeat((index + 1) * 4);
          lines.push(`${indent}fn level${index}():\n`);
        }

        for (let index = nestingDepth; index >= 0; index--) {
          const indent = " ".repeat(index * 4);
          lines.push(`${indent}x\n`);
        }

        const input = lines.join("");
        const { lexer, source } = makeLexerHarness("fuzz.wr", input);

        const result = lexer.lex(source);

        expect(result.tokens.eofCount()).toBe(1);
        expect(result.tokens.reconstruct()).toBe(input);
        expectBalancedLayout(result.tokens);
      }),
      { numRuns: 100, seed: 0x5eaf },
    );
  });
});

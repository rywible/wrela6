import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import type { LexDiagnostic } from "../../src/lexer/diagnostics";
import type { TokenStream } from "../../src/lexer/token-stream";
import { makeLexerHarness } from "../support/lexer-fakes";
import { expectValidLexerResult, expectBalancedLayout } from "../support/lexer-invariants";

interface TokenSnapshot {
  kind: number;
  lexeme: string;
  span: readonly [number, number];
  leadingTrivia: readonly TriviaSnapshot[];
  trailingTrivia: readonly TriviaSnapshot[];
}

interface TriviaSnapshot {
  kind: number;
  lexeme: string;
  span: readonly [number, number];
}

interface DiagnosticSnapshot {
  code: string;
  severity: string;
  message: string;
  span: readonly [number, number];
}

function snapshotTokens(tokens: TokenStream): TokenSnapshot[] {
  return tokens.items.map((token) => ({
    kind: token.kind,
    lexeme: token.lexeme,
    span: [token.span.start, token.span.end],
    leadingTrivia: token.leadingTrivia.map((trivia) => ({
      kind: trivia.kind,
      lexeme: trivia.lexeme,
      span: [trivia.span.start, trivia.span.end],
    })),
    trailingTrivia: token.trailingTrivia.map((trivia) => ({
      kind: trivia.kind,
      lexeme: trivia.lexeme,
      span: [trivia.span.start, trivia.span.end],
    })),
  }));
}

function snapshotDiagnostics(diagnostics: readonly LexDiagnostic[]): DiagnosticSnapshot[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    span: [diagnostic.span.start, diagnostic.span.end],
  }));
}

function lexSnapshot(input: string): {
  tokens: TokenSnapshot[];
  diagnostics: DiagnosticSnapshot[];
} {
  const { lexer, diagnostics, source } = makeLexerHarness("determinism.wr", input);
  const result = lexer.lex(source);

  return {
    tokens: snapshotTokens(result.tokens),
    diagnostics: snapshotDiagnostics(diagnostics.diagnostics),
  };
}

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

  test("produces identical token and diagnostic snapshots for repeated arbitrary input", () => {
    fastCheck.assert(
      fastCheck.property(fastCheck.string(), (input) => {
        expect(lexSnapshot(input)).toEqual(lexSnapshot(input));
      }),
      { numRuns: 2_000, seed: 0x7eaf },
    );
  });

  test("handles hostile punctuation unicode and control-code mixtures", () => {
    const hostileCharacter = fastCheck.constantFrom(
      "\0",
      "\u0001",
      "\u001f",
      "\u007f",
      "\u2028",
      "\u2029",
      "😀",
      "λ",
      "é",
      "@",
      "#",
      "$",
      "`",
      "'",
      '"',
      "\\",
      "\t",
      "\r",
      "\n",
      " ",
      "/",
      "*",
      "=",
      "!",
      "<",
      ">",
      "-",
      "_",
      "0",
      "a",
      "Z",
    );

    fastCheck.assert(
      fastCheck.property(
        fastCheck.array(hostileCharacter, { minLength: 0, maxLength: 200 }),
        (characters) => {
          const input = characters.join("");
          const { lexer, diagnostics, source } = makeLexerHarness("hostile.wr", input);

          const result = lexer.lex(source);

          expectValidLexerResult(source, result.tokens, diagnostics.diagnostics);
          expect(snapshotTokens(result.tokens)).toEqual(lexSnapshot(input).tokens);
        },
      ),
      { numRuns: 1_500, seed: 0x8eaf },
    );
  });

  test("handles adversarial indentation stacks and tab recovery deterministically", () => {
    const indentationUnit = fastCheck.constantFrom("", " ", "  ", "   ", "    ", "\t", " \t");
    const content = fastCheck.constantFrom(
      "image Main:",
      "fn boot():",
      "let value = 1",
      "// c",
      "",
    );
    const line = fastCheck
      .tuple(indentationUnit, indentationUnit, content, fastCheck.constantFrom("\n", "\r\n", ""))
      .map(([firstIndent, secondIndent, body, newline]) => {
        return `${firstIndent}${secondIndent}${body}${newline}`;
      });

    fastCheck.assert(
      fastCheck.property(fastCheck.array(line, { minLength: 1, maxLength: 80 }), (lines) => {
        const input = lines.join("");
        const firstSnapshot = lexSnapshot(input);
        const secondSnapshot = lexSnapshot(input);

        expect(firstSnapshot).toEqual(secondSnapshot);

        const { lexer, diagnostics, source } = makeLexerHarness("indent-hostile.wr", input);
        const result = lexer.lex(source);
        expectValidLexerResult(source, result.tokens, diagnostics.diagnostics);
      }),
      { numRuns: 1_500, seed: 0x9eaf },
    );
  });
});

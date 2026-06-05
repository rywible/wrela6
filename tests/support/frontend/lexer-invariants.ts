import { expect } from "bun:test";
import { TokenKind } from "../../../src/frontend/lexer/token-kind";
import type { LexDiagnostic } from "../../../src/frontend/lexer/diagnostics";
import type { SourceText } from "../../../src/frontend/lexer/source-text";
import type { TokenStream } from "../../../src/frontend/lexer/token-stream";

export function expectLosslessTokenStream(source: SourceText, tokens: TokenStream): void {
  expect(tokens.reconstruct()).toBe(source.text);
  expect(tokens.eofCount()).toBe(1);
}

export function expectValidTokenSpans(source: SourceText, tokens: TokenStream): void {
  let previousEnd = 0;

  for (const token of tokens.items) {
    expect(token.span.start).toBeGreaterThanOrEqual(previousEnd);
    expect(token.span.end).toBeGreaterThanOrEqual(token.span.start);
    expect(token.span.end).toBeLessThanOrEqual(source.length);

    if (
      token.kind !== TokenKind.Eof &&
      token.kind !== TokenKind.Indent &&
      token.kind !== TokenKind.Dedent
    ) {
      expect(token.span.end).toBeGreaterThan(token.span.start);
    }

    for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
      expect(trivia.span.start).toBeGreaterThanOrEqual(0);
      expect(trivia.span.end).toBeGreaterThanOrEqual(trivia.span.start);
      expect(trivia.span.end).toBeLessThanOrEqual(source.length);
    }

    previousEnd = token.span.end;
  }
}

export function expectDiagnosticsInBounds(
  source: SourceText,
  diagnostics: readonly LexDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    expect(diagnostic.source).toBe(source);
    expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
    expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
  }
}

export function expectBalancedLayout(tokens: TokenStream): void {
  let depth = 0;

  for (const token of tokens.items) {
    if (token.kind === TokenKind.Indent) {
      depth += 1;
    }

    if (token.kind === TokenKind.Dedent) {
      depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }

  expect(depth).toBe(0);
}

export function expectValidLexerResult(
  source: SourceText,
  tokens: TokenStream,
  diagnostics: readonly LexDiagnostic[],
): void {
  expectLosslessTokenStream(source, tokens);
  expectValidTokenSpans(source, tokens);
  expectDiagnosticsInBounds(source, diagnostics);
  expectBalancedLayout(tokens);
}

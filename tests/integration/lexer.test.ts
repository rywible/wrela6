import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { Lexer } from "../../src/lexer/lexer";
import { SourceText } from "../../src/lexer/source-text";
import { TokenKind } from "../../src/lexer/token-kind";

function createLexer(): Lexer {
  const diagnostics = new CollectingDiagnosticSink();
  return new Lexer({ keywords: KeywordTable.default(), diagnostics });
}

function lex(source: SourceText): ReturnType<Lexer["lex"]> {
  return createLexer().lex(source);
}

describe("Lexer", () => {
  test("lexes empty source as EOF", () => {
    const result = lex(SourceText.from("empty.wr", ""));

    expect(result.tokens.kinds()).toEqual([TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe("");
  });

  test("whitespace-only source emits newline tokens and reconstructs", () => {
    const result = lex(SourceText.from("blank-lines.wr", "\n\n"));

    expect(result.tokens.kinds()).toEqual([TokenKind.Newline, TokenKind.Newline, TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe("\n\n");
  });

  test("single character content emits Invalid token", () => {
    const result = lex(SourceText.from("single.wr", "a"));

    expect(result.tokens.kinds()).toEqual([TokenKind.Invalid, TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe("a");
  });

  test("line comments are preserved as trivia and reconstruction matches", () => {
    const result = lex(SourceText.from("comments.wr", "// top\n// next\r\n"));

    expect(result.tokens.eofCount()).toBe(1);
    expect(result.tokens.reconstruct()).toBe("// top\n// next\r\n");
  });

  test("consecutive blank lines emit consecutive Newline tokens", () => {
    const result = lex(SourceText.from("consecutive.wr", "\n\n\n"));

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Newline,
      TokenKind.Newline,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe("\n\n\n");
  });

  test("both \\n and \\r\\n newline styles work", () => {
    const result = lex(SourceText.from("mixed.wr", "a\nb\r\nc"));

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Invalid,
      TokenKind.Newline,
      TokenKind.Invalid,
      TokenKind.Newline,
      TokenKind.Invalid,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe("a\nb\r\nc");
  });

  test("comments before content become leading trivia", () => {
    const result = lex(SourceText.from("leading-comment.wr", "// header\na"));

    const tokens = result.tokens.items;
    expect(tokens[0]!.kind).toBe(TokenKind.Newline);
    expect(tokens[0]!.leadingTrivia.length).toBe(1);
    expect(result.tokens.kinds()).toEqual([TokenKind.Newline, TokenKind.Invalid, TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe("// header\na");
  });

  test("comments after content on same line become trailing trivia", () => {
    const result = lex(SourceText.from("trailing-comment.wr", "a// comment\n"));

    const tokens = result.tokens.items;
    expect(tokens[0]!.kind).toBe(TokenKind.Invalid);
    expect(tokens[0]!.trailingTrivia.length).toBe(1);
    expect(result.tokens.reconstruct()).toBe("a// comment\n");
  });

  test("diagnostics array is empty for whitespace and comment-only input", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    lexer.lex(SourceText.from("clean.wr", "  // comment\n\n// done"));

    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("reconstructs exactly matching source for complex input", () => {
    const text = "  leading\n  content  // trailing\n\n// alone\n";
    const result = lex(SourceText.from("complex.wr", text));

    expect(result.tokens.reconstruct()).toBe(text);
  });
});

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
      TokenKind.Identifier,
      TokenKind.Newline,
      TokenKind.Identifier,
      TokenKind.Newline,
      TokenKind.Identifier,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe("a\nb\r\nc");
  });

  test("comments before content become leading trivia", () => {
    const result = lex(SourceText.from("leading-comment.wr", "// header\na"));

    const tokens = result.tokens.items;
    expect(tokens[0]!.kind).toBe(TokenKind.Newline);
    expect(tokens[0]!.leadingTrivia.length).toBe(1);
    expect(result.tokens.reconstruct()).toBe("// header\na");
  });

  test("comments after content on same line become trailing trivia", () => {
    const result = lex(SourceText.from("trailing-comment.wr", "a// comment\n"));

    const tokens = result.tokens.items;
    expect(tokens[0]!.kind).toBe(TokenKind.Identifier);
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

  test("lexes identifiers and injected keywords", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("main.wr", "uefi image HelloWorld:\n");

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Uefi,
      TokenKind.Image,
      TokenKind.Identifier,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("lexes punctuation and compound operators", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("operators.wr", "(a) -> b => c == d != e <= f >= g ?\n");

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.LeftParen,
      TokenKind.Identifier,
      TokenKind.RightParen,
      TokenKind.Arrow,
      TokenKind.Identifier,
      TokenKind.FatArrow,
      TokenKind.Identifier,
      TokenKind.EqualsEquals,
      TokenKind.Identifier,
      TokenKind.BangEquals,
      TokenKind.Identifier,
      TokenKind.LessEquals,
      TokenKind.Identifier,
      TokenKind.GreaterEquals,
      TokenKind.Identifier,
      TokenKind.Question,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
  });

  test("lexes integer and string literals", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("literals.wr", 'name="nic0" max=9000\n');

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Identifier,
      TokenKind.Equals,
      TokenKind.StringLiteral,
      TokenKind.Identifier,
      TokenKind.Equals,
      TokenKind.IntegerLiteral,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("recovers from invalid characters", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("bad.wr", "image @ Main\n");

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toContain(TokenKind.Invalid);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics.map((d) => d.code)).toContain("LEX_INVALID_CHARACTER");
  });

  test("emits indentation layout tokens", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from(
      "layout.wr",
      "image Main:\n    fn boot():\n        loop:\n    fn stop():\n",
    );

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Image,
      TokenKind.Identifier,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Indent,
      TokenKind.Fn,
      TokenKind.Identifier,
      TokenKind.LeftParen,
      TokenKind.RightParen,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Indent,
      TokenKind.Loop,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Dedent,
      TokenKind.Fn,
      TokenKind.Identifier,
      TokenKind.LeftParen,
      TokenKind.RightParen,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Dedent,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("reports inconsistent indentation", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("bad-indent.wr", "image Main:\n    a\n  b\n");

    const result = lexer.lex(source);

    expect(result.tokens.eofCount()).toBe(1);
    expect(result.tokens.kinds()).toEqual([
      TokenKind.Image,
      TokenKind.Identifier,
      TokenKind.Colon,
      TokenKind.Newline,
      TokenKind.Indent,
      TokenKind.Identifier,
      TokenKind.Newline,
      TokenKind.Dedent,
      TokenKind.Identifier,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics.map((d) => d.code)).toContain("LEX_INCONSISTENT_INDENT");
  });

  test("lexes all punctuation in isolation", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("punct.wr", "(){}[]:,.=+-*/%<>\n");

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.LeftParen,
      TokenKind.RightParen,
      TokenKind.LeftBrace,
      TokenKind.RightBrace,
      TokenKind.LeftBracket,
      TokenKind.RightBracket,
      TokenKind.Colon,
      TokenKind.Comma,
      TokenKind.Dot,
      TokenKind.Equals,
      TokenKind.Plus,
      TokenKind.Minus,
      TokenKind.Star,
      TokenKind.Slash,
      TokenKind.Percent,
      TokenKind.Less,
      TokenKind.Greater,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
  });

  test("handles unterminated string at newline", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("unterm.wr", '"hello\nworld"\n');

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.StringLiteral,
      TokenKind.Newline,
      TokenKind.Identifier,
      TokenKind.StringLiteral,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
    expect(diagnostics.diagnostics.map((d) => d.code)).toContain("LEX_UNTERMINATED_STRING");
  });
});

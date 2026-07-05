import { describe, expect, test } from "bun:test";
import { Parser } from "../../../../src/frontend/parser/parser";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";

function makeToken(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

describe("Parser", () => {
  test("empty source produces SourceFile with only EOF", () => {
    const source = SourceText.from("test.wr", "");
    const tokens = TokenStream.from([makeToken(TokenKind.Eof, "", 0, 0)]);
    const parser = new Parser();
    const result = parser.parse({ source, tokens });

    expect(result.source).toBe(source);
    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe("");
    expect(result.parserDiagnostics).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("source with only newlines preserves them as direct children", () => {
    const source = SourceText.from("test.wr", "\n\n");
    const tokens = TokenStream.from([
      makeToken(TokenKind.Newline, "\n", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ]);
    const parser = new Parser();
    const result = parser.parse({ source, tokens });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe("\n\n");
    expect(result.parserDiagnostics).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("identifier becomes top-level declaration error", () => {
    const source = SourceText.from("test.wr", "hello");
    const tokens = TokenStream.from([
      makeToken(TokenKind.Identifier, "hello", 0, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ]);
    const parser = new Parser();
    const result = parser.parse({ source, tokens });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe("hello");

    const children = result.tree.root().children();
    expect(children[0]!.kind).toBe(SyntaxKind.ErrorNode);
    expect(children[1]!.kind).toBe(SyntaxKind.EndOfFileToken);

    expect(result.parserDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
    ]);
    expect(result.parserDiagnostics[0]?.ownerKey).toBe("parser:top-level-declaration");
    expect(result.parserDiagnostics[0]?.stableDetail).toBe(
      "PARSE_EXPECTED_TOP_LEVEL_DECLARATION:test.wr:0:5",
    );
  });

  test("parseLexResult delegates to parse", () => {
    const source = SourceText.from("test.wr", "");
    const lexResult = {
      source,
      tokens: TokenStream.from([makeToken(TokenKind.Eof, "", 0, 0)]),
    };
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.source).toBe(source);
    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe("");
  });

  test("EOF is consumed exactly once as EndOfFileToken", () => {
    const source = SourceText.from("test.wr", "");
    const tokens = TokenStream.from([makeToken(TokenKind.Eof, "", 0, 0)]);
    const parser = new Parser();
    const result = parser.parse({ source, tokens });

    const children = result.tree.root().children();
    const eofChildren = children.filter((child) => child.kind === SyntaxKind.EndOfFileToken);
    expect(eofChildren.length).toBe(1);
  });

  test("top-level non-declarations separated by newlines recover independently", () => {
    const source = SourceText.from("test.wr", "hello\nworld\n");
    const tokens = TokenStream.from([
      makeToken(TokenKind.Identifier, "hello", 0, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Identifier, "world", 6, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ]);
    const parser = new Parser();
    const result = parser.parse({ source, tokens });

    expect(result.tree.reconstruct()).toBe("hello\nworld\n");

    const root = result.tree.root();
    const children = root.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ErrorNode);
    expect(children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(children[2]!.kind).toBe(SyntaxKind.ErrorNode);
    expect(children[3]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(children[4]!.kind).toBe(SyntaxKind.EndOfFileToken);
    expect(result.parserDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
      "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
    ]);
  });

  test("parser options - maxDepth", () => {
    const source = SourceText.from("test.wr", "");
    const tokens = TokenStream.from([makeToken(TokenKind.Eof, "", 0, 0)]);
    const parser = new Parser({ maxDepth: 10 });
    const result = parser.parse({ source, tokens });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
  });

  test("maxDepth zero still recovers top-level non-declarations", () => {
    const source = SourceText.from("test.wr", "hello");
    const tokens = TokenStream.from([
      makeToken(TokenKind.Identifier, "hello", 0, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ]);
    const parser = new Parser({ maxDepth: 0 });
    const result = parser.parse({ source, tokens });

    expect(result.tree.reconstruct()).toBe("hello");
    expect(result.tree.root().children()[0]!.kind).toBe(SyntaxKind.ErrorNode);
  });
});

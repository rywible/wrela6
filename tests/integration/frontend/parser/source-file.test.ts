import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";

function createLexer(): Lexer {
  return new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
}

describe("SourceFile parsing (integration)", () => {
  test("empty source parses to SourceFile containing EOF and reconstructs exactly", () => {
    const source = SourceText.from("empty.wr", "");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.source).toBe(source);
    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);
  });

  test("top-level newlines are preserved as syntax tokens", () => {
    const source = SourceText.from("newlines.wr", "\n\n\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);

    const children = result.tree.root().children();
    expect(children.length).toBe(4);
    expect(children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(children[2]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(children[3]!.kind).toBe(SyntaxKind.EndOfFileToken);
  });

  test("identifier token becomes ExpressionStatement", () => {
    const source = SourceText.from("unknown.wr", "hello");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);

    const children = result.tree.root().children();
    expect(children[0]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[1]!.kind).toBe(SyntaxKind.EndOfFileToken);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("EOF is consumed exactly once as EndOfFileToken", () => {
    const source = SourceText.from("eof.wr", "");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    const children = result.tree.root().children();
    const eofChildren = children.filter((child) => child.kind === SyntaxKind.EndOfFileToken);
    expect(eofChildren.length).toBe(1);
  });

  test("parseLexResult uses lexResult.source and lexResult.tokens", () => {
    const source = SourceText.from("test.wr", "foo\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.source).toBe(source);
    expect(result.tree.reconstruct()).toBe(source.text);
  });

  test("reconstruction round-trips for text with identifiers and newlines", () => {
    const source = SourceText.from("mixed.wr", "leading\ncontent\n\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
  });

  test("source with comment-only lines round-trips", () => {
    const source = SourceText.from("comments.wr", "// comment\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
  });
});

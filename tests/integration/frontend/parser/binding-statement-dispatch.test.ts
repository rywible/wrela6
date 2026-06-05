import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import type { RedNode } from "../../../../src/frontend/syntax/red-node";

function createLexer(): Lexer {
  return new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
}

describe("Binding statement dispatch (integration)", () => {
  test("let statement round-trips", () => {
    const source = SourceText.from("test.wr", "let x = 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.LetStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Pattern);
    expect(children[2]!.kind).toBe(SyntaxKind.EqualsToken);
    expect(children[3]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(children[4]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("let with type annotation round-trips", () => {
    const source = SourceText.from("test.wr", "let x: Int = 5\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.LetStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Pattern);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.TypeReference);
    expect(children[4]!.kind).toBe(SyntaxKind.EqualsToken);
    expect(children[5]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(children[6]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("return with expression round-trips", () => {
    const source = SourceText.from("test.wr", "return 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ReturnStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ReturnKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("return without expression round-trips", () => {
    const source = SourceText.from("test.wr", "return\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ReturnStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ReturnKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("yield with expression round-trips", () => {
    const source = SourceText.from("test.wr", "yield value\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.YieldStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.YieldKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("continue round-trips", () => {
    const source = SourceText.from("test.wr", "continue\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ContinueStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ContinueKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("loop with block round-trips", () => {
    const source = SourceText.from("test.wr", "loop:\n    x\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.LoopStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.LoopKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[2]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("multiple binding statements in source file", () => {
    const source = SourceText.from("test.wr", "let x = 1\nreturn x\ncontinue\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.children()[0]!.kind).toBe(SyntaxKind.LetStatement);
    expect(root.children()[1]!.kind).toBe(SyntaxKind.ReturnStatement);
    expect(root.children()[2]!.kind).toBe(SyntaxKind.ContinueStatement);
    expect(root.children()[3]!.kind).toBe(SyntaxKind.EndOfFileToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

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

describe("Control statement dispatch (integration)", () => {
  test("if statement round-trips", () => {
    const source = SourceText.from("test.wr", "if x:\n    y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.IfStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("if/else block round-trips", () => {
    const source = SourceText.from("test.wr", "if x:\n    y\nelse:\n    z\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.IfStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);
    expect(children[4]!.kind).toBe(SyntaxKind.ElseClause);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("while statement round-trips", () => {
    const source = SourceText.from("test.wr", "while x:\n    y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.WhileStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.WhileKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("for statement round-trips", () => {
    const source = SourceText.from("test.wr", "for x in items:\n    y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ForStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ForKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Pattern);
    expect(children[2]!.kind).toBe(SyntaxKind.InKeyword);
    expect(children[3]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[5]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("take with as clause round-trips", () => {
    const source = SourceText.from("test.wr", "take value as x:\n    y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.TakeStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.AsKeyword);
    expect(children[3]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[5]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("take without as clause round-trips", () => {
    const source = SourceText.from("test.wr", "take value:\n    y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.TakeStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("multiple control statements in source file", () => {
    const source = SourceText.from("test.wr", "if x:\n    y\nwhile z:\n    w\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.children()[0]!.kind).toBe(SyntaxKind.IfStatement);
    expect(root.children()[1]!.kind).toBe(SyntaxKind.WhileStatement);
    expect(root.children()[2]!.kind).toBe(SyntaxKind.EndOfFileToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

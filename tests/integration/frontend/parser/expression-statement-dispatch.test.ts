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

describe("Expression statement dispatch (integration)", () => {
  test("identifier expression statement round-trips", () => {
    const source = SourceText.from("test.wr", "x\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const children = root.children();
    expect(children.length).toBe(2);
    expect(children[0]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[1]!.kind).toBe(SyntaxKind.EndOfFileToken);

    const stmt = children[0] as RedNode;
    const stmtChildren = stmt.children();
    expect(stmtChildren).toHaveLength(2);
    expect(stmtChildren[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(stmtChildren[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("assignment statement in top-level source", () => {
    const source = SourceText.from("test.wr", "x = 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const children = root.children();
    expect(children[0]!.kind).toBe(SyntaxKind.AssignmentStatement);

    const stmt = children[0] as RedNode;
    const stmtChildren = stmt.children();
    expect(stmtChildren).toHaveLength(4);
    expect(stmtChildren[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(stmtChildren[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect(stmtChildren[2]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(stmtChildren[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("assignment and expression statements at top level", () => {
    const source = SourceText.from("test.wr", "a = 1\nb\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const children = root.children();
    expect(children).toHaveLength(3);
    expect(children[0]!.kind).toBe(SyntaxKind.AssignmentStatement);
    expect(children[1]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[2]!.kind).toBe(SyntaxKind.EndOfFileToken);

    const assign = children[0] as RedNode;
    expect(assign.children()[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(assign.children()[2]!.kind).toBe(SyntaxKind.LiteralExpression);

    const expr = children[1] as RedNode;
    expect(expr.children()[0]!.kind).toBe(SyntaxKind.NameExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("call expression as statement round-trips", () => {
    const source = SourceText.from("test.wr", "foo()\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ExpressionStatement);

    const expr = stmt.children()[0] as RedNode;
    expect(expr.kind).toBe(SyntaxKind.CallExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("comparison (==) does not trigger assignment", () => {
    const source = SourceText.from("test.wr", "x == 5\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.ExpressionStatement);

    const expr = stmt.children()[0] as RedNode;
    expect(expr.kind).toBe(SyntaxKind.EqualityExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("member assignment round-trips", () => {
    const source = SourceText.from("test.wr", "obj.field = 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const stmt = root.children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.AssignmentStatement);

    const target = stmt.children()[0] as RedNode;
    expect(target.kind).toBe(SyntaxKind.MemberAccessExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("source preservation across multiple expression statements", () => {
    const source = SourceText.from("test.wr", "x\ny\nz\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const children = result.tree.root().children();
    expect(children.length).toBe(4);
    expect(children[0]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[1]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[2]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(children[3]!.kind).toBe(SyntaxKind.EndOfFileToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("identifier followed by assignment at top level is not an error", () => {
    const source = SourceText.from("test.wr", "counter = counter + 1\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = result.tree.root().children()[0] as RedNode;
    expect(stmt.kind).toBe(SyntaxKind.AssignmentStatement);

    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

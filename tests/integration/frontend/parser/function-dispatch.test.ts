import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { RedNode } from "../../../../src/frontend/syntax/red-node";

function createLexer(): Lexer {
  return new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
}

describe("Function declaration parsing (integration)", () => {
  test("parses bodyless function and reconstructs", () => {
    const source = SourceText.from("test.wr", "fn foo()\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const fnDecl = result.tree.root().child(0);
    expect(fnDecl).toBeDefined();
    expect(fnDecl!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses function with block body and reconstructs", () => {
    const source = SourceText.from("test.wr", "fn foo():\n    1\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const fnDecl = result.tree.root().child(0);
    expect(fnDecl).toBeDefined();
    expect(fnDecl!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (fnDecl as RedNode).child(3);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);
  });

  test("parses function with requires section and body, reconstructs", () => {
    const source = SourceText.from(
      "test.wr",
      "fn foo(x: Int):\n    requires:\n        x > 0\n    x\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const fnDecl = result.tree.root().child(0);
    expect(fnDecl).toBeDefined();
    expect(fnDecl!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (fnDecl as RedNode).child(3);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);

    const stmtList = (block as RedNode).child(3) as RedNode;
    expect(stmtList).toBeDefined();
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.child(0)!.kind).toBe(SyntaxKind.RequiresSection);
    expect(stmtList.child(1)!.kind).toBe(SyntaxKind.ExpressionStatement);
  });

  test("parses function with requires section only, reconstructs", () => {
    const source = SourceText.from("test.wr", "fn foo():\n    requires:\n        x > 0\n\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const fnDecl = result.tree.root().child(0);
    expect(fnDecl).toBeDefined();
    expect(fnDecl!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses fn declaration between other declarations in source file", () => {
    const source = SourceText.from(
      "test.wr",
      "enum Foo:\n    bar\n\nfn hello():\n    42\n\nuse std from io\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

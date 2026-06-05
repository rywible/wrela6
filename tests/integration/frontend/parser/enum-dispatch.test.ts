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

describe("Enum declaration parsing (integration)", () => {
  test("parses enum with single case and reconstructs", () => {
    const source = SourceText.from("test.wr", "enum Foo:\n    bar\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const enumDecl = result.tree.root().child(0);
    expect(enumDecl).toBeDefined();
    expect(enumDecl!.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses enum with multiple cases and reconstructs", () => {
    const source = SourceText.from("test.wr", "enum Color:\n    red\n    green\n    blue\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const enumDecl = result.tree.root().child(0);
    expect(enumDecl).toBeDefined();
    expect(enumDecl!.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (enumDecl as RedNode).child(3);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);

    const stmtList = (block as RedNode).child(2);
    expect(stmtList).toBeDefined();
    expect(stmtList!.kind).toBe(SyntaxKind.StatementList);
  });
});

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

describe("Validated buffer declaration parsing (integration)", () => {
  function getSection(vbDecl: RedNode, sectionIndex: number): RedNode {
    const block = vbDecl.child(4) as RedNode;
    const stmtList = block.child(2) as RedNode;
    return stmtList.child(sectionIndex) as RedNode;
  }

  test("parses validated buffer with params and layout", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        field1: U8\n    layout:\n        field1: U8 @ 0\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0);
    expect(vbDecl).toBeDefined();
    expect(vbDecl!.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses validated buffer with only params", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        x: U8\n        y: U16\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0) as RedNode;
    expect(vbDecl).toBeDefined();
    expect(vbDecl.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const paramsSection = getSection(vbDecl, 0);
    expect(paramsSection).toBeDefined();
    expect(paramsSection.kind).toBe(SyntaxKind.ParamsSection);
  });

  test("parses validated buffer with layout field using len", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    layout:\n        data: U8 @ 0 len 4\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0) as RedNode;
    expect(vbDecl).toBeDefined();
    expect(vbDecl.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const layoutSection = getSection(vbDecl, 0);
    expect(layoutSection).toBeDefined();
    expect(layoutSection.kind).toBe(SyntaxKind.LayoutSection);
  });

  test("produces no diagnostics for valid input", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        field1: U8\n    layout:\n        field1: U8 @ 0\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.diagnostics).toHaveLength(0);
  });
});

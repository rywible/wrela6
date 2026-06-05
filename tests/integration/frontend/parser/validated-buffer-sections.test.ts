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

describe("Validated buffer sections parsing (integration)", () => {
  function getSection(vbDecl: RedNode, sectionIndex: number): RedNode {
    const block = vbDecl.child(4) as RedNode;
    const stmtList = block.child(2) as RedNode;
    return stmtList.child(sectionIndex) as RedNode;
  }

  test("parses validated buffer with derive section", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        kind: U8\n    layout:\n        kind: U8 @ 0\n    derive:\n        checksum: U16 from 0:\n            0 => PacketKind.ping\n            otherwise => 1\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0) as RedNode;
    expect(vbDecl).toBeDefined();
    expect(vbDecl.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const deriveSection = getSection(vbDecl, 2);
    expect(deriveSection).toBeDefined();
    expect(deriveSection.kind).toBe(SyntaxKind.DeriveSection);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses validated buffer with require section", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        x: U8\n    layout:\n        x: U8 @ 0\n    require:\n        x < 10\n        x > 0 else 1\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0) as RedNode;
    expect(vbDecl).toBeDefined();
    expect(vbDecl.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const requireSection = getSection(vbDecl, 2);
    expect(requireSection).toBeDefined();
    expect(requireSection.kind).toBe(SyntaxKind.RequireSection);

    const requireBlock = requireSection.child(2) as RedNode;
    expect(requireBlock).toBeDefined();
    expect(requireBlock.kind).toBe(SyntaxKind.Block);

    const stmtList = requireBlock.child(2) as RedNode;
    const req0 = stmtList.child(0) as RedNode;
    expect(req0).toBeDefined();
    expect(req0.kind).toBe(SyntaxKind.Requirement);

    const req1 = stmtList.child(1) as RedNode;
    expect(req1).toBeDefined();
    expect(req1.kind).toBe(SyntaxKind.Requirement);

    const req1Expr = req1.child(0) as RedNode;
    expect(req1Expr).toBeDefined();
    expect(req1Expr.kind).toBe(SyntaxKind.ElseRequirementExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses validated buffer with all sections (params, layout, derive, require)", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        kind: U8\n    layout:\n        kind: U8 @ 0\n    derive:\n        checksum: U16 from 0:\n            0 => 1\n    require:\n        kind == 0\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const vbDecl = result.tree.root().child(0) as RedNode;
    expect(vbDecl).toBeDefined();
    expect(vbDecl.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const paramsSection = getSection(vbDecl, 0);
    expect(paramsSection).toBeDefined();
    expect(paramsSection.kind).toBe(SyntaxKind.ParamsSection);

    const layoutSection = getSection(vbDecl, 1);
    expect(layoutSection).toBeDefined();
    expect(layoutSection.kind).toBe(SyntaxKind.LayoutSection);

    const deriveSection = getSection(vbDecl, 2);
    expect(deriveSection).toBeDefined();
    expect(deriveSection.kind).toBe(SyntaxKind.DeriveSection);

    const requireSection = getSection(vbDecl, 3);
    expect(requireSection).toBeDefined();
    expect(requireSection.kind).toBe(SyntaxKind.RequireSection);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("produces no diagnostics for valid input with all sections", () => {
    const source = SourceText.from(
      "test.wr",
      "validated buffer Packet:\n    params:\n        kind: U8\n    layout:\n        kind: U8 @ 0\n    derive:\n        checksum: U16 from 0:\n            0 => PacketKind.ping\n            otherwise => 1\n    require:\n        x < 10\n        y > 0 else 0\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.diagnostics).toHaveLength(0);
  });
});

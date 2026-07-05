import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  SourceSpan,
  SourceText,
  SyntaxKind,
} from "../../../../src/frontend";
import { Lexer, KeywordTable } from "../../../../src/frontend/lexer";
import { Parser } from "../../../../src/frontend/parser";
import { buildSyntaxIndex, syntaxNodeId, syntaxTokenId } from "../../../../src/frontend/syntax";

function parseTree(sourceCode: string) {
  const source = SourceText.from("syntax-index-test.wr", sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  return new Parser().parseLexResult({ lexResult: lexer.lex(source) }).tree;
}

describe("SyntaxIndex", () => {
  test("finds the smallest nested node containing a span", () => {
    const sourceCode = "class Box:\n    field: U8\n";
    const tree = parseTree(sourceCode);
    const index = buildSyntaxIndex(tree);
    const typeStart = sourceCode.indexOf("U8");

    const node = index.findSmallestNodeContainingSpan(SourceSpan.from(typeStart, typeStart + 2));

    expect(node?.kind).toBe(SyntaxKind.TypeReference);
  });

  test("looks up direct children through stable child ids", () => {
    const tree = parseTree("class Box:\n    field: U8\n");
    const index = tree.index();
    const root = tree.root();
    const firstChildId = index.childIdsFor(root)[0]!;
    const firstChild = index.getElement(firstChildId);

    expect(index.getNode(syntaxNodeId(root))).toBe(root);
    expect(firstChild?.kind).toBe(SyntaxKind.ClassDeclaration);
    expect(index.parentIdFor(firstChildId)).toBe(syntaxNodeId(root));
  });

  test("finds tokens at offsets including EOF", () => {
    const tree = parseTree("fn main()\n");
    const index = buildSyntaxIndex(tree);

    expect(index.findTokenAtOffset(0)?.kind).toBe(SyntaxKind.FnKeyword);
    expect(index.findTokenAtOffset(10)?.kind).toBe(SyntaxKind.EndOfFileToken);
  });

  test("anchors zero-width spans to a stable token id", () => {
    const tree = parseTree("fn main()\n");
    const index = buildSyntaxIndex(tree);

    const anchor = index.anchorForSpan(SourceSpan.from(10, 10));
    const eof = index.findTokenAtOffset(10)!;

    expect(anchor?.id).toBe(syntaxTokenId(eof));
  });

  test("anchors overlapping spans to the smallest containing node", () => {
    const sourceCode = "class Box:\n    field: U8\n";
    const tree = parseTree(sourceCode);
    const index = buildSyntaxIndex(tree);
    const typeStart = sourceCode.indexOf("U8");

    const anchor = index.anchorForSpan(SourceSpan.from(typeStart, typeStart + 2));
    const node = index.getElement(anchor!.id);

    expect(node?.kind).toBe(SyntaxKind.TypeReference);
  });
});

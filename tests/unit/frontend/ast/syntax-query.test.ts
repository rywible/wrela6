import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink, SourceText, SyntaxKind } from "../../../../src/frontend";
import { Parser } from "../../../../src/frontend/parser";
import { Lexer, KeywordTable } from "../../../../src/frontend/lexer";
import {
  blockItems,
  blockStatementList,
  childNode,
  childNodes,
  childToken,
  childTokens,
  descendants,
  presentTokenText,
} from "../../../../src/frontend/ast/syntax-query";
import { RedNode } from "../../../../src/frontend/syntax";

function parseRoot(sourceCode: string): RedNode {
  const source = SourceText.from("query-test.wr", sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  return parser.parseLexResult({ lexResult: lexer.lex(source) }).tree.root();
}

describe("syntax query helpers", () => {
  test("direct child helpers do not cross nested scopes", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;

    expect(classNode).toBeDefined();
    expect(childNode(classNode, SyntaxKind.FieldDeclaration)).toBeUndefined();
    expect(descendants(classNode, SyntaxKind.FieldDeclaration)).toHaveLength(1);
  });

  test("blockItems returns direct statement-list node items", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;
    const block = childNode(classNode, SyntaxKind.Block)!;

    expect(blockStatementList(block)!.kind).toBe(SyntaxKind.StatementList);
    expect(blockItems(block).map((node) => node.kind)).toEqual([SyntaxKind.FieldDeclaration]);
  });

  test("presentTokenText returns bare lexeme without trivia", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const field = descendants(root, SyntaxKind.FieldDeclaration)[0]!;
    const token = childToken(field, SyntaxKind.IdentifierToken)!;

    expect(presentTokenText(token)).toBe("field");
    expect(presentTokenText(undefined)).toBeUndefined();
  });

  test("childNodes returns multiple matches", () => {
    const root = parseRoot("class A:\n    field: U8\nclass B:\n    field: U8\n");
    expect(childNodes(root, SyntaxKind.ClassDeclaration)).toHaveLength(2);
  });

  test("childTokens returns token children", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;
    const tokens = childTokens(classNode, SyntaxKind.IdentifierToken);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  test("blockItems returns empty array for malformed block", () => {
    const root = parseRoot("class Box\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration);
    if (classNode) {
      const block = childNode(classNode, SyntaxKind.Block);
      if (block) {
        expect(blockItems(block)).toEqual([]);
      }
    }
  });
});

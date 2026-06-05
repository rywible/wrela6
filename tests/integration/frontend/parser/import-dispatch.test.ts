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

describe("Import declaration dispatch (integration)", () => {
  test("parses single import from identifier module", () => {
    const source = SourceText.from("test.wr", "use Foo from bar\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const children = root.children();
    expect(children.length).toBe(2);
    expect(children[0]!.kind).toBe(SyntaxKind.ImportDeclaration);
    expect(children[1]!.kind).toBe(SyntaxKind.EndOfFileToken);

    const importDecl = children[0] as RedNode;
    const importChildren = importDecl.children();
    expect(importChildren).toHaveLength(5);
    expect(importChildren[0]!.kind).toBe(SyntaxKind.UseKeyword);
    expect(importChildren[1]!.kind).toBe(SyntaxKind.ImportNameList);
    expect(importChildren[2]!.kind).toBe(SyntaxKind.FromKeyword);
    expect(importChildren[3]!.kind).toBe(SyntaxKind.DottedModuleName);
    expect(importChildren[4]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses multiple imports with commas", () => {
    const source = SourceText.from("test.wr", "use Foo, Bar from baz\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const importDecl = root.children()[0] as RedNode;
    expect(importDecl.kind).toBe(SyntaxKind.ImportDeclaration);

    const importChildren = importDecl.children();
    const names = importChildren[1] as RedNode;
    expect(names.kind).toBe(SyntaxKind.ImportNameList);
    expect(names.children()).toHaveLength(3);
    expect(names.children()[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(names.children()[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect(names.children()[2]!.kind).toBe(SyntaxKind.IdentifierToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses import with keyword module segment", () => {
    const source = SourceText.from("test.wr", "use Foo from core.uefi\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const importDecl = root.children()[0] as RedNode;
    expect(importDecl.kind).toBe(SyntaxKind.ImportDeclaration);

    const importChildren = importDecl.children();
    const module = importChildren[3] as RedNode;
    expect(module.kind).toBe(SyntaxKind.DottedModuleName);
    expect(module.children()).toHaveLength(3);
    expect(module.children()[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(module.children()[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(module.children()[2]!.kind).toBe(SyntaxKind.UefiKeyword);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("reports diagnostic for missing import name", () => {
    const source = SourceText.from("test.wr", "use from bar\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);
    expect(result.parserDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

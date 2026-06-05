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

describe("Class declaration dispatch (integration)", () => {
  test("parses dataclass with fields and reconstructs", () => {
    const source = SourceText.from(
      "test.wr",
      "dataclass PacketLimits:\n    max_size: u64\n    min_size: u64\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const dataclassDecl = result.tree.root().child(0);
    expect(dataclassDecl).toBeDefined();
    expect(dataclassDecl!.kind).toBe(SyntaxKind.DataclassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses class with fields and reconstructs", () => {
    const source = SourceText.from("test.wr", "class MyClass:\n    field: u8\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const classDecl = result.tree.root().child(0);
    expect(classDecl).toBeDefined();
    expect(classDecl!.kind).toBe(SyntaxKind.ClassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (classDecl as RedNode).child(3);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);

    const stmtList = (block as RedNode).child(2);
    expect(stmtList).toBeDefined();
    expect(stmtList!.kind).toBe(SyntaxKind.StatementList);

    const field = (stmtList as RedNode).child(0);
    expect(field).toBeDefined();
    expect(field!.kind).toBe(SyntaxKind.FieldDeclaration);
  });

  test("parses class with type parameters", () => {
    const source = SourceText.from("test.wr", "class Container[T]:\n    item: T\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const classDecl = result.tree.root().child(0) as RedNode;
    expect(classDecl.kind).toBe(SyntaxKind.ClassDeclaration);
    const typeParamList = classDecl.child(2);
    expect(typeParamList).toBeDefined();
    expect(typeParamList!.kind).toBe(SyntaxKind.TypeParameterList);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses interface with bodyless function and reconstructs", () => {
    const source = SourceText.from("test.wr", "interface Runnable:\n    fn run() -> Result\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const interfaceDecl = result.tree.root().child(0);
    expect(interfaceDecl).toBeDefined();
    expect(interfaceDecl!.kind).toBe(SyntaxKind.InterfaceDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (interfaceDecl as RedNode).child(3);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);

    const stmtList = (block as RedNode).child(2);
    expect(stmtList).toBeDefined();
    expect(stmtList!.kind).toBe(SyntaxKind.StatementList);

    const funcDecl = (stmtList as RedNode).child(0);
    expect(funcDecl).toBeDefined();
    expect(funcDecl!.kind).toBe(SyntaxKind.FunctionDeclaration);
  });

  test("parses interface with multiple functions", () => {
    const source = SourceText.from(
      "test.wr",
      "interface Runnable:\n    fn start()\n    fn stop()\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const interfaceDecl = result.tree.root().child(0);
    expect(interfaceDecl!.kind).toBe(SyntaxKind.InterfaceDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses dataclass with type parameters", () => {
    const source = SourceText.from("test.wr", "dataclass Opt[T]:\n    value: T\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const dataclassDecl = result.tree.root().child(0) as RedNode;
    expect(dataclassDecl.kind).toBe(SyntaxKind.DataclassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

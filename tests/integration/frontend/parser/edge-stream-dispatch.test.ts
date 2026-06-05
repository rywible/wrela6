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

describe("Edge class declaration dispatch (integration)", () => {
  test("parses edge class and reconstructs", () => {
    const source = SourceText.from("test.wr", "edge class Foo:\n    bar\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const edgeDecl = result.tree.root().child(0);
    expect(edgeDecl).toBeDefined();
    expect(edgeDecl!.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses unique edge class", () => {
    const source = SourceText.from("test.wr", "unique edge class NetworkDevice:\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const edgeDecl = result.tree.root().child(0);
    expect(edgeDecl).toBeDefined();
    expect(edgeDecl!.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses generic edge class with type parameter", () => {
    const source = SourceText.from("test.wr", "edge class Foo[T]:\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const edgeDecl = result.tree.root().child(0) as RedNode;
    expect(edgeDecl.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const typeParamList = edgeDecl.child(3);
    expect(typeParamList).toBeDefined();
    expect(typeParamList!.kind).toBe(SyntaxKind.TypeParameterList);
  });
});

describe("Stream declaration dispatch (integration)", () => {
  test("parses stream declaration and reconstructs", () => {
    const source = SourceText.from("test.wr", "stream Rx contains ReadableBuffer bound 64:\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const streamDecl = result.tree.root().child(0);
    expect(streamDecl).toBeDefined();
    expect(streamDecl!.kind).toBe(SyntaxKind.StreamDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("stream declaration children structure", () => {
    const source = SourceText.from("test.wr", "stream Rx contains ReadableBuffer bound 64:\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    const streamDecl = result.tree.root().child(0) as RedNode;
    expect(streamDecl.kind).toBe(SyntaxKind.StreamDeclaration);

    const children = streamDecl.children();
    expect(children[0]!.kind).toBe(SyntaxKind.StreamKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(children[2]!.kind).toBe(SyntaxKind.ContainsKeyword);
    expect(children[3]!.kind).toBe(SyntaxKind.TypeReference);
    expect(children[4]!.kind).toBe(SyntaxKind.BoundKeyword);
    expect(children[5]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(children[6]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[7]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

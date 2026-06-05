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

describe("Image declaration dispatch (integration)", () => {
  test("parses image declaration with empty body and reconstructs", () => {
    const source = SourceText.from("test.wr", "uefi image PacketCounterImage:\n    \n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const imageDecl = result.tree.root().child(0);
    expect(imageDecl).toBeDefined();
    expect(imageDecl!.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("parses image with devices section and reconstructs", () => {
    const source = SourceText.from(
      "test.wr",
      "uefi image PciImage:\n    devices:\n        vendor: u16\n        device: u16\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const imageDecl = result.tree.root().child(0);
    expect(imageDecl).toBeDefined();
    expect(imageDecl!.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (imageDecl as RedNode).child(4);
    expect(block).toBeDefined();
    expect(block!.kind).toBe(SyntaxKind.Block);

    const stmtList = (block as RedNode).child(2);
    expect(stmtList).toBeDefined();
    expect(stmtList!.kind).toBe(SyntaxKind.StatementList);

    const devicesSection = (stmtList as RedNode).child(0);
    expect(devicesSection).toBeDefined();
    expect(devicesSection!.kind).toBe(SyntaxKind.DevicesSection);

    const devicesBlock = (devicesSection as RedNode).child(2);
    expect(devicesBlock).toBeDefined();
    expect(devicesBlock!.kind).toBe(SyntaxKind.Block);

    const devicesStmtList = (devicesBlock as RedNode).child(2);
    expect(devicesStmtList).toBeDefined();
    expect(devicesStmtList!.kind).toBe(SyntaxKind.StatementList);

    const field1 = (devicesStmtList as RedNode).child(0);
    expect(field1).toBeDefined();
    expect(field1!.kind).toBe(SyntaxKind.FieldDeclaration);

    const field2 = (devicesStmtList as RedNode).child(1);
    expect(field2).toBeDefined();
    expect(field2!.kind).toBe(SyntaxKind.FieldDeclaration);
  });

  test("parses image with both fields and devices", () => {
    const source = SourceText.from(
      "test.wr",
      "uefi image MyImage:\n    vendor_id: u16\n    devices:\n        vendor: u16\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
    expect(result.tree.reconstruct()).toBe(source.text);

    const imageDecl = result.tree.root().child(0);
    expect(imageDecl).toBeDefined();
    expect(imageDecl!.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(result.parserDiagnostics).toHaveLength(0);

    const block = (imageDecl as RedNode).child(4);
    const stmtList = (block as RedNode).child(2);
    expect(stmtList!.kind).toBe(SyntaxKind.StatementList);

    const fieldDecl = (stmtList as RedNode).child(0);
    expect(fieldDecl).toBeDefined();
    expect(fieldDecl!.kind).toBe(SyntaxKind.FieldDeclaration);

    const devicesSection = (stmtList as RedNode).child(1);
    expect(devicesSection).toBeDefined();
    expect(devicesSection!.kind).toBe(SyntaxKind.DevicesSection);
  });

  test("reconstructs full image declaration exactly", () => {
    const sourceText =
      "uefi image PacketCounterImage:\n    vendor_id: u16\n    device_id: u16\n    devices:\n        vendor: u16\n        device: u16\n";
    const source = SourceText.from("test.wr", sourceText);
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(sourceText);
    expect(result.parserDiagnostics).toHaveLength(0);
  });
});

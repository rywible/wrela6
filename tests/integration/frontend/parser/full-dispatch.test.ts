import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { kindsInTree } from "../../../support/frontend/syntax-tree-queries";
import { expectValidSyntaxTree } from "../../../support/frontend/syntax-invariants";

const COMPREHENSIVE_SOURCE = [
  "use Logger from core.log",
  "",
  "enum PacketError:",
  "    TooShort",
  "    InvalidCrc",
  "",
  "dataclass PacketLimits:",
  "    min_size: u64",
  "    max_size: u64",
  "",
  "class RxBatch:",
  "    packets: u64",
  "",
  "interface Runnable:",
  "    fn run(self)",
  "",
  "uefi image Main:",
  "    devices:",
  "        net0: NetworkDevice",
  "",
  "fn process(packet: u8) -> bool:",
  "    if packet > 0:",
  "        return true",
  "    return false",
  "",
].join("\n");

describe("full dispatch", () => {
  test("parses comprehensive source", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({
      keywords: KeywordTable.default(),
      diagnostics,
    });
    const parser = new Parser();
    const source = SourceText.from("test.wr", COMPREHENSIVE_SOURCE);
    const lexResult = lexer.lex(source);
    const result = parser.parseLexResult({
      lexResult,
      lexerDiagnostics: diagnostics.diagnostics,
    });

    expectValidSyntaxTree({ source, tree: result.tree, allowDiagnostics: false });
    expect(result.tree.reconstruct()).toBe(source.text);

    const kinds = kindsInTree(result.tree);
    expect(kinds).toContain(SyntaxKind.ImportDeclaration);
    expect(kinds).toContain(SyntaxKind.EnumDeclaration);
    expect(kinds).toContain(SyntaxKind.DataclassDeclaration);
    expect(kinds).toContain(SyntaxKind.ClassDeclaration);
    expect(kinds).toContain(SyntaxKind.InterfaceDeclaration);
    expect(kinds).toContain(SyntaxKind.FunctionDeclaration);
    expect(kinds).toContain(SyntaxKind.ImageDeclaration);
    expect(kinds).toContain(SyntaxKind.DevicesSection);
    expect(kinds).toContain(SyntaxKind.SourceFile);
  });
});

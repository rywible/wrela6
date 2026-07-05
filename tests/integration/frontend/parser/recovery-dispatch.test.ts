import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { expectValidSyntaxTree } from "../../../support/frontend/syntax-invariants";

function createLexer(): Lexer {
  return new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
}

describe("recovery dispatch", () => {
  test("malformed source with recovery round-trips exactly", () => {
    const source = SourceText.from("recovery.wr", "@broken\nuefi image Main:\n    devices\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expectValidSyntaxTree({ source, tree: result.tree, allowDiagnostics: true });

    expect(result.tree.reconstruct()).toBe(source.text);

    const recoveryDiag = result.parserDiagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
    );
    expect(recoveryDiag).toBeDefined();

    const root = result.tree.root();
    const errorNodes = root.children().filter((child) => child.kind === SyntaxKind.ErrorNode);
    expect(errorNodes.length).toBeGreaterThanOrEqual(1);

    const imageDecl = root.children().find((child) => child.kind === SyntaxKind.ImageDeclaration);
    expect(imageDecl).toBeDefined();
  });

  test("malformed block items produce SkippedTokens and later statements parse", () => {
    const source = SourceText.from(
      "block.wr",
      "fn main() -> Never:\n    if true:\n        @\n        x = 1\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expectValidSyntaxTree({ source, tree: result.tree, allowDiagnostics: true });

    expect(result.tree.reconstruct()).toBe(source.text);

    const recoveryDiag = result.parserDiagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_RECOVERY_SKIPPED_TOKENS",
    );
    expect(recoveryDiag).toBeDefined();
  });

  test("recovery diagnostics are deterministic across repeated parses", () => {
    const source = SourceText.from("deterministic.wr", "@broken\nuefi image Main:\n    devices\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();

    const result1 = parser.parseLexResult({ lexResult });
    const result2 = parser.parseLexResult({ lexResult });

    expect(result1.parserDiagnostics.length).toBe(result2.parserDiagnostics.length);

    for (let idx = 0; idx < result1.parserDiagnostics.length; idx++) {
      const diagnostic1 = result1.parserDiagnostics[idx]!;
      const diagnostic2 = result2.parserDiagnostics[idx]!;
      expect(diagnostic1.code).toBe(diagnostic2.code);
      expect(diagnostic1.span.start).toBe(diagnostic2.span.start);
      expect(diagnostic1.span.end).toBe(diagnostic2.span.end);
      expect(diagnostic1.message).toBe(diagnostic2.message);
    }

    expect(result1.tree.reconstruct()).toBe(result2.tree.reconstruct());
  });

  test("reconstruction is exact even with recovery at top level", () => {
    const source = SourceText.from(
      "multi-error.wr",
      "!!!\nlet x = 1\n???\nuefi image Main:\n    devices\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expectValidSyntaxTree({ source, tree: result.tree, allowDiagnostics: true });

    expect(result.tree.reconstruct()).toBe(source.text);

    expect(result.parserDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, expect, test } from "bun:test";
import * as fastCheck from "fast-check";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  SourceText,
} from "../../../../src/frontend/lexer";
import { Parser } from "../../../../src/frontend/parser/parser";
import {
  arbitraryText,
  deepExpressionNesting,
} from "../../../support/frontend/parser-fuzz-generators";
import { expectValidSyntaxTree } from "../../../support/frontend/syntax-invariants";

describe("parser fuzz", () => {
  test("arbitrary text never throws", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({
      keywords: KeywordTable.default(),
      diagnostics,
    });
    const parser = new Parser();

    fastCheck.assert(
      fastCheck.property(arbitraryText(), (text) => {
        const source = SourceText.from("fuzz.wr", text);
        const lexResult = lexer.lex(source);
        const parseResult = parser.parseLexResult({
          lexResult,
          lexerDiagnostics: diagnostics.diagnostics,
        });

        expect(parseResult.tree.reconstruct()).toBe(source.text);
        expectValidSyntaxTree({
          source,
          tree: parseResult.tree,
          allowDiagnostics: true,
        });
      }),
      { numRuns: 250 },
    );
  });

  test("deep nesting triggers depth limit diagnostic", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({
      keywords: KeywordTable.default(),
      diagnostics,
    });

    let source = "fn test():\n";
    for (let index = 0; index < 300; index++) {
      source += "    ".repeat(index + 1) + "loop:\n";
    }
    source += "    ".repeat(301) + "return\n";

    const sourceText = SourceText.from("deep.wr", source);
    const lexResult = lexer.lex(sourceText);

    const limitedParser = new Parser({ maxDepth: 10 });
    const result = limitedParser.parseLexResult({
      lexResult,
      lexerDiagnostics: diagnostics.diagnostics,
    });

    const depthDiagnostics = result.parserDiagnostics.filter(
      (diagnostic) => diagnostic.code === "PARSE_NESTING_LIMIT_EXCEEDED",
    );
    expect(depthDiagnostics.length).toBeGreaterThan(0);

    expect(result.tree.reconstruct()).toBe(source);
  });

  test("deep expression nesting triggers depth limit", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({
      keywords: KeywordTable.default(),
      diagnostics,
    });
    const parser = new Parser({ maxDepth: 10 });

    fastCheck.assert(
      fastCheck.property(deepExpressionNesting(), (sourceText) => {
        const source = SourceText.from("fuzz.wr", sourceText);
        const lexResult = lexer.lex(source);
        const result = parser.parseLexResult({
          lexResult,
          lexerDiagnostics: diagnostics.diagnostics,
        });

        const depthDiags = result.parserDiagnostics.filter(
          (diagnostic) => diagnostic.code === "PARSE_NESTING_LIMIT_EXCEEDED",
        );
        if (sourceText.length > 200) {
          expect(depthDiags.length).toBeGreaterThan(0);
        }
        expect(result.tree.reconstruct()).toBe(source.text);
      }),
      { numRuns: 50 },
    );
  });

  test("repeated parse produces equivalent results", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({
      keywords: KeywordTable.default(),
      diagnostics,
    });
    const parser = new Parser();
    const source = SourceText.from(
      "repeat.wr",
      "uefi image Main:\n    devices:\n        net0: NetworkDevice\n",
    );

    const lexResult = lexer.lex(source);

    const result1 = parser.parseLexResult({
      lexResult,
      lexerDiagnostics: diagnostics.diagnostics,
    });

    const result2 = parser.parseLexResult({
      lexResult,
      lexerDiagnostics: diagnostics.diagnostics,
    });

    expect(result1.tree.reconstruct()).toBe(result2.tree.reconstruct());

    const codes1 = result1.parserDiagnostics.map((diagnostic) => diagnostic.code);
    const codes2 = result2.parserDiagnostics.map((diagnostic) => diagnostic.code);
    expect(codes1).toEqual(codes2);
  });
});

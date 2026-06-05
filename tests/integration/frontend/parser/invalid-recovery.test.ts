import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { kindsInTree } from "../../../support/frontend/syntax-tree-queries";
import { expectValidSyntaxTree } from "../../../support/frontend/syntax-invariants";

const MALFORMED_SNIPPETS = [
  {
    name: "malformed-declaration-recovers",
    source: [
      "class Broken:",
      "    fn bad(",
      "",
      "uefi image StillParses:",
      "    devices:",
      "        net0: NetworkDevice",
      "",
    ].join("\n"),
    kinds: [SyntaxKind.ImageDeclaration, SyntaxKind.DevicesSection],
    recoveryKinds: [SyntaxKind.FunctionDeclaration],
  },
];

const SEMANTIC_INVALID_SNIPPETS = [
  {
    name: "semantic-invalid-still-parses",
    source: ["class Foo:", "    x: u64", "", "fn test():", "    return", ""].join("\n"),
    kinds: [
      SyntaxKind.ClassDeclaration,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.ReturnStatement,
    ],
  },
];

describe("parser invalid recovery", () => {
  describe("malformed snippets", () => {
    for (const snippet of MALFORMED_SNIPPETS) {
      test(snippet.name, () => {
        const diagnostics = new CollectingDiagnosticSink();
        const lexer = new Lexer({
          keywords: KeywordTable.default(),
          diagnostics,
        });
        const parser = new Parser();
        const source = SourceText.from("test.wr", snippet.source);
        const lexResult = lexer.lex(source);
        const result = parser.parseLexResult({
          lexResult,
          lexerDiagnostics: diagnostics.diagnostics,
        });

        expectValidSyntaxTree({
          source,
          tree: result.tree,
          allowDiagnostics: true,
        });

        expect(result.tree.reconstruct()).toBe(source.text);

        const kinds = kindsInTree(result.tree);
        const hasRecoveryKind = snippet.recoveryKinds.some((kind) => kinds.includes(kind));
        expect(hasRecoveryKind).toBe(true);

        for (const kind of snippet.kinds) {
          expect(kinds).toContain(kind);
        }

        expect(result.tree.diagnostics.length > 0).toBe(true);
      });
    }
  });

  describe("semantic-invalid snippets", () => {
    for (const snippet of SEMANTIC_INVALID_SNIPPETS) {
      test(snippet.name, () => {
        const diagnostics = new CollectingDiagnosticSink();
        const lexer = new Lexer({
          keywords: KeywordTable.default(),
          diagnostics,
        });
        const parser = new Parser();
        const source = SourceText.from("test.wr", snippet.source);
        const lexResult = lexer.lex(source);
        const result = parser.parseLexResult({
          lexResult,
          lexerDiagnostics: diagnostics.diagnostics,
        });

        expectValidSyntaxTree({
          source,
          tree: result.tree,
          allowDiagnostics: false,
        });

        expect(result.tree.reconstruct()).toBe(source.text);

        const kinds = kindsInTree(result.tree);
        for (const kind of snippet.kinds) {
          expect(kinds).toContain(kind);
        }
      });
    }
  });
});

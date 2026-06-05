import { describe, expect, test } from "bun:test";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import {
  nodeFromMark,
  type ParserMark,
  type DraftParseDiagnostic as DraftDiagnostic,
} from "../../../../src/frontend/parser/node-claim";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import type { GreenElement } from "../../../../src/frontend/syntax/green-node";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";
import { SourceSpan } from "../../../../src/shared/source-span";

function span(start: number, end: number): SourceSpan {
  return SourceSpan.from(start, end);
}

const factory = new SyntaxFactory();

describe("SyntaxFactory", () => {
  describe("tokenFromLexToken", () => {
    test("wraps a lexer token into a green token", () => {
      const lexerToken = new Token({
        kind: TokenKind.Identifier,
        lexeme: "foo",
        span: span(0, 3),
        leadingTrivia: [],
        trailingTrivia: [],
      });
      const green = factory.tokenFromLexToken(lexerToken);
      expect(green.kind).toBe(SyntaxKind.IdentifierToken);
      expect(green.lexeme).toBe("foo");
      expect(green.width).toBe(3);
      expect(green.isMissing).toBe(false);
    });

    test("wraps token with trivia", () => {
      const leading = [new Trivia({ kind: TriviaKind.Whitespace, lexeme: "  ", span: span(0, 2) })];
      const trailing = [new Trivia({ kind: TriviaKind.Newline, lexeme: "\n", span: span(5, 6) })];
      const lexerToken = new Token({
        kind: TokenKind.Let,
        lexeme: "let",
        span: span(2, 5),
        leadingTrivia: leading,
        trailingTrivia: trailing,
      });
      const green = factory.tokenFromLexToken(lexerToken);
      expect(green.kind).toBe(SyntaxKind.LetKeyword);
      expect(green.reconstruct()).toBe("  let\n");
    });
  });

  describe("missingToken", () => {
    test("creates a missing token with expected kind", () => {
      const token = factory.missingToken(SyntaxKind.EqualsToken);
      expect(token.kind).toBe(SyntaxKind.EqualsToken);
      expect(token.isMissing).toBe(true);
      expect(token.width).toBe(0);
      expect(token.lexeme).toBe("");
    });

    test("creates a missing token with different kinds", () => {
      const token = factory.missingToken(SyntaxKind.IdentifierToken);
      expect(token.kind).toBe(SyntaxKind.IdentifierToken);
      expect(token.isMissing).toBe(true);
    });
  });

  describe("node", () => {
    test("creates a node with children", () => {
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "x", [], [], false),
      ];
      const node = factory.node(SyntaxKind.NameExpression, children);
      expect(node.kind).toBe(SyntaxKind.NameExpression);
      expect(node.width).toBe(1);
      expect(node.reconstruct()).toBe("x");
    });

    test("creates a node with diagnostics", () => {
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "x", [], [], false),
      ];
      const sourceDiagnostics = [
        {
          code: "PARSE_EXPECTED_TOKEN" as const,
          severity: "error" as const,
          message: "test",
          relativeStart: 0,
          relativeEnd: 1,
        },
      ];
      const node = factory.node(SyntaxKind.NameExpression, children, sourceDiagnostics);
      expect(node.diagnostics).toHaveLength(1);
      expect(node.diagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    });
  });

  describe("errorNode", () => {
    test("creates an ErrorNode", () => {
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "bad", [], [], false),
      ];
      const node = factory.errorNode(children);
      expect(node.kind).toBe(SyntaxKind.ErrorNode);
      expect(node.reconstruct()).toBe("bad");
    });

    test("creates an ErrorNode with diagnostics", () => {
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "x", [], [], false),
      ];
      const sourceDiagnostics = [
        {
          code: "PARSE_EXPECTED_TOKEN" as const,
          severity: "error" as const,
          message: "error",
          relativeStart: 0,
          relativeEnd: 1,
        },
      ];
      const node = factory.errorNode(children, sourceDiagnostics);
      expect(node.kind).toBe(SyntaxKind.ErrorNode);
      expect(node.diagnostics).toHaveLength(1);
    });
  });

  describe("missingNode", () => {
    test("creates a MissingNode", () => {
      const node = factory.missingNode();
      expect(node.kind).toBe(SyntaxKind.MissingNode);
      expect(node.width).toBe(0);
      expect(node.reconstruct()).toBe("");
    });
  });

  describe("skippedTokens", () => {
    test("creates a SkippedTokens node from one token", () => {
      const tokens = [new GreenToken(SyntaxKind.IdentifierToken, "foo", [], [], false)];
      const node = factory.skippedTokens(tokens);
      expect(node.kind).toBe(SyntaxKind.SkippedTokens);
      expect(node.reconstruct()).toBe("foo");
    });

    test("creates a SkippedTokens node from multiple tokens", () => {
      const tokens = [
        new GreenToken(SyntaxKind.IdentifierToken, "a", [], [], false),
        new GreenToken(SyntaxKind.PlusToken, "+", [], [], false),
        new GreenToken(SyntaxKind.IntegerLiteralToken, "1", [], [], false),
      ];
      const node = factory.skippedTokens(tokens);
      expect(node.kind).toBe(SyntaxKind.SkippedTokens);
      expect(node.reconstruct()).toBe("a+1");
    });

    test("reconstruct matches token reconstructions", () => {
      const tokens = [
        new GreenToken(SyntaxKind.IntegerLiteralToken, "42", [], [], false),
        new GreenToken(SyntaxKind.StarToken, "*", [], [], false),
        new GreenToken(SyntaxKind.IdentifierToken, "x", [], [], false),
      ];
      const reconstruction = tokens.map((token) => token.reconstruct()).join("");
      const node = factory.skippedTokens(tokens);
      expect(node.reconstruct()).toBe(reconstruction);
    });

    test("reconstruct includes trivia", () => {
      const leadingTrivia = [
        new (require("../../../../src/frontend/syntax/green-trivia").GreenTrivia)(
          TriviaKind.Whitespace,
          " ",
        ),
      ];
      const tokens = [new GreenToken(SyntaxKind.IdentifierToken, "x", leadingTrivia, [], false)];
      const node = factory.skippedTokens(tokens);
      expect(node.reconstruct()).toBe(" x");
    });
  });

  describe("nodeFromMark", () => {
    test("claims diagnostic inside node range", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Expected ';'",
        absoluteStart: 2,
        absoluteEnd: 3,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcde", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(sourceDiagnostic1.claimed).toBe(true);
      expect(node.diagnostics).toHaveLength(1);
      expect(node.diagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
      expect(node.diagnostics[0]!.relativeStart).toBe(2);
      expect(node.diagnostics[0]!.relativeEnd).toBe(3);
    });

    test("does not claim diagnostic outside node range", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Outside",
        absoluteStart: 10,
        absoluteEnd: 12,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abc", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(sourceDiagnostic1.claimed).toBe(false);
      expect(node.diagnostics).toHaveLength(0);
    });

    test("does not claim diagnostic before diagnosticStartIndex", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Before mark",
        absoluteStart: 1,
        absoluteEnd: 2,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 1 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcde", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(sourceDiagnostic1.claimed).toBe(false);
      expect(node.diagnostics).toHaveLength(0);
    });

    test("claims zero-width diagnostic at node end", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "At end",
        absoluteStart: 5,
        absoluteEnd: 5,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcde", [], [], false),
      ];
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(sourceDiagnostic1.claimed).toBe(true);
      expect(node.diagnostics).toHaveLength(1);
      expect(node.diagnostics[0]!.relativeStart).toBe(5);
      expect(node.diagnostics[0]!.relativeEnd).toBe(5);
    });

    test("does not claim already-claimed diagnostic", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Already claimed",
        absoluteStart: 1,
        absoluteEnd: 2,
        claimed: true,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abc", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(node.diagnostics).toHaveLength(0);
    });

    test("converts absolute positions to relative using mark offset", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Shifted",
        absoluteStart: 5,
        absoluteEnd: 7,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 3, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcd", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(node.diagnostics).toHaveLength(1);
      expect(node.diagnostics[0]!.relativeStart).toBe(2);
      expect(node.diagnostics[0]!.relativeEnd).toBe(4);
    });

    test("claims multiple diagnostics from a single mark", () => {
      const sourceDiagnostic1: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "First",
        absoluteStart: 0,
        absoluteEnd: 1,
        claimed: false,
      };
      const sourceDiagnostic2: DraftDiagnostic = {
        code: "PARSE_UNEXPECTED_TOKEN",
        severity: "warning",
        message: "Second",
        absoluteStart: 2,
        absoluteEnd: 4,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic1, sourceDiagnostic2];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcde", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(node.diagnostics).toHaveLength(2);
      expect(sourceDiagnostic1.claimed).toBe(true);
      expect(sourceDiagnostic2.claimed).toBe(true);
    });

    test("only claims diagnostics from inside the node range", () => {
      const inside: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Inside",
        absoluteStart: 1,
        absoluteEnd: 2,
        claimed: false,
      };
      const outside: DraftDiagnostic = {
        code: "PARSE_UNEXPECTED_TOKEN",
        severity: "error",
        message: "Outside",
        absoluteStart: 6,
        absoluteEnd: 8,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [inside, outside];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 0, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abcde", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(node.diagnostics).toHaveLength(1);
      expect(node.diagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
      expect(inside.claimed).toBe(true);
      expect(outside.claimed).toBe(false);
    });

    test("does not claim diagnostic that starts before node but ends inside", () => {
      const sourceDiagnostic: DraftDiagnostic = {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "Overlap start",
        absoluteStart: 0,
        absoluteEnd: 3,
        claimed: false,
      };
      const draftList: DraftDiagnostic[] = [sourceDiagnostic];
      const context = { draftDiagnostics: () => draftList, offset: 0 };
      const mark: ParserMark = { offset: 1, diagnosticStartIndex: 0 };
      const children: GreenElement[] = [
        new GreenToken(SyntaxKind.IdentifierToken, "abc", [], [], false),
      ];

      const node = nodeFromMark({
        factory,
        context,
        mark,
        kind: SyntaxKind.NameExpression,
        children,
      });

      expect(node.diagnostics).toHaveLength(0);
      expect(sourceDiagnostic.claimed).toBe(false);
    });
  });
});

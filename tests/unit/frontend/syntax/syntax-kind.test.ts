import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import {
  syntaxKindFromTokenKind,
  isTokenSyntaxKind,
  isNodeSyntaxKind,
} from "../../../../src/frontend/syntax/syntax-kind-map";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { allTokenKinds } from "../../../support/frontend/token-kind-helpers";

const TOKEN_COUNT = 81;

describe("syntax kind mapping", () => {
  test("every TokenKind maps to a SyntaxKind without throwing", () => {
    for (const tokenKind of allTokenKinds()) {
      expect(() => syntaxKindFromTokenKind(tokenKind)).not.toThrow();
    }
  });

  test("allTokenKinds returns each numeric TokenKind exactly once", () => {
    const kinds = allTokenKinds();
    expect(kinds.length).toBe(TOKEN_COUNT);
    expect(new Set(kinds).size).toBe(TOKEN_COUNT);
  });

  test("syntaxKindFromTokenKind returns correct values", () => {
    expect(syntaxKindFromTokenKind(TokenKind.Identifier)).toBe(SyntaxKind.IdentifierToken);
    expect(syntaxKindFromTokenKind(TokenKind.Uefi)).toBe(SyntaxKind.UefiKeyword);
    expect(syntaxKindFromTokenKind(TokenKind.Eof)).toBe(SyntaxKind.EndOfFileToken);
    expect(syntaxKindFromTokenKind(TokenKind.Use)).toBe(SyntaxKind.UseKeyword);
    expect(syntaxKindFromTokenKind(TokenKind.From)).toBe(SyntaxKind.FromKeyword);
    expect(syntaxKindFromTokenKind(TokenKind.Fn)).toBe(SyntaxKind.FnKeyword);
    expect(syntaxKindFromTokenKind(TokenKind.LeftParen)).toBe(SyntaxKind.LeftParenToken);
    expect(syntaxKindFromTokenKind(TokenKind.FatArrow)).toBe(SyntaxKind.FatArrowToken);
    expect(syntaxKindFromTokenKind(TokenKind.Newline)).toBe(SyntaxKind.NewlineToken);
    expect(syntaxKindFromTokenKind(TokenKind.Invalid)).toBe(SyntaxKind.InvalidToken);
  });
});

describe("token and node kind predicates", () => {
  test("isTokenSyntaxKind returns true for token-like syntax kinds", () => {
    expect(isTokenSyntaxKind(SyntaxKind.IdentifierToken)).toBe(true);
    expect(isTokenSyntaxKind(SyntaxKind.IntegerLiteralToken)).toBe(true);
    expect(isTokenSyntaxKind(SyntaxKind.ColonToken)).toBe(true);
    expect(isTokenSyntaxKind(SyntaxKind.UseKeyword)).toBe(true);
    expect(isTokenSyntaxKind(SyntaxKind.NewlineToken)).toBe(true);
    expect(isTokenSyntaxKind(SyntaxKind.EndOfFileToken)).toBe(true);
  });

  test("isTokenSyntaxKind returns false for node-like syntax kinds", () => {
    expect(isTokenSyntaxKind(SyntaxKind.SourceFile)).toBe(false);
    expect(isTokenSyntaxKind(SyntaxKind.ImportDeclaration)).toBe(false);
    expect(isTokenSyntaxKind(SyntaxKind.Block)).toBe(false);
    expect(isTokenSyntaxKind(SyntaxKind.NameExpression)).toBe(false);
    expect(isTokenSyntaxKind(SyntaxKind.ErrorNode)).toBe(false);
    expect(isTokenSyntaxKind(SyntaxKind.MissingNode)).toBe(false);
  });

  test("isNodeSyntaxKind returns true for node-like syntax kinds", () => {
    expect(isNodeSyntaxKind(SyntaxKind.SourceFile)).toBe(true);
    expect(isNodeSyntaxKind(SyntaxKind.FunctionDeclaration)).toBe(true);
    expect(isNodeSyntaxKind(SyntaxKind.Block)).toBe(true);
    expect(isNodeSyntaxKind(SyntaxKind.ErrorNode)).toBe(true);
    expect(isNodeSyntaxKind(SyntaxKind.MissingNode)).toBe(true);
    expect(isNodeSyntaxKind(SyntaxKind.SkippedTokens)).toBe(true);
  });

  test("isNodeSyntaxKind returns false for token-like syntax kinds", () => {
    expect(isNodeSyntaxKind(SyntaxKind.IdentifierToken)).toBe(false);
    expect(isNodeSyntaxKind(SyntaxKind.EndOfFileToken)).toBe(false);
    expect(isNodeSyntaxKind(SyntaxKind.ReturnKeyword)).toBe(false);
  });

  test("every token syntax kind passes isTokenSyntaxKind", () => {
    for (const tokenKind of allTokenKinds()) {
      const syntaxKind = syntaxKindFromTokenKind(tokenKind);
      expect(isTokenSyntaxKind(syntaxKind)).toBe(true);
      expect(isNodeSyntaxKind(syntaxKind)).toBe(false);
    }
  });
});

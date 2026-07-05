import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { parseExpression } from "../../../../src/frontend/parser/expression-parser";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";

function makeToken(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

function context(tokens: Token[]): ParserContext {
  return new ParserContext({
    tokens: TokenStream.from(tokens),
    factory: new SyntaxFactory(),
  });
}

function eof(end: number): Token {
  return makeToken(TokenKind.Eof, "", end, end);
}

describe("parseExpression", () => {
  test("parenthesized expression preserves precedence", () => {
    const node = parseExpression(
      context([
        makeToken(TokenKind.LeftParen, "(", 0, 1),
        makeToken(TokenKind.Identifier, "a", 1, 2),
        makeToken(TokenKind.Plus, "+", 2, 3),
        makeToken(TokenKind.Identifier, "b", 3, 4),
        makeToken(TokenKind.RightParen, ")", 4, 5),
        makeToken(TokenKind.Star, "*", 5, 6),
        makeToken(TokenKind.Identifier, "c", 6, 7),
        eof(7),
      ]),
    );

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.StarToken);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.ParenthesizedExpression);
    expect(((node.children[0] as GreenNode).children[1] as GreenNode).kind).toBe(
      SyntaxKind.BinaryExpression,
    );
    expect(node.reconstruct()).toBe("(a+b)*c");
  });

  test("index expression accepts literal index operand", () => {
    const parserContext = context([
      makeToken(TokenKind.Identifier, "items", 0, 5),
      makeToken(TokenKind.LeftBracket, "[", 5, 6),
      makeToken(TokenKind.IntegerLiteral, "0", 6, 7),
      makeToken(TokenKind.RightBracket, "]", 7, 8),
      eof(8),
    ]);

    const node = parseExpression(parserContext);

    expect(node.kind).toBe(SyntaxKind.IndexExpression);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.reconstruct()).toBe("items[0]");
    expect(parserContext.draftDiagnostics()).toHaveLength(0);
  });

  test("index expression accepts non-literal index operand", () => {
    const parserContext = context([
      makeToken(TokenKind.Identifier, "items", 0, 5),
      makeToken(TokenKind.LeftBracket, "[", 5, 6),
      makeToken(TokenKind.Identifier, "i", 6, 7),
      makeToken(TokenKind.Plus, "+", 7, 8),
      makeToken(TokenKind.IntegerLiteral, "1", 8, 9),
      makeToken(TokenKind.RightBracket, "]", 9, 10),
      eof(10),
    ]);

    const node = parseExpression(parserContext);

    expect(node.kind).toBe(SyntaxKind.IndexExpression);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.reconstruct()).toBe("items[i+1]");
    expect(parserContext.draftDiagnostics()).toHaveLength(0);
  });

  test("lowercase generic call parses bracketed type arguments before call", () => {
    const parserContext = context([
      makeToken(TokenKind.Identifier, "identity", 0, 8),
      makeToken(TokenKind.LeftBracket, "[", 8, 9),
      makeToken(TokenKind.Identifier, "u32", 9, 12),
      makeToken(TokenKind.RightBracket, "]", 12, 13),
      makeToken(TokenKind.LeftParen, "(", 13, 14),
      makeToken(TokenKind.IntegerLiteral, "1", 14, 15),
      makeToken(TokenKind.RightParen, ")", 15, 16),
      eof(16),
    ]);

    const node = parseExpression(parserContext);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    const callee = node.children[0] as GreenNode;
    expect(callee.kind).toBe(SyntaxKind.TypeApplicationExpression);
    expect(callee.reconstruct()).toBe("identity[u32]");
    expect(parserContext.draftDiagnostics()).toHaveLength(0);
  });
});

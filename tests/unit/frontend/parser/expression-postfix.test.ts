import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import {
  parseExpression,
  parsePrimaryExpression,
  parsePostfixExpression,
} from "../../../../src/frontend/parser/expression-parser";

function makeToken(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

function makeContext(tokens: Token[]): ParserContext {
  return new ParserContext({
    tokens: TokenStream.from(tokens),
    factory: new SyntaxFactory(),
  });
}

describe("parsePrimaryExpression", () => {
  test("identifier parses as NameExpression", () => {
    const tokens = [makeToken(TokenKind.Identifier, "x", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("x");
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("integer literal parses as LiteralExpression", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "42", 0, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IntegerLiteralToken);
    expect(node.reconstruct()).toBe("42");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("string literal parses as LiteralExpression", () => {
    const tokens = [
      makeToken(TokenKind.StringLiteral, '"hello"', 0, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.StringLiteralToken);
    expect(node.reconstruct()).toBe('"hello"');
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("object literal with fields", () => {
    const tokens = [
      makeToken(TokenKind.LeftBrace, "{", 0, 1),
      makeToken(TokenKind.Identifier, "name", 1, 5),
      makeToken(TokenKind.Colon, ":", 5, 6),
      makeToken(TokenKind.Identifier, "x", 6, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.Identifier, "size", 8, 12),
      makeToken(TokenKind.Colon, ":", 12, 13),
      makeToken(TokenKind.IntegerLiteral, "10", 13, 15),
      makeToken(TokenKind.RightBrace, "}", 15, 16),
      makeToken(TokenKind.Eof, "", 16, 16),
    ];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.ObjectLiteralExpression);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBraceToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.ObjectField);
    expect((node.children[2] as GreenToken).kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.ObjectField);
    expect(node.children[4]!.kind).toBe(SyntaxKind.RightBraceToken);

    const field1 = node.children[1] as GreenNode;
    expect(field1.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((field1.children[0] as GreenToken).lexeme).toBe("name");
    expect(field1.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((field1.children[2] as GreenNode).kind).toBe(SyntaxKind.NameExpression);

    const field2 = node.children[3] as GreenNode;
    expect(field2.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((field2.children[0] as GreenToken).lexeme).toBe("size");
    expect(field2.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((field2.children[2] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.reconstruct()).toBe("{name:x,size:10}");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("object literal allows trailing comma", () => {
    const tokens = [
      makeToken(TokenKind.LeftBrace, "{", 0, 1),
      makeToken(TokenKind.Identifier, "a", 1, 2),
      makeToken(TokenKind.Colon, ":", 2, 3),
      makeToken(TokenKind.IntegerLiteral, "1", 3, 4),
      makeToken(TokenKind.Comma, ",", 4, 5),
      makeToken(TokenKind.RightBrace, "}", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.ObjectLiteralExpression);
    expect(node.reconstruct()).toBe("{a:1,}");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("empty object literal", () => {
    const tokens = [
      makeToken(TokenKind.LeftBrace, "{", 0, 1),
      makeToken(TokenKind.RightBrace, "}", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.ObjectLiteralExpression);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBraceToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.RightBraceToken);
    expect(node.reconstruct()).toBe("{}");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("unexpected token produces missing node and diagnostic", () => {
    const tokens = [makeToken(TokenKind.Plus, "+", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parsePrimaryExpression(context);

    expect(node.kind).toBe(SyntaxKind.MissingNode);
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_EXPRESSION");
  });
});

describe("parsePostfixExpression", () => {
  test("member access with identifier", () => {
    const left = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [GreenToken.fromToken(makeToken(TokenKind.Identifier, "a", 0, 1))],
    });
    const tokens = [
      makeToken(TokenKind.Dot, ".", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parsePostfixExpression(context, left);

    expect(node.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("b");
    expect(node.reconstruct()).toBe("a.b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("member access with keyword as member name", () => {
    const left = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [GreenToken.fromToken(makeToken(TokenKind.Identifier, "obj", 0, 3))],
    });
    const tokens = [
      makeToken(TokenKind.Dot, ".", 3, 4),
      makeToken(TokenKind.Uefi, "uefi", 4, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parsePostfixExpression(context, left);

    expect(node.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.children).toHaveLength(3);
    expect(node.children[2]!.kind).toBe(SyntaxKind.UefiKeyword);
    expect((node.children[2] as GreenToken).lexeme).toBe("uefi");
    expect(node.reconstruct()).toBe("obj.uefi");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("chained member access", () => {
    const left = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [GreenToken.fromToken(makeToken(TokenKind.Identifier, "a", 0, 1))],
    });
    const tokens = [
      makeToken(TokenKind.Dot, ".", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Dot, ".", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parsePostfixExpression(context, left);

    expect(node.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("c");
    expect(node.reconstruct()).toBe("a.b.c");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseExpression", () => {
  test("identifier expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("foo");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("member access expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Dot, ".", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.reconstruct()).toBe("a.b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("call expression with named argument", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "name", 4, 8),
      makeToken(TokenKind.Equals, "=", 8, 9),
      makeToken(TokenKind.IntegerLiteral, "42", 9, 11),
      makeToken(TokenKind.RightParen, ")", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);

    const argList = node.children[1] as GreenNode;
    expect(argList.kind).toBe(SyntaxKind.CallArgumentList);
    expect(argList.children).toHaveLength(3);
    expect(argList.children[0]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((argList.children[1] as GreenNode).kind).toBe(SyntaxKind.NamedArgument);
    expect(argList.children[2]!.kind).toBe(SyntaxKind.RightParenToken);

    const namedArg = argList.children[1] as GreenNode;
    expect(namedArg.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((namedArg.children[0] as GreenToken).lexeme).toBe("name");
    expect(namedArg.children[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((namedArg.children[2] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);

    expect(node.reconstruct()).toBe("foo(name=42)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("call expression with multiple named arguments", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      makeToken(TokenKind.Equals, "=", 5, 6),
      makeToken(TokenKind.IntegerLiteral, "1", 6, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.Identifier, "b", 8, 9),
      makeToken(TokenKind.Equals, "=", 9, 10),
      makeToken(TokenKind.IntegerLiteral, "2", 10, 11),
      makeToken(TokenKind.RightParen, ")", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    expect(node.reconstruct()).toBe("foo(a=1,b=2)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("call expression preserves multiline newlines", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Identifier, "a", 5, 6),
      makeToken(TokenKind.Equals, "=", 6, 7),
      makeToken(TokenKind.IntegerLiteral, "1", 7, 8),
      makeToken(TokenKind.Comma, ",", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Identifier, "b", 10, 11),
      makeToken(TokenKind.Equals, "=", 11, 12),
      makeToken(TokenKind.IntegerLiteral, "2", 12, 13),
      makeToken(TokenKind.Comma, ",", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.RightParen, ")", 15, 16),
      makeToken(TokenKind.Eof, "", 16, 16),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    expect(node.reconstruct()).toBe("foo(\na=1,\nb=2,\n)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("call expression with trailing comma", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      makeToken(TokenKind.Equals, "=", 5, 6),
      makeToken(TokenKind.IntegerLiteral, "1", 6, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.RightParen, ")", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    expect(node.reconstruct()).toBe("foo(a=1,)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("empty call", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.RightParen, ")", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.CallExpression);
    expect(node.reconstruct()).toBe("foo()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("type application expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Result", 0, 6),
      makeToken(TokenKind.LeftBracket, "[", 6, 7),
      makeToken(TokenKind.Identifier, "Never", 7, 12),
      makeToken(TokenKind.RightBracket, "]", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.TypeApplicationExpression);
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node.reconstruct()).toBe("Result[Never]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("type application with member access and call", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "MoveRing", 0, 8),
      makeToken(TokenKind.LeftBracket, "[", 8, 9),
      makeToken(TokenKind.Identifier, "Packet", 9, 15),
      makeToken(TokenKind.RightBracket, "]", 15, 16),
      makeToken(TokenKind.Dot, ".", 16, 17),
      makeToken(TokenKind.Identifier, "new", 17, 20),
      makeToken(TokenKind.LeftParen, "(", 20, 21),
      makeToken(TokenKind.Identifier, "max", 21, 24),
      makeToken(TokenKind.Equals, "=", 24, 25),
      makeToken(TokenKind.IntegerLiteral, "64", 25, 27),
      makeToken(TokenKind.RightParen, ")", 27, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    // Outer: CallExpression
    expect(node.kind).toBe(SyntaxKind.CallExpression);
    const callTarget = node.children[0] as GreenNode;
    expect(callTarget.kind).toBe(SyntaxKind.MemberAccessExpression);

    const typeApp = callTarget.children[0] as GreenNode;
    expect(typeApp.kind).toBe(SyntaxKind.TypeApplicationExpression);

    const nameExpr = typeApp.children[0] as GreenNode;
    expect(nameExpr.kind).toBe(SyntaxKind.NameExpression);
    expect(nameExpr.reconstruct()).toBe("MoveRing");

    const typeArgs = typeApp.children[1] as GreenNode;
    expect(typeArgs.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(typeArgs.reconstruct()).toBe("[Packet]");

    expect(callTarget.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((callTarget.children[2] as GreenToken).lexeme).toBe("new");

    const argList = node.children[1] as GreenNode;
    expect(argList.kind).toBe(SyntaxKind.CallArgumentList);
    expect(argList.reconstruct()).toBe("(max=64)");

    expect(node.reconstruct()).toBe("MoveRing[Packet].new(max=64)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("member access on call result", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      makeToken(TokenKind.Equals, "=", 5, 6),
      makeToken(TokenKind.IntegerLiteral, "1", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Dot, ".", 8, 9),
      makeToken(TokenKind.Identifier, "bar", 9, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.CallExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("bar");
    expect(node.reconstruct()).toBe("foo(a=1).bar");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("object literal preserves multiline newlines", () => {
    const tokens = [
      makeToken(TokenKind.LeftBrace, "{", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Identifier, "name", 2, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Comma, ",", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Identifier, "size", 10, 14),
      makeToken(TokenKind.Colon, ":", 14, 15),
      makeToken(TokenKind.IntegerLiteral, "10", 15, 17),
      makeToken(TokenKind.Comma, ",", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.RightBrace, "}", 19, 20),
      makeToken(TokenKind.Eof, "", 20, 20),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ObjectLiteralExpression);
    expect(node.reconstruct()).toBe("{\nname:x,\nsize:10,\n}");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovery: missing closing bracket in type application produces diagnostic", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Foo", 0, 3),
      makeToken(TokenKind.LeftBracket, "[", 3, 4),
      makeToken(TokenKind.Identifier, "Bar", 4, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.TypeApplicationExpression);
    expect(node.reconstruct()).toBe("Foo[Bar");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

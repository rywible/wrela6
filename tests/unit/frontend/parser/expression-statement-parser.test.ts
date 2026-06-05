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
import { parseExpressionOrAssignmentStatement } from "../../../../src/frontend/parser/expression-statement-parser";

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

describe("parseExpressionOrAssignmentStatement", () => {
  test("expression statement with identifier and newline", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("x\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("expression statement without trailing newline", () => {
    const tokens = [makeToken(TokenKind.Identifier, "x", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("assignment statement: name = expr newline", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Equals, "=", 1, 2),
      makeToken(TokenKind.IntegerLiteral, "42", 2, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.AssignmentStatement);
    expect(node.children).toHaveLength(4);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("x");
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[1] as GreenToken).lexeme).toBe("=");
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect((node.children[2] as GreenNode).reconstruct()).toBe("42");
    expect(node.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node.reconstruct()).toBe("x=42\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("assignment without trailing newline", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Equals, "=", 1, 2),
      makeToken(TokenKind.IntegerLiteral, "42", 2, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.AssignmentStatement);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("x");
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[2] as GreenNode).reconstruct()).toBe("42");
    expect(node.reconstruct()).toBe("x=42");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("member access on left side of assignment", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Dot, ".", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Equals, "=", 3, 4),
      makeToken(TokenKind.Identifier, "value", 4, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Eof, "", 10, 10),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.AssignmentStatement);
    const target = node.children[0] as GreenNode;
    expect(target.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(target.reconstruct()).toBe("a.b");
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[2] as GreenNode).reconstruct()).toBe("value");
    expect(node.children[3]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("a.b=value\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("call expression as statement", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.RightParen, ")", 4, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.CallExpression);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("foo()");
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("foo()\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("comparison equality (==) is not confused with assignment", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.EqualsEquals, "==", 1, 3),
      makeToken(TokenKind.IntegerLiteral, "5", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.EqualityExpression);
    expect(node.reconstruct()).toBe("x==5\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("chained assignment: first = creates assignment, second = is not consumed", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Equals, "=", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Equals, "=", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    // Only the first = is consumed; the second = and remaining tokens stay in the stream
    expect(node.kind).toBe(SyntaxKind.AssignmentStatement);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("a");
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[2] as GreenNode).reconstruct()).toBe("b");
    expect(node.reconstruct()).toBe("a=b");

    // The remaining tokens (= c \n) should still be in the context
    expect(context.currentSyntaxKind()).toBe(SyntaxKind.EqualsToken);
  });

  test("string literal expression statement", () => {
    const tokens = [
      makeToken(TokenKind.StringLiteral, '"hello"', 0, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.reconstruct()).toBe('"hello"\n');
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("object literal expression statement", () => {
    const tokens = [
      makeToken(TokenKind.LeftBrace, "{", 0, 1),
      makeToken(TokenKind.RightBrace, "}", 1, 2),
      makeToken(TokenKind.Newline, "\n", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.ObjectLiteralExpression);
    expect(node.reconstruct()).toBe("{}\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("unary expression statement", () => {
    const tokens = [
      makeToken(TokenKind.Minus, "-", 0, 1),
      makeToken(TokenKind.IntegerLiteral, "1", 1, 2),
      makeToken(TokenKind.Newline, "\n", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.ExpressionStatement);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.UnaryExpression);
    expect(node.reconstruct()).toBe("-1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction produces exact source", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "counter", 0, 7),
      makeToken(TokenKind.Equals, "=", 7, 8),
      makeToken(TokenKind.Identifier, "counter", 8, 15),
      makeToken(TokenKind.Plus, "+", 15, 16),
      makeToken(TokenKind.IntegerLiteral, "1", 16, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionOrAssignmentStatement(context);

    expect(node.kind).toBe(SyntaxKind.AssignmentStatement);
    expect(node.reconstruct()).toBe("counter=counter+1\n");
  });
});

import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import type { ExpressionContext } from "../../../../src/frontend/parser/expression-parser";
import {
  parseExpression,
  parseExpressionWithContext,
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

function eof(end: number): Token {
  return makeToken(TokenKind.Eof, "", end, end);
}

const ELSE_CONTEXT: ExpressionContext = {
  minimumBindingPower: 0,
  allowElseRequirement: true,
  allowDeriveArrow: false,
  stopBeforeFatArrow: false,
  stopKinds: new Set([
    SyntaxKind.NewlineToken,
    SyntaxKind.IndentToken,
    SyntaxKind.DedentToken,
    SyntaxKind.EndOfFileToken,
    SyntaxKind.CommaToken,
    SyntaxKind.RightParenToken,
    SyntaxKind.RightBracketToken,
    SyntaxKind.RightBraceToken,
    SyntaxKind.ColonToken,
  ]),
};

const DERIVE_CONTEXT: ExpressionContext = {
  minimumBindingPower: 0,
  allowElseRequirement: false,
  allowDeriveArrow: true,
  stopBeforeFatArrow: false,
  stopKinds: new Set([
    SyntaxKind.NewlineToken,
    SyntaxKind.IndentToken,
    SyntaxKind.DedentToken,
    SyntaxKind.EndOfFileToken,
    SyntaxKind.CommaToken,
    SyntaxKind.RightParenToken,
    SyntaxKind.RightBracketToken,
    SyntaxKind.RightBraceToken,
    SyntaxKind.ColonToken,
  ]),
};

describe("binary arithmetic", () => {
  test("addition", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("a+b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("subtraction", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Minus, "-", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.MinusToken);
    expect(node.reconstruct()).toBe("a-b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("multiplication", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Star, "*", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.StarToken);
    expect(node.reconstruct()).toBe("a*b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("division", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Slash, "/", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.SlashToken);
    expect(node.reconstruct()).toBe("a/b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("modulo", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Percent, "%", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PercentToken);
    expect(node.reconstruct()).toBe("a%b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("precedence: multiplication before addition", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Star, "*", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    const right = node.children[2] as GreenNode;
    expect(right.kind).toBe(SyntaxKind.BinaryExpression);
    expect(right.children[1]!.kind).toBe(SyntaxKind.StarToken);
    expect(node.reconstruct()).toBe("a+b*c");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("precedence: addition before multiplication", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Star, "*", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Plus, "+", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.BinaryExpression);
    expect(left.children[1]!.kind).toBe(SyntaxKind.StarToken);
    expect(node.reconstruct()).toBe("a*b+c");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("left-associativity: a+b+c parses as (a+b)+c", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Plus, "+", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.BinaryExpression);
    expect(left.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    expect(node.reconstruct()).toBe("a+b+c");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("boolean and bitwise expressions", () => {
  test("true literal parses as a literal expression", () => {
    const tokens = [makeToken(TokenKind.True, "true", 0, 4), eof(4)];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children[0]!.kind).toBe(SyntaxKind.TrueKeyword);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("and parses below equality for short-circuit logical expressions", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.EqualsEquals, "==", 2, 4),
      makeToken(TokenKind.Identifier, "b", 5, 6),
      makeToken(TokenKind.And, "and", 7, 10),
      makeToken(TokenKind.Identifier, "c", 11, 12),
      eof(12),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.AndKeyword);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.EqualityExpression);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("or parses below and for short-circuit logical expressions", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Or, "or", 2, 4),
      makeToken(TokenKind.Identifier, "b", 5, 6),
      makeToken(TokenKind.And, "and", 7, 10),
      makeToken(TokenKind.Identifier, "c", 11, 12),
      eof(12),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.OrKeyword);
    const right = node.children[2] as GreenNode;
    expect(right.kind).toBe(SyntaxKind.BinaryExpression);
    expect(right.children[1]!.kind).toBe(SyntaxKind.AndKeyword);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("bitwise and binds tighter than equality", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Ampersand, "&", 2, 3),
      makeToken(TokenKind.Identifier, "b", 4, 5),
      makeToken(TokenKind.EqualsEquals, "==", 6, 8),
      makeToken(TokenKind.Identifier, "c", 9, 10),
      eof(10),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.EqualityExpression);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.BinaryExpression);
    expect((node.children[0] as GreenNode).children[1]!.kind).toBe(SyntaxKind.AmpersandToken);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("bitwise shifts bind tighter than addition", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 2, 3),
      makeToken(TokenKind.Identifier, "b", 4, 5),
      makeToken(TokenKind.LeftShift, "<<", 6, 8),
      makeToken(TokenKind.Identifier, "c", 9, 10),
      eof(10),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    const right = node.children[2] as GreenNode;
    expect(right.kind).toBe(SyntaxKind.BinaryExpression);
    expect(right.children[1]!.kind).toBe(SyntaxKind.LeftShiftToken);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("bitwise not parses as unary expression", () => {
    const tokens = [
      makeToken(TokenKind.Tilde, "~", 0, 1),
      makeToken(TokenKind.Identifier, "mask", 1, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.UnaryExpression);
    expect(node.children[0]!.kind).toBe(SyntaxKind.TildeToken);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("comparison expressions", () => {
  test("less than", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Less, "<", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.LessToken);
    expect(node.reconstruct()).toBe("a<b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("less equals", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.LessEquals, "<=", 1, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      eof(4),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.LessEqualsToken);
    expect(node.reconstruct()).toBe("a<=b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("greater than", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Greater, ">", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.GreaterToken);
    expect(node.reconstruct()).toBe("a>b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("greater equals", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.GreaterEquals, ">=", 1, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      eof(4),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.GreaterEqualsToken);
    expect(node.reconstruct()).toBe("a>=b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("equality expressions", () => {
  test("equals equals", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.EqualsEquals, "==", 1, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      eof(4),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.EqualityExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsEqualsToken);
    expect(node.reconstruct()).toBe("a==b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("bang equals", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.BangEquals, "!=", 1, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      eof(4),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.EqualityExpression);
    expect(node.children[1]!.kind);
    expect(node.reconstruct()).toBe("a!=b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("non-associative chaining", () => {
  test("chained comparison produces error node with diagnostic", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Less, "<", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Greater, ">", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ErrorNode);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.ComparisonExpression);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("a<b");
    expect(node.children[1]!.kind).toBe(SyntaxKind.GreaterToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("a<b>c");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_UNEXPECTED_TOKEN");
  });

  test("chained equality produces error node with diagnostic", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.EqualsEquals, "==", 1, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      makeToken(TokenKind.BangEquals, "!=", 4, 6),
      makeToken(TokenKind.Identifier, "c", 6, 7),
      eof(7),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ErrorNode);
    expect(node.reconstruct()).toBe("a==b!=c");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_UNEXPECTED_TOKEN");
  });
});

describe("unary expressions", () => {
  test("unary minus", () => {
    const tokens = [
      makeToken(TokenKind.Minus, "-", 0, 1),
      makeToken(TokenKind.Identifier, "a", 1, 2),
      eof(2),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.UnaryExpression);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.MinusToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("-a");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("unary not", () => {
    const tokens = [
      makeToken(TokenKind.Not, "not", 0, 3),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.UnaryExpression);
    expect(node.children[0]!.kind).toBe(SyntaxKind.NotKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("nota");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("unary has higher precedence than binary: -a+b parses as (-a)+b", () => {
    const tokens = [
      makeToken(TokenKind.Minus, "-", 0, 1),
      makeToken(TokenKind.Identifier, "a", 1, 2),
      makeToken(TokenKind.Plus, "+", 2, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      eof(4),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.PlusToken);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.UnaryExpression);
    expect(left.children[0]!.kind).toBe(SyntaxKind.MinusToken);
    expect(node.reconstruct()).toBe("-a+b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("not binds tighter than equality: not a == b parses as (not a) == b", () => {
    const tokens = [
      makeToken(TokenKind.Not, "not", 0, 3),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      makeToken(TokenKind.EqualsEquals, "==", 5, 7),
      makeToken(TokenKind.Identifier, "b", 7, 8),
      eof(8),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.EqualityExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.EqualsEqualsToken);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.UnaryExpression);
    expect(left.children[0]!.kind).toBe(SyntaxKind.NotKeyword);
    expect(node.reconstruct()).toBe("nota==b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("postfix attempt", () => {
  test("attempt expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Question, "?", 1, 2),
      makeToken(TokenKind.Identifier, "B", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.AttemptExpression);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect((node.children[0] as GreenNode).reconstruct()).toBe("a");
    expect(node.children[1]!.kind).toBe(SyntaxKind.QuestionToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect((node.children[2] as GreenNode).reconstruct()).toBe("B");
    expect(node.reconstruct()).toBe("a?B");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("attempt with member access on left", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Dot, ".", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Question, "?", 3, 4),
      makeToken(TokenKind.Identifier, "C", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.AttemptExpression);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(left.reconstruct()).toBe("a.b");
    expect(node.children[2] as GreenNode).toBeDefined();
    expect(node.reconstruct()).toBe("a.b?C");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("attempt with call on left", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.RightParen, ")", 4, 5),
      makeToken(TokenKind.Question, "?", 5, 6),
      makeToken(TokenKind.Identifier, "Err", 6, 9),
      eof(9),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.AttemptExpression);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.CallExpression);
    expect(node.reconstruct()).toBe("foo()?Err");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("else requirement expression", () => {
  test("else requirement with allowElseRequirement=true", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.GreaterEquals, ">=", 1, 3),
      makeToken(TokenKind.IntegerLiteral, "2", 3, 4),
      makeToken(TokenKind.Else, "else", 5, 9),
      makeToken(TokenKind.Identifier, "b", 10, 11),
      eof(11),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionWithContext(context, ELSE_CONTEXT);

    expect(node.kind).toBe(SyntaxKind.ElseRequirementExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.ElseKeyword);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(left.reconstruct()).toBe("a>=2");
    const right = node.children[2] as GreenNode;
    expect(right.kind).toBe(SyntaxKind.NameExpression);
    expect(right.reconstruct()).toBe("b");
    expect(node.reconstruct()).toBe("a>=2elseb");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("else does not parse in default context", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Else, "else", 2, 6),
      makeToken(TokenKind.Identifier, "b", 7, 8),
      eof(8),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("a");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("derive arrow expression", () => {
  test("arrow with allowDeriveArrow=true", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "0", 0, 1),
      makeToken(TokenKind.FatArrow, "=>", 1, 3),
      makeToken(TokenKind.Identifier, "PacketKind", 3, 13),
      makeToken(TokenKind.Dot, ".", 13, 14),
      makeToken(TokenKind.Identifier, "ping", 14, 18),
      eof(18),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionWithContext(context, DERIVE_CONTEXT);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node.reconstruct()).toBe("0=>PacketKind.ping");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("arrow stops expression when stopBeforeFatArrow is true", () => {
    const contextWithStop: ExpressionContext = {
      minimumBindingPower: 0,
      allowElseRequirement: false,
      allowDeriveArrow: false,
      stopBeforeFatArrow: true,
      stopKinds: new Set([
        SyntaxKind.NewlineToken,
        SyntaxKind.IndentToken,
        SyntaxKind.DedentToken,
        SyntaxKind.EndOfFileToken,
        SyntaxKind.CommaToken,
        SyntaxKind.RightParenToken,
        SyntaxKind.RightBracketToken,
        SyntaxKind.RightBraceToken,
        SyntaxKind.ColonToken,
      ]),
    };
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.FatArrow, "=>", 3, 5),
      makeToken(TokenKind.Identifier, "c", 5, 6),
      eof(6),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionWithContext(context, contextWithStop);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.reconstruct()).toBe("a+b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("expression stopping rules", () => {
  test("stops at newline", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Newline, "\n", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
    expect(node.reconstruct()).toBe("a+b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("stops at comma", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Comma, ",", 1, 2),
      makeToken(TokenKind.Identifier, "y", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("stops at right paren", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.RightParen, ")", 1, 2),
      eof(2),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("stops at right brace", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.RightBrace, "}", 1, 2),
      eof(2),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("stops at colon", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Colon, ":", 1, 2),
      eof(2),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("combined precedence", () => {
  test("comparison binds tighter than else", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.GreaterEquals, ">=", 1, 3),
      makeToken(TokenKind.IntegerLiteral, "2", 3, 4),
      makeToken(TokenKind.Else, "else", 5, 9),
      makeToken(TokenKind.Identifier, "b", 10, 11),
      eof(11),
    ];
    const context = makeContext(tokens);
    const node = parseExpressionWithContext(context, ELSE_CONTEXT);

    expect(node.kind).toBe(SyntaxKind.ElseRequirementExpression);
    const left = node.children[0] as GreenNode;
    expect(left.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(left.reconstruct()).toBe("a>=2");
    expect(node.reconstruct()).toBe("a>=2elseb");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("comparison and equality work with primary expressions", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "1", 0, 1),
      makeToken(TokenKind.Less, "<", 1, 2),
      makeToken(TokenKind.Identifier, "x", 2, 3),
      eof(3),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node.reconstruct()).toBe("1<x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("reconstruction equals source", () => {
  test("complete arithmetic expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Plus, "+", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Star, "*", 3, 4),
      makeToken(TokenKind.Identifier, "c", 4, 5),
      makeToken(TokenKind.Minus, "-", 5, 6),
      makeToken(TokenKind.Identifier, "d", 6, 7),
      eof(7),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.reconstruct()).toBe("a+b*c-d");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("complex expression with unary", () => {
    const tokens = [
      makeToken(TokenKind.Minus, "-", 0, 1),
      makeToken(TokenKind.Identifier, "a", 1, 2),
      makeToken(TokenKind.Star, "*", 2, 3),
      makeToken(TokenKind.Identifier, "b", 3, 4),
      makeToken(TokenKind.Plus, "+", 4, 5),
      makeToken(TokenKind.IntegerLiteral, "1", 5, 6),
      eof(6),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.reconstruct()).toBe("-a*b+1");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("chained comparison reconstructs fully", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Less, "<", 1, 2),
      makeToken(TokenKind.IntegerLiteral, "5", 2, 3),
      makeToken(TokenKind.Greater, ">", 3, 4),
      makeToken(TokenKind.IntegerLiteral, "0", 4, 5),
      eof(5),
    ];
    const context = makeContext(tokens);
    const node = parseExpression(context);

    expect(node.reconstruct()).toBe("x<5>0");
  });
});

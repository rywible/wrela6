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
  parsePattern,
  parsePatternList,
  parseCondition,
} from "../../../../src/frontend/parser/pattern-parser";

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
  const stream = TokenStream.from(tokens);
  const factory = new SyntaxFactory();
  return new ParserContext({ tokens: stream, factory });
}

describe("parsePattern", () => {
  test("parses a simple identifier pattern", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "foo", 0, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(1);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect(qName.children).toHaveLength(1);
    expect((qName.children[0] as GreenToken).lexeme).toBe("foo");
    expect(node.reconstruct()).toBe("foo");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a qualified name pattern like PacketKind.ping", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "PacketKind", 0, 10),
      makeToken(TokenKind.Dot, ".", 10, 11),
      makeToken(TokenKind.Identifier, "ping", 11, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(1);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect(qName.children).toHaveLength(3);
    expect((qName.children[0] as GreenToken).lexeme).toBe("PacketKind");
    expect(qName.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect((qName.children[2] as GreenToken).lexeme).toBe("ping");
    expect(node.reconstruct()).toBe("PacketKind.ping");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a constructor pattern Ok(packet)", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Ok", 0, 2),
      makeToken(TokenKind.LeftParen, "(", 2, 3),
      makeToken(TokenKind.Identifier, "packet", 3, 9),
      makeToken(TokenKind.RightParen, ")", 9, 10),
      makeToken(TokenKind.Eof, "", 10, 10),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(4);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect((qName.children[0] as GreenToken).lexeme).toBe("Ok");
    expect(node.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    const innerPatternList = node.children[2] as GreenNode;
    expect(innerPatternList.kind).toBe(SyntaxKind.PatternList);
    const innerPattern = innerPatternList.children[0] as GreenNode;
    expect(innerPattern.kind).toBe(SyntaxKind.Pattern);
    expect(((innerPattern.children[0] as GreenNode).children[0] as GreenToken).lexeme).toBe(
      "packet",
    );
    expect(node.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("Ok(packet)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses constructor pattern with multiple args Foo(a, b)", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "a", 4, 5),
      makeToken(TokenKind.Comma, ",", 5, 6),
      makeToken(TokenKind.Identifier, "b", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    const patternList = node.children[2] as GreenNode;
    expect(patternList.kind).toBe(SyntaxKind.PatternList);
    expect(patternList.children).toHaveLength(3);
    expect((patternList.children[0] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(patternList.children[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect((patternList.children[2] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("Foo(a,b)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses empty parens as constructor with no pattern list", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Unit", 0, 4),
      makeToken(TokenKind.LeftParen, "(", 4, 5),
      makeToken(TokenKind.RightParen, ")", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("Unit()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parsePatternList", () => {
  test("parses a single pattern in a list", () => {
    const tokens = [makeToken(TokenKind.Identifier, "a", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parsePatternList(context);

    expect(node.kind).toBe(SyntaxKind.PatternList);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.reconstruct()).toBe("a");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple patterns with commas", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Comma, ",", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parsePatternList(context);

    expect(node.kind).toBe(SyntaxKind.PatternList);
    expect(node.children).toHaveLength(3);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.reconstruct()).toBe("a,b");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves trailing comma in pattern list", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "a", 0, 1),
      makeToken(TokenKind.Comma, ",", 1, 2),
      makeToken(TokenKind.Identifier, "b", 2, 3),
      makeToken(TokenKind.Comma, ",", 3, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parsePatternList(context);

    expect(node.kind).toBe(SyntaxKind.PatternList);
    expect(node.children).toHaveLength(4);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[3]!.kind).toBe(SyntaxKind.CommaToken);
    expect(node.reconstruct()).toBe("a,b,");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseCondition", () => {
  test("parses a condition with let pattern = expression", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "x", 4, 5),
      makeToken(TokenKind.Equals, "=", 6, 7),
      makeToken(TokenKind.IntegerLiteral, "42", 8, 10),
      makeToken(TokenKind.Eof, "", 10, 10),
    ];
    const context = makeContext(tokens);
    const node = parseCondition(context);

    expect(node.kind).toBe(SyntaxKind.Condition);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[2]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.reconstruct()).toBe("letx=42");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a plain expression condition", () => {
    const tokens = [makeToken(TokenKind.Identifier, "x", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseCondition(context);

    expect(node.kind).toBe(SyntaxKind.Condition);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("condition with constructor pattern", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "Ok", 4, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "val", 7, 10),
      makeToken(TokenKind.RightParen, ")", 10, 11),
      makeToken(TokenKind.Equals, "=", 11, 12),
      makeToken(TokenKind.Identifier, "result", 13, 19),
      makeToken(TokenKind.Eof, "", 19, 19),
    ];
    const context = makeContext(tokens);
    const node = parseCondition(context);

    expect(node.kind).toBe(SyntaxKind.Condition);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    const pattern = node.children[1] as GreenNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    expect(pattern.children).toHaveLength(4);
    expect(pattern.children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(pattern.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((pattern.children[2] as GreenNode).kind).toBe(SyntaxKind.PatternList);
    expect(pattern.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.EqualsToken);
    expect(node.reconstruct()).toBe("letOk(val)=result");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("recovery", () => {
  test("missing closing paren in pattern recovers", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Foo", 0, 3),
      makeToken(TokenKind.LeftParen, "(", 3, 4),
      makeToken(TokenKind.Identifier, "x", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    const patternList = node.children[2] as GreenNode;
    expect(patternList.kind).toBe(SyntaxKind.PatternList);
    expect(patternList.children).toHaveLength(1);
    expect((patternList.children[0] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect((node.children[3] as GreenToken).isMissing).toBe(true);
    expect(node.reconstruct()).toBe("Foo(x");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("condition stops at colon", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Colon, ":", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseCondition(context);

    expect(node.kind).toBe(SyntaxKind.Condition);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "Ok", 4, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "val", 7, 10),
      makeToken(TokenKind.RightParen, ")", 10, 11),
      makeToken(TokenKind.Equals, "=", 12, 13),
      makeToken(TokenKind.Identifier, "compute", 14, 21),
      makeToken(TokenKind.LeftParen, "(", 21, 22),
      makeToken(TokenKind.RightParen, ")", 22, 23),
      makeToken(TokenKind.Eof, "", 23, 23),
    ];
    const context = makeContext(tokens);
    const node = parseCondition(context);

    expect(node.kind).toBe(SyntaxKind.Condition);
    expect(node.reconstruct()).toBe("letOk(val)=compute()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("self is parsed as a qualified name pattern", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "self", 0, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(1);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect((qName.children[0] as GreenToken).lexeme).toBe("self");
    expect(node.reconstruct()).toBe("self");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("qualified name pattern as case condition Case PacketKind.ping", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "PacketKind", 0, 10),
      makeToken(TokenKind.Dot, ".", 10, 11),
      makeToken(TokenKind.Identifier, "ping", 11, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parsePattern(context);

    expect(node.kind).toBe(SyntaxKind.Pattern);
    expect(node.children).toHaveLength(1);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect(qName.reconstruct()).toBe("PacketKind.ping");
    expect(node.reconstruct()).toBe("PacketKind.ping");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

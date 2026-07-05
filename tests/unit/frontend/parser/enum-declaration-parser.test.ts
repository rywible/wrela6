import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import type { GreenElement } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import {
  parseEnumDeclaration,
  parseEnumCase,
} from "../../../../src/frontend/parser/enum-declaration-parser";

function makeToken(
  kind: TokenKind,
  lexeme: string,
  start: number,
  end: number,
  trailing?: string,
  leading?: string,
): Token {
  const leadingTrivia: Trivia[] = leading
    ? [
        new Trivia({
          kind: TriviaKind.Whitespace,
          lexeme: leading,
          span: SourceSpan.from(start - leading.length, start),
        }),
      ]
    : [];
  const trailingTrivia: Trivia[] = trailing
    ? [
        new Trivia({
          kind: TriviaKind.Whitespace,
          lexeme: trailing,
          span: SourceSpan.from(end, end + trailing.length),
        }),
      ]
    : [];
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia,
    trailingTrivia,
  });
}

function makeContext(tokens: Token[]): ParserContext {
  return new ParserContext({ tokens: TokenStream.from(tokens), factory: new SyntaxFactory() });
}

function assertEnumCase(node: GreenElement, lexeme: string): void {
  expect(node.kind).toBe(SyntaxKind.EnumCase);
  const name = (node as GreenNode).children[0] as GreenToken;
  expect(name.kind).toBe(SyntaxKind.IdentifierToken);
  expect(name.lexeme).toBe(lexeme);
  expect((node as GreenNode).children[1]?.kind).toBe(SyntaxKind.NewlineToken);
}

describe("parseEnumDeclaration", () => {
  test("parses enum with single case", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Foo", 5, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "    ", 10, 14),
      makeToken(TokenKind.Identifier, "bar", 14, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Dedent, "", 18, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.EnumKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("enum");
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[1] as GreenToken).lexeme).toBe("Foo");
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[3] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    expect(block.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(block.children[1]!.kind).toBe(SyntaxKind.IndentToken);

    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(1);

    assertEnumCase(stmtList.children[0]!, "bar");
    expect(block.children[3]!.kind).toBe(SyntaxKind.DedentToken);

    expect(node.reconstruct()).toBe("enum Foo:\n    bar\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses enum with multiple cases", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Color", 5, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Indent, "    ", 12, 16),
      makeToken(TokenKind.Identifier, "red", 16, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Identifier, "green", 24, 29, undefined, "    "),
      makeToken(TokenKind.Newline, "\n", 29, 30),
      makeToken(TokenKind.Identifier, "blue", 34, 38, undefined, "    "),
      makeToken(TokenKind.Newline, "\n", 38, 39),
      makeToken(TokenKind.Dedent, "", 39, 39),
      makeToken(TokenKind.Eof, "", 39, 39),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(node.reconstruct()).toBe("enum Color:\n    red\n    green\n    blue\n");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(3);
    assertEnumCase(stmtList.children[0]!, "red");
    assertEnumCase(stmtList.children[1]!, "green");
    assertEnumCase(stmtList.children[2]!, "blue");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses generic enum type parameters before cases", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Result", 5, 11),
      makeToken(TokenKind.LeftBracket, "[", 11, 12),
      makeToken(TokenKind.Identifier, "Ok", 12, 14),
      makeToken(TokenKind.Comma, ",", 14, 15, " "),
      makeToken(TokenKind.Identifier, "Err", 16, 19),
      makeToken(TokenKind.RightBracket, "]", 19, 20),
      makeToken(TokenKind.Colon, ":", 20, 21),
      makeToken(TokenKind.Newline, "\n", 21, 22),
      makeToken(TokenKind.Indent, "    ", 22, 26),
      makeToken(TokenKind.Identifier, "ok", 26, 28),
      makeToken(TokenKind.LeftParen, "(", 28, 29),
      makeToken(TokenKind.Identifier, "value", 29, 34),
      makeToken(TokenKind.Colon, ":", 34, 35, " "),
      makeToken(TokenKind.Identifier, "Ok", 36, 38),
      makeToken(TokenKind.RightParen, ")", 38, 39),
      makeToken(TokenKind.Newline, "\n", 39, 40),
      makeToken(TokenKind.Identifier, "err", 44, 47, undefined, "    "),
      makeToken(TokenKind.LeftParen, "(", 47, 48),
      makeToken(TokenKind.Identifier, "error", 48, 53),
      makeToken(TokenKind.Colon, ":", 53, 54, " "),
      makeToken(TokenKind.Identifier, "Err", 55, 58),
      makeToken(TokenKind.RightParen, ")", 58, 59),
      makeToken(TokenKind.Newline, "\n", 59, 60),
      makeToken(TokenKind.Dedent, "", 60, 60),
      makeToken(TokenKind.Eof, "", 60, 60),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(node.children).toHaveLength(5);
    expect(node.children[2]!.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children[3]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node.reconstruct()).toBe(
      "enum Result[Ok, Err]:\n    ok(value: Ok)\n    err(error: Err)\n",
    );
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves blank lines inside enum body", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Foo", 5, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "    ", 10, 14),
      makeToken(TokenKind.Identifier, "bar", 14, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.Identifier, "baz", 23, 26, undefined, "    "),
      makeToken(TokenKind.Newline, "\n", 26, 27),
      makeToken(TokenKind.Dedent, "", 27, 27),
      makeToken(TokenKind.Eof, "", 27, 27),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EnumDeclaration);
    expect(node.reconstruct()).toBe("enum Foo:\n    bar\n\n    baz\n");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(3);
    assertEnumCase(stmtList.children[0]!, "bar");
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    assertEnumCase(stmtList.children[2]!, "baz");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovers from unexpected tokens in enum body", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Foo", 5, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "    ", 10, 14),
      makeToken(TokenKind.IntegerLiteral, "42", 14, 16),
      makeToken(TokenKind.Newline, "\n", 16, 17),
      makeToken(TokenKind.Identifier, "bar", 17, 20),
      makeToken(TokenKind.Newline, "\n", 20, 21),
      makeToken(TokenKind.Dedent, "", 21, 21),
      makeToken(TokenKind.Eof, "", 21, 21),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    expect(stmtList.children.length).toBeGreaterThanOrEqual(2);
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);
    expect(skipped.children).toHaveLength(1);
    expect(skipped.children[0]!.reconstruct()).toBe("42");

    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    assertEnumCase(stmtList.children[2]!, "bar");
    expect(context.draftDiagnostics().length).toBeGreaterThan(0);
  });

  test("emits diagnostic for missing colon", () => {
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Foo", 5, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EnumDeclaration);
    const diagnostics = context.draftDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("reconstruction equals source text", () => {
    const source = "enum Foo:\n    bar\n";
    const tokens = [
      makeToken(TokenKind.Enum, "enum", 0, 4, " "),
      makeToken(TokenKind.Identifier, "Foo", 5, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "    ", 10, 14),
      makeToken(TokenKind.Identifier, "bar", 14, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Dedent, "", 18, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseEnumDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseEnumCase", () => {
  test("parses an identifier as an enum case", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "bar", 0, 3),
      makeToken(TokenKind.Newline, "\n", 3, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parseEnumCase(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.EnumCase);
    expect(node!.children).toHaveLength(2);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node!.children[0] as GreenToken).lexeme).toBe("bar");
    expect(node!.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node!.reconstruct()).toBe("bar\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses payload fields after an enum case name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "ok", 0, 2),
      makeToken(TokenKind.LeftParen, "(", 2, 3),
      makeToken(TokenKind.Identifier, "value", 3, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "T", 10, 11, undefined, " "),
      makeToken(TokenKind.RightParen, ")", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseEnumCase(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.EnumCase);
    expect(node!.children.map((child) => child.kind)).toEqual([
      SyntaxKind.IdentifierToken,
      SyntaxKind.ParameterList,
      SyntaxKind.NewlineToken,
    ]);
    expect(node!.reconstruct()).toBe("ok(value: T)\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined for non-identifier token", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "42", 0, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const result = parseEnumCase(context);

    expect(result).toBeUndefined();
  });
});

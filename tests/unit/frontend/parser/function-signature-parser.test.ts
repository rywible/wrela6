import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import type { GreenElement } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import {
  parseFunctionSignature,
  parseFunctionModifierList,
  parseParameterList,
  parseParameter,
  parseReturnTypeClause,
} from "../../../../src/frontend/parser/function-signature-parser";

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

function reconstructElements(elements: GreenElement[]): string {
  return elements.map((element) => element.reconstruct()).join("");
}

describe("parseFunctionModifierList", () => {
  test("parses a single modifier", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7),
      makeToken(TokenKind.Fn, "fn", 8, 10),
      makeToken(TokenKind.Eof, "", 10, 10),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionModifierList(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.FunctionModifierList);
    expect(node!.children).toHaveLength(1);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.PrivateKeyword);
    expect((node!.children[0] as GreenToken).lexeme).toBe("private");
    expect(node!.reconstruct()).toBe("private");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple modifiers in source order", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7),
      makeToken(TokenKind.Platform, "platform", 8, 16),
      makeToken(TokenKind.Terminal, "terminal", 17, 25),
      makeToken(TokenKind.Fn, "fn", 26, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionModifierList(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.FunctionModifierList);
    expect(node!.children).toHaveLength(3);
    expect((node!.children[0] as GreenToken).lexeme).toBe("private");
    expect((node!.children[1] as GreenToken).lexeme).toBe("platform");
    expect((node!.children[2] as GreenToken).lexeme).toBe("terminal");
    expect(node!.reconstruct()).toBe("privateplatformterminal");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("includes predicate and constructor modifiers", () => {
    const tokens = [
      makeToken(TokenKind.Predicate, "predicate", 0, 9),
      makeToken(TokenKind.Constructor, "constructor", 10, 21),
      makeToken(TokenKind.Fn, "fn", 22, 24),
      makeToken(TokenKind.Eof, "", 24, 24),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionModifierList(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.FunctionModifierList);
    expect(node!.children).toHaveLength(2);
    expect((node!.children[0] as GreenToken).lexeme).toBe("predicate");
    expect((node!.children[1] as GreenToken).lexeme).toBe("constructor");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined when no modifier present", () => {
    const tokens = [makeToken(TokenKind.Fn, "fn", 0, 2), makeToken(TokenKind.Eof, "", 2, 2)];
    const context = makeContext(tokens);
    const node = parseFunctionModifierList(context);

    expect(node).toBeUndefined();
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseParameter", () => {
  test("parses a named parameter without type", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.RightParen, ")", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseParameter(context);

    expect(node.kind).toBe(SyntaxKind.Parameter);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("x");
    expect(node.reconstruct()).toBe("x");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a parameter with type annotation", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Colon, ":", 1, 2),
      makeToken(TokenKind.Identifier, "Int", 2, 5),
      makeToken(TokenKind.RightParen, ")", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseParameter(context);

    expect(node.kind).toBe(SyntaxKind.Parameter);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("x");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.reconstruct()).toBe("x:Int");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a consume parameter", () => {
    const tokens = [
      makeToken(TokenKind.Consume, "consume", 0, 7),
      makeToken(TokenKind.Identifier, "x", 8, 9),
      makeToken(TokenKind.Colon, ":", 9, 10),
      makeToken(TokenKind.Identifier, "Int", 10, 13),
      makeToken(TokenKind.RightParen, ")", 13, 14),
      makeToken(TokenKind.Eof, "", 14, 14),
    ];
    const context = makeContext(tokens);
    const node = parseParameter(context);

    expect(node.kind).toBe(SyntaxKind.Parameter);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ConsumeKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("consume");
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[1] as GreenToken).lexeme).toBe("x");
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.reconstruct()).toBe("consumex:Int");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses receiver-like self parameter", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "self", 0, 4),
      makeToken(TokenKind.RightParen, ")", 4, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const context = makeContext(tokens);
    const node = parseParameter(context);

    expect(node.kind).toBe(SyntaxKind.Parameter);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("self");
    expect(node.reconstruct()).toBe("self");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseParameterList", () => {
  test("parses empty parameter list", () => {
    const tokens = [
      makeToken(TokenKind.LeftParen, "(", 0, 1),
      makeToken(TokenKind.RightParen, ")", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseParameterList(context);

    expect(node.kind).toBe(SyntaxKind.ParameterList);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses single parameter", () => {
    const tokens = [
      makeToken(TokenKind.LeftParen, "(", 0, 1),
      makeToken(TokenKind.Identifier, "x", 1, 2),
      makeToken(TokenKind.Colon, ":", 2, 3),
      makeToken(TokenKind.Identifier, "Int", 3, 6),
      makeToken(TokenKind.RightParen, ")", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseParameterList(context);

    expect(node.kind).toBe(SyntaxKind.ParameterList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Parameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("(x:Int)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple parameters with comma", () => {
    const tokens = [
      makeToken(TokenKind.LeftParen, "(", 0, 1),
      makeToken(TokenKind.Identifier, "x", 1, 2),
      makeToken(TokenKind.Colon, ":", 2, 3),
      makeToken(TokenKind.Identifier, "Int", 3, 6),
      makeToken(TokenKind.Comma, ",", 6, 7),
      makeToken(TokenKind.Identifier, "y", 8, 9),
      makeToken(TokenKind.Colon, ":", 9, 10),
      makeToken(TokenKind.Identifier, "Bool", 10, 14),
      makeToken(TokenKind.RightParen, ")", 14, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseParameterList(context);

    expect(node.kind).toBe(SyntaxKind.ParameterList);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Parameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Parameter);
    expect(node.children[4]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("(x:Int,y:Bool)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves newline tokens in multiline parameter list", () => {
    const tokens = [
      makeToken(TokenKind.LeftParen, "(", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.Colon, ":", 4, 5),
      makeToken(TokenKind.Identifier, "Int", 5, 8),
      makeToken(TokenKind.Comma, ",", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Identifier, "y", 11, 12),
      makeToken(TokenKind.Colon, ":", 12, 13),
      makeToken(TokenKind.Identifier, "Bool", 13, 17),
      makeToken(TokenKind.Comma, ",", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.RightParen, ")", 19, 20),
      makeToken(TokenKind.Eof, "", 20, 20),
    ];
    const context = makeContext(tokens);
    const node = parseParameterList(context);

    expect(node.kind).toBe(SyntaxKind.ParameterList);
    expect(node.reconstruct()).toBe("(\n" + "x:Int,\n" + "y:Bool,\n" + ")");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("allows trailing comma", () => {
    const tokens = [
      makeToken(TokenKind.LeftParen, "(", 0, 1),
      makeToken(TokenKind.Identifier, "x", 1, 2),
      makeToken(TokenKind.Colon, ":", 2, 3),
      makeToken(TokenKind.Identifier, "Int", 3, 6),
      makeToken(TokenKind.Comma, ",", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parseParameterList(context);

    expect(node.kind).toBe(SyntaxKind.ParameterList);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Parameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect(node.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("(x:Int,)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseReturnTypeClause", () => {
  test("parses return type clause", () => {
    const tokens = [
      makeToken(TokenKind.Arrow, "->", 0, 2),
      makeToken(TokenKind.Identifier, "Bool", 3, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseReturnTypeClause(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.ReturnTypeClause);
    expect(node!.children).toHaveLength(2);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.ArrowToken);
    expect((node!.children[0] as GreenToken).lexeme).toBe("->");
    expect((node!.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node!.reconstruct()).toBe("->Bool");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined when no arrow present", () => {
    const tokens = [makeToken(TokenKind.Identifier, "x", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseReturnTypeClause(context);

    expect(node).toBeUndefined();
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseFunctionSignature", () => {
  test("parses simple signature fn foo()", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(3);
    expect(elements[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect((elements[0] as GreenToken).lexeme).toBe("fn");
    expect(elements[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((elements[1] as GreenToken).lexeme).toBe("foo");
    expect((elements[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect(reconstructElements(elements)).toBe("fnfoo()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with one parameter fn foo(x: Int)", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "Int", 9, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(3);
    expect(elements[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect(elements[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((elements[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect((elements[2] as GreenNode).reconstruct()).toBe("(x:Int)");
    expect(reconstructElements(elements)).toBe("fnfoo(x:Int)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with consume parameter fn foo(consume x: Int)", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Consume, "consume", 7, 14),
      makeToken(TokenKind.Identifier, "x", 15, 16),
      makeToken(TokenKind.Colon, ":", 16, 17),
      makeToken(TokenKind.Identifier, "Int", 17, 20),
      makeToken(TokenKind.RightParen, ")", 20, 21),
      makeToken(TokenKind.Eof, "", 21, 21),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(3);
    expect(reconstructElements(elements)).toBe("fnfoo(consumex:Int)");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with return type fn foo(x: Int) -> Bool", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "Int", 9, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Arrow, "->", 14, 16),
      makeToken(TokenKind.Identifier, "Bool", 17, 21),
      makeToken(TokenKind.Eof, "", 21, 21),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(4);
    expect((elements[3] as GreenNode).kind).toBe(SyntaxKind.ReturnTypeClause);
    expect(reconstructElements(elements)).toBe("fnfoo(x:Int)->Bool");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with type parameters fn foo[T](x: T) -> T", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftBracket, "[", 6, 7),
      makeToken(TokenKind.Identifier, "T", 7, 8),
      makeToken(TokenKind.RightBracket, "]", 8, 9),
      makeToken(TokenKind.LeftParen, "(", 9, 10),
      makeToken(TokenKind.Identifier, "x", 10, 11),
      makeToken(TokenKind.Colon, ":", 11, 12),
      makeToken(TokenKind.Identifier, "T", 12, 13),
      makeToken(TokenKind.RightParen, ")", 13, 14),
      makeToken(TokenKind.Arrow, "->", 15, 17),
      makeToken(TokenKind.Identifier, "T", 18, 19),
      makeToken(TokenKind.Eof, "", 19, 19),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(5);
    expect((elements[2] as GreenNode).kind).toBe(SyntaxKind.TypeParameterList);
    expect((elements[3] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect((elements[4] as GreenNode).kind).toBe(SyntaxKind.ReturnTypeClause);
    expect(reconstructElements(elements)).toBe("fnfoo[T](x:T)->T");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with modifier private fn foo()", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7),
      makeToken(TokenKind.Fn, "fn", 8, 10),
      makeToken(TokenKind.Identifier, "foo", 11, 14),
      makeToken(TokenKind.LeftParen, "(", 14, 15),
      makeToken(TokenKind.RightParen, ")", 15, 16),
      makeToken(TokenKind.Eof, "", 16, 16),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(4);
    expect((elements[0] as GreenNode).kind).toBe(SyntaxKind.FunctionModifierList);
    expect(elements[1]!.kind).toBe(SyntaxKind.FnKeyword);
    expect(elements[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((elements[3] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect(reconstructElements(elements)).toBe("privatefnfoo()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses signature with multiple modifiers private platform fn foo()", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7),
      makeToken(TokenKind.Platform, "platform", 8, 16),
      makeToken(TokenKind.Fn, "fn", 17, 19),
      makeToken(TokenKind.Identifier, "foo", 20, 23),
      makeToken(TokenKind.LeftParen, "(", 23, 24),
      makeToken(TokenKind.RightParen, ")", 24, 25),
      makeToken(TokenKind.Eof, "", 25, 25),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(4);
    const modList = elements[0] as GreenNode;
    expect(modList.kind).toBe(SyntaxKind.FunctionModifierList);
    expect(modList.children).toHaveLength(2);
    expect((modList.children[0] as GreenToken).lexeme).toBe("private");
    expect((modList.children[1] as GreenToken).lexeme).toBe("platform");
    expect(reconstructElements(elements)).toBe("privateplatformfnfoo()");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiline parameter list with newlines preserved", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Identifier, "x", 9, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Identifier, "Int", 11, 14),
      makeToken(TokenKind.Comma, ",", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.Identifier, "y", 17, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Identifier, "Bool", 19, 23),
      makeToken(TokenKind.Comma, ",", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.RightParen, ")", 25, 26),
      makeToken(TokenKind.Eof, "", 26, 26),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(3);
    expect(reconstructElements(elements)).toBe("fnfoo(\n" + "x:Int,\n" + "y:Bool,\n" + ")");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses return type after multiline parameter list", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Identifier, "x", 9, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Identifier, "Int", 11, 14),
      makeToken(TokenKind.Comma, ",", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.RightParen, ")", 16, 17),
      makeToken(TokenKind.Arrow, "->", 18, 20),
      makeToken(TokenKind.Identifier, "Bool", 21, 25),
      makeToken(TokenKind.Eof, "", 25, 25),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    expect(elements).toHaveLength(4);
    expect((elements[3] as GreenNode).kind).toBe(SyntaxKind.ReturnTypeClause);
    expect(reconstructElements(elements)).toBe("fnfoo(\n" + "x:Int,\n" + ")->Bool");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text for complete signature", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7),
      makeToken(TokenKind.Fn, "fn", 8, 10),
      makeToken(TokenKind.Identifier, "foo", 11, 14),
      makeToken(TokenKind.LeftBracket, "[", 14, 15),
      makeToken(TokenKind.Identifier, "T", 15, 16),
      makeToken(TokenKind.RightBracket, "]", 16, 17),
      makeToken(TokenKind.LeftParen, "(", 17, 18),
      makeToken(TokenKind.Identifier, "x", 18, 19),
      makeToken(TokenKind.Colon, ":", 19, 20),
      makeToken(TokenKind.Identifier, "T", 20, 21),
      makeToken(TokenKind.RightParen, ")", 21, 22),
      makeToken(TokenKind.Arrow, "->", 23, 25),
      makeToken(TokenKind.Identifier, "T", 26, 27),
      makeToken(TokenKind.Eof, "", 27, 27),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    const source = "privatefnfoo[T](x:T)->T";
    expect(reconstructElements(elements)).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text for multiline signature", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Identifier, "x", 9, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Identifier, "Int", 11, 14),
      makeToken(TokenKind.Comma, ",", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.RightParen, ")", 16, 17),
      makeToken(TokenKind.Arrow, "->", 18, 20),
      makeToken(TokenKind.Identifier, "Bool", 21, 25),
      makeToken(TokenKind.Eof, "", 25, 25),
    ];
    const context = makeContext(tokens);
    const elements = parseFunctionSignature(context);

    const source = "fnfoo(\n" + "x:Int,\n" + ")->Bool";
    expect(reconstructElements(elements)).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

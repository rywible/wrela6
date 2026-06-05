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
  parseDataclassDeclaration,
  parseClassDeclaration,
  parseInterfaceDeclaration,
  parseFieldDeclaration,
} from "../../../../src/frontend/parser/class-declaration-parser";

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

function assertField(node: GreenElement, name: string, typeName: string): void {
  expect(node.kind).toBe(SyntaxKind.FieldDeclaration);
  const children = (node as GreenNode).children;
  const nameToken = children[0] as GreenToken;
  expect(nameToken.kind).toBe(SyntaxKind.IdentifierToken);
  expect(nameToken.lexeme).toBe(name);
  const colonToken = children[1]!;
  expect(colonToken.kind).toBe(SyntaxKind.ColonToken);
  const typeRef = children[2] as GreenNode;
  expect(typeRef.kind).toBe(SyntaxKind.TypeReference);
  const qname = typeRef.children[0] as GreenNode;
  expect(qname.kind).toBe(SyntaxKind.QualifiedName);
  const typeIdent = qname.children[0] as GreenToken;
  expect(typeIdent.lexeme).toBe(typeName);
  expect(children[3]?.kind).toBe(SyntaxKind.NewlineToken);
}

describe("parseDataclassDeclaration", () => {
  test("parses dataclass with single field", () => {
    const tokens = [
      makeToken(TokenKind.Dataclass, "dataclass", 0, 9, " "),
      makeToken(TokenKind.Identifier, "PacketLimits", 10, 22),
      makeToken(TokenKind.Colon, ":", 22, 23),
      makeToken(TokenKind.Newline, "\n", 23, 24),
      makeToken(TokenKind.Indent, "    ", 24, 28),
      makeToken(TokenKind.Identifier, "max_size", 28, 36),
      makeToken(TokenKind.Colon, ":", 36, 37, " "),
      makeToken(TokenKind.Identifier, "u64", 38, 41),
      makeToken(TokenKind.Newline, "\n", 41, 42),
      makeToken(TokenKind.Dedent, "", 42, 42),
      makeToken(TokenKind.Eof, "", 42, 42),
    ];
    const context = makeContext(tokens);
    const node = parseDataclassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.DataclassDeclaration);
    expect((node.children[0] as GreenToken).lexeme).toBe("dataclass");
    expect((node.children[1] as GreenToken).lexeme).toBe("PacketLimits");
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[3] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    assertField(stmtList.children[0]!, "max_size", "u64");

    expect(node.reconstruct()).toBe("dataclass PacketLimits:\n    max_size: u64\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses dataclass with multiple fields", () => {
    const tokens = [
      makeToken(TokenKind.Dataclass, "dataclass", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Limits", 10, 16),
      makeToken(TokenKind.Colon, ":", 16, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Indent, "    ", 18, 22),
      makeToken(TokenKind.Identifier, "min", 22, 25),
      makeToken(TokenKind.Colon, ":", 25, 26, " "),
      makeToken(TokenKind.Identifier, "u64", 27, 30),
      makeToken(TokenKind.Newline, "\n", 30, 31),
      makeToken(TokenKind.Identifier, "max", 35, 38, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 38, 39, " "),
      makeToken(TokenKind.Identifier, "i32", 40, 43),
      makeToken(TokenKind.Newline, "\n", 43, 44),
      makeToken(TokenKind.Dedent, "", 44, 44),
      makeToken(TokenKind.Eof, "", 44, 44),
    ];
    const context = makeContext(tokens);
    const node = parseDataclassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.DataclassDeclaration);
    expect(node.reconstruct()).toBe("dataclass Limits:\n    min: u64\n    max: i32\n");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    assertField(stmtList.children[0]!, "min", "u64");
    assertField(stmtList.children[1]!, "max", "i32");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses dataclass with type parameters", () => {
    const tokens = [
      makeToken(TokenKind.Dataclass, "dataclass", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Opt", 10, 13),
      makeToken(TokenKind.LeftBracket, "[", 13, 14),
      makeToken(TokenKind.Identifier, "T", 14, 15),
      makeToken(TokenKind.RightBracket, "]", 15, 16),
      makeToken(TokenKind.Colon, ":", 16, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Indent, "    ", 18, 22),
      makeToken(TokenKind.Identifier, "value", 22, 27),
      makeToken(TokenKind.Colon, ":", 27, 28, " "),
      makeToken(TokenKind.Identifier, "T", 29, 30),
      makeToken(TokenKind.Newline, "\n", 30, 31),
      makeToken(TokenKind.Dedent, "", 31, 31),
      makeToken(TokenKind.Eof, "", 31, 31),
    ];
    const context = makeContext(tokens);
    const node = parseDataclassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.DataclassDeclaration);
    expect(node.children[2]!.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.reconstruct()).toBe("dataclass Opt[T]:\n    value: T\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovers from unexpected tokens in dataclass body", () => {
    const tokens = [
      makeToken(TokenKind.Dataclass, "dataclass", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Foo", 10, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.IntegerLiteral, "42", 19, 21),
      makeToken(TokenKind.Newline, "\n", 21, 22),
      makeToken(TokenKind.Identifier, "bar", 26, 29, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 29, 30, " "),
      makeToken(TokenKind.Identifier, "u8", 31, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Dedent, "", 34, 34),
      makeToken(TokenKind.Eof, "", 34, 34),
    ];
    const context = makeContext(tokens);
    const node = parseDataclassDeclaration(context);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    expect(stmtList.children.length).toBeGreaterThanOrEqual(3);
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);
    expect(skipped.children[0]!.reconstruct()).toBe("42");

    assertField(stmtList.children[2]!, "bar", "u8");
    expect(context.draftDiagnostics().length).toBeGreaterThan(0);
  });

  test("reconstruction equals source text", () => {
    const source = "dataclass Foo:\n    x: Int\n";
    const tokens = [
      makeToken(TokenKind.Dataclass, "dataclass", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Foo", 10, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.Identifier, "x", 19, 20),
      makeToken(TokenKind.Colon, ":", 20, 21, " "),
      makeToken(TokenKind.Identifier, "Int", 22, 25),
      makeToken(TokenKind.Newline, "\n", 25, 26),
      makeToken(TokenKind.Dedent, "", 26, 26),
      makeToken(TokenKind.Eof, "", 26, 26),
    ];
    const context = makeContext(tokens);
    const node = parseDataclassDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseClassDeclaration", () => {
  test("parses class with fields", () => {
    const tokens = [
      makeToken(TokenKind.Class, "class", 0, 5, " "),
      makeToken(TokenKind.Identifier, "MyClass", 6, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.Identifier, "field", 19, 24),
      makeToken(TokenKind.Colon, ":", 24, 25, " "),
      makeToken(TokenKind.Identifier, "u8", 26, 28),
      makeToken(TokenKind.Newline, "\n", 28, 29),
      makeToken(TokenKind.Dedent, "", 29, 29),
      makeToken(TokenKind.Eof, "", 29, 29),
    ];
    const context = makeContext(tokens);
    const node = parseClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ClassDeclaration);
    expect((node.children[0] as GreenToken).lexeme).toBe("class");
    expect((node.children[1] as GreenToken).lexeme).toBe("MyClass");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    assertField(stmtList.children[0]!, "field", "u8");

    expect(node.reconstruct()).toBe("class MyClass:\n    field: u8\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses private class", () => {
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7, " "),
      makeToken(TokenKind.Class, "class", 8, 13, " "),
      makeToken(TokenKind.Identifier, "RxBatchBuilder", 14, 28),
      makeToken(TokenKind.Colon, ":", 28, 29),
      makeToken(TokenKind.Newline, "\n", 29, 30),
      makeToken(TokenKind.Indent, "    ", 30, 34),
      makeToken(TokenKind.Identifier, "inner", 34, 39),
      makeToken(TokenKind.Colon, ":", 39, 40, " "),
      makeToken(TokenKind.Identifier, "InnerType", 41, 50),
      makeToken(TokenKind.Newline, "\n", 50, 51),
      makeToken(TokenKind.Dedent, "", 51, 51),
      makeToken(TokenKind.Eof, "", 51, 51),
    ];
    const context = makeContext(tokens);
    const node = parseClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ClassDeclaration);
    expect(node.children[0]!.kind).toBe(SyntaxKind.PrivateKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("private");
    expect((node.children[1] as GreenToken).lexeme).toBe("class");
    expect((node.children[2] as GreenToken).lexeme).toBe("RxBatchBuilder");

    expect(node.reconstruct()).toBe("private class RxBatchBuilder:\n    inner: InnerType\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses class with type parameters", () => {
    const tokens = [
      makeToken(TokenKind.Class, "class", 0, 5, " "),
      makeToken(TokenKind.Identifier, "Container", 6, 15),
      makeToken(TokenKind.LeftBracket, "[", 15, 16),
      makeToken(TokenKind.Identifier, "T", 16, 17),
      makeToken(TokenKind.RightBracket, "]", 17, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Identifier, "item", 24, 28),
      makeToken(TokenKind.Colon, ":", 28, 29, " "),
      makeToken(TokenKind.Identifier, "T", 30, 31),
      makeToken(TokenKind.Newline, "\n", 31, 32),
      makeToken(TokenKind.Dedent, "", 32, 32),
      makeToken(TokenKind.Eof, "", 32, 32),
    ];
    const context = makeContext(tokens);
    const node = parseClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ClassDeclaration);
    expect(node.children[2]!.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.reconstruct()).toBe("class Container[T]:\n    item: T\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text", () => {
    const source = "private class Foo:\n    x: Int\n";
    const tokens = [
      makeToken(TokenKind.Private, "private", 0, 7, " "),
      makeToken(TokenKind.Class, "class", 8, 13, " "),
      makeToken(TokenKind.Identifier, "Foo", 14, 17),
      makeToken(TokenKind.Colon, ":", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.Indent, "    ", 19, 23),
      makeToken(TokenKind.Identifier, "x", 23, 24),
      makeToken(TokenKind.Colon, ":", 24, 25, " "),
      makeToken(TokenKind.Identifier, "Int", 26, 29),
      makeToken(TokenKind.Newline, "\n", 29, 30),
      makeToken(TokenKind.Dedent, "", 30, 30),
      makeToken(TokenKind.Eof, "", 30, 30),
    ];
    const context = makeContext(tokens);
    const node = parseClassDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseInterfaceDeclaration", () => {
  test("parses interface with bodyless function", () => {
    const tokens = [
      makeToken(TokenKind.Interface, "interface", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Runnable", 10, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Fn, "fn", 24, 26, " "),
      makeToken(TokenKind.Identifier, "run", 27, 30),
      makeToken(TokenKind.LeftParen, "(", 30, 31),
      makeToken(TokenKind.RightParen, ")", 31, 32),
      makeToken(TokenKind.Newline, "\n", 32, 33),
      makeToken(TokenKind.Dedent, "", 33, 33),
      makeToken(TokenKind.Eof, "", 33, 33),
    ];
    const context = makeContext(tokens);
    const node = parseInterfaceDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.InterfaceDeclaration);
    expect((node.children[0] as GreenToken).lexeme).toBe("interface");
    expect((node.children[1] as GreenToken).lexeme).toBe("Runnable");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    const funcDecl = stmtList.children[0] as GreenNode;
    expect(funcDecl.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(funcDecl.children.at(-1)?.kind).toBe(SyntaxKind.NewlineToken);

    expect(node.reconstruct()).toBe("interface Runnable:\n    fn run()\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses interface with bodyless function with return type", () => {
    const tokens = [
      makeToken(TokenKind.Interface, "interface", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Runnable", 10, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Fn, "fn", 24, 26, " "),
      makeToken(TokenKind.Identifier, "run", 27, 30),
      makeToken(TokenKind.LeftParen, "(", 30, 31),
      makeToken(TokenKind.RightParen, ")", 31, 32, " "),
      makeToken(TokenKind.Arrow, "->", 33, 35, " "),
      makeToken(TokenKind.Identifier, "Result", 36, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseInterfaceDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.InterfaceDeclaration);
    expect(node.reconstruct()).toBe("interface Runnable:\n    fn run() -> Result\n");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    const funcDecl = stmtList.children[0] as GreenNode;
    expect(funcDecl.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(funcDecl.children.at(-1)?.kind).toBe(SyntaxKind.NewlineToken);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses interface with multiple bodyless functions", () => {
    const tokens = [
      makeToken(TokenKind.Interface, "interface", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Runnable", 10, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Fn, "fn", 24, 26, " "),
      makeToken(TokenKind.Identifier, "start", 27, 32),
      makeToken(TokenKind.LeftParen, "(", 32, 33),
      makeToken(TokenKind.RightParen, ")", 33, 34),
      makeToken(TokenKind.Newline, "\n", 34, 35),
      makeToken(TokenKind.Fn, "fn", 39, 41, " ", "    "),
      makeToken(TokenKind.Identifier, "stop", 42, 46),
      makeToken(TokenKind.LeftParen, "(", 45, 46),
      makeToken(TokenKind.RightParen, ")", 46, 47),
      makeToken(TokenKind.Newline, "\n", 47, 48),
      makeToken(TokenKind.Dedent, "", 48, 48),
      makeToken(TokenKind.Eof, "", 48, 48),
    ];
    const context = makeContext(tokens);
    const node = parseInterfaceDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.InterfaceDeclaration);
    expect(node.reconstruct()).toBe("interface Runnable:\n    fn start()\n    fn stop()\n");

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovers from unexpected tokens in interface body", () => {
    const tokens = [
      makeToken(TokenKind.Interface, "interface", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Foo", 10, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.IntegerLiteral, "42", 19, 21),
      makeToken(TokenKind.Newline, "\n", 21, 22),
      makeToken(TokenKind.Fn, "fn", 26, 28, " ", "    "),
      makeToken(TokenKind.Identifier, "run", 29, 32),
      makeToken(TokenKind.LeftParen, "(", 31, 32),
      makeToken(TokenKind.RightParen, ")", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Dedent, "", 34, 34),
      makeToken(TokenKind.Eof, "", 34, 34),
    ];
    const context = makeContext(tokens);
    const node = parseInterfaceDeclaration(context);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    expect(stmtList.children.length).toBeGreaterThanOrEqual(3);
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);

    expect(stmtList.children[2]!.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect((stmtList.children[2] as GreenNode).children.at(-1)?.kind).toBe(SyntaxKind.NewlineToken);
    expect(context.draftDiagnostics().length).toBeGreaterThan(0);
  });

  test("reconstruction equals source text", () => {
    const source = "interface Runnable:\n    fn run() -> Result\n";
    const tokens = [
      makeToken(TokenKind.Interface, "interface", 0, 9, " "),
      makeToken(TokenKind.Identifier, "Runnable", 10, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Fn, "fn", 24, 26, " "),
      makeToken(TokenKind.Identifier, "run", 27, 30),
      makeToken(TokenKind.LeftParen, "(", 30, 31),
      makeToken(TokenKind.RightParen, ")", 31, 32, " "),
      makeToken(TokenKind.Arrow, "->", 33, 35, " "),
      makeToken(TokenKind.Identifier, "Result", 36, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseInterfaceDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseFieldDeclaration", () => {
  test("parses field with identifier, colon, and type", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "name", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5, " "),
      makeToken(TokenKind.Identifier, "String", 6, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseFieldDeclaration(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.FieldDeclaration);
    expect(node!.children).toHaveLength(4);
    expect((node!.children[0] as GreenToken).lexeme).toBe("name");
    expect(node!.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.TypeReference);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node!.reconstruct()).toBe("name: String\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined for non-identifier token", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "42", 0, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const result = parseFieldDeclaration(context);

    expect(result).toBeUndefined();
  });

  test("parses field without trailing newline at end of input", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1),
      makeToken(TokenKind.Colon, ":", 1, 2, " "),
      makeToken(TokenKind.Identifier, "i32", 3, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseFieldDeclaration(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.FieldDeclaration);
    expect(node!.children).toHaveLength(3);
    expect(node!.reconstruct()).toBe("x: i32");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

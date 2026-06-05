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
  parseImportDeclaration,
  parseImportNameList,
  parseDottedModuleName,
} from "../../../../src/frontend/parser/import-declaration-parser";

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

describe("parseImportDeclaration", () => {
  test("parses single import with newline", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.From, "from", 8, 12),
      makeToken(TokenKind.Identifier, "bar", 13, 16),
      makeToken(TokenKind.Newline, "\n", 16, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);
    expect(node.children).toHaveLength(5);

    expect(node.children[0]!.kind).toBe(SyntaxKind.UseKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("use");

    const names = node.children[1] as GreenNode;
    expect(names.kind).toBe(SyntaxKind.ImportNameList);
    expect(names.children).toHaveLength(1);
    expect((names.children[0] as GreenToken).lexeme).toBe("Foo");

    expect(node.children[2]!.kind).toBe(SyntaxKind.FromKeyword);
    expect((node.children[2] as GreenToken).lexeme).toBe("from");

    const module = node.children[3] as GreenNode;
    expect(module.kind).toBe(SyntaxKind.DottedModuleName);
    expect(module.children).toHaveLength(1);
    expect((module.children[0] as GreenToken).lexeme).toBe("bar");

    expect(node.children[4]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses single import without trailing newline", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.From, "from", 8, 12),
      makeToken(TokenKind.Identifier, "bar", 13, 16),
      makeToken(TokenKind.Eof, "", 16, 16),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);
    expect(node.children).toHaveLength(4);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple imports with commas", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.Identifier, "Bar", 9, 12),
      makeToken(TokenKind.From, "from", 13, 17),
      makeToken(TokenKind.Identifier, "baz", 18, 21),
      makeToken(TokenKind.Newline, "\n", 21, 22),
      makeToken(TokenKind.Eof, "", 22, 22),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);

    const names = node.children[1] as GreenNode;
    expect(names.kind).toBe(SyntaxKind.ImportNameList);
    expect(names.children).toHaveLength(3);
    expect((names.children[0] as GreenToken).lexeme).toBe("Foo");
    expect(names.children[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect((names.children[2] as GreenToken).lexeme).toBe("Bar");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses dotted module name with keyword segment", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.From, "from", 8, 12),
      makeToken(TokenKind.Identifier, "core", 13, 17),
      makeToken(TokenKind.Dot, ".", 17, 18),
      makeToken(TokenKind.Uefi, "uefi", 18, 22),
      makeToken(TokenKind.Newline, "\n", 22, 23),
      makeToken(TokenKind.Eof, "", 23, 23),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);

    const module = node.children[3] as GreenNode;
    expect(module.kind).toBe(SyntaxKind.DottedModuleName);
    expect(module.children).toHaveLength(3);
    expect((module.children[0] as GreenToken).lexeme).toBe("core");
    expect(module.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(module.children[2]!.kind).toBe(SyntaxKind.UefiKeyword);
    expect((module.children[2] as GreenToken).lexeme).toBe("uefi");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reports diagnostic for missing import name", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.From, "from", 4, 8),
      makeToken(TokenKind.Identifier, "bar", 9, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);

    const names = node.children[1] as GreenNode;
    expect(names.kind).toBe(SyntaxKind.ImportNameList);
    expect(names.children).toHaveLength(1);
    expect((names.children[0] as GreenToken).isMissing).toBe(true);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((sourceDiagnostic) => sourceDiagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test("reports diagnostic for missing 'from' keyword", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.Identifier, "bar", 8, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);
    expect(node.children).toHaveLength(5);
    expect((node.children[2] as GreenToken).isMissing).toBe(true);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((sourceDiagnostic) => sourceDiagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test("reports diagnostic for missing module segment", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.From, "from", 8, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImportDeclaration);

    const module = node.children[3] as GreenNode;
    expect(module.kind).toBe(SyntaxKind.DottedModuleName);
    expect(module.children).toHaveLength(0);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((sourceDiagnostic) => sourceDiagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test("reconstruction concatenates lexemes in order", () => {
    const tokens = [
      makeToken(TokenKind.Use, "use", 0, 3),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.Identifier, "Bar", 9, 12),
      makeToken(TokenKind.From, "from", 13, 17),
      makeToken(TokenKind.Identifier, "std", 18, 22),
      makeToken(TokenKind.Dot, ".", 22, 23),
      makeToken(TokenKind.Uefi, "uefi", 23, 27),
      makeToken(TokenKind.Newline, "\n", 27, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseImportDeclaration(context);

    expect(node.reconstruct()).toBe("useFoo,Barfromstd.uefi\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseImportNameList", () => {
  test("parses single name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Foo", 0, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseImportNameList(context);

    expect(node.kind).toBe(SyntaxKind.ImportNameList);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenToken).lexeme).toBe("Foo");
    expect(node.reconstruct()).toBe("Foo");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple names with commas", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Foo", 0, 3),
      makeToken(TokenKind.Comma, ",", 3, 4),
      makeToken(TokenKind.Identifier, "Bar", 5, 8),
      makeToken(TokenKind.Comma, ",", 8, 9),
      makeToken(TokenKind.Identifier, "Baz", 10, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseImportNameList(context);

    expect(node.kind).toBe(SyntaxKind.ImportNameList);
    expect(node.children).toHaveLength(5);
    expect((node.children[0] as GreenToken).lexeme).toBe("Foo");
    expect(node.children[1]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("Bar");
    expect(node.children[3]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[4] as GreenToken).lexeme).toBe("Baz");
    expect(node.reconstruct()).toBe("Foo,Bar,Baz");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reports diagnostic for missing first name", () => {
    const tokens = [makeToken(TokenKind.Newline, "\n", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseImportNameList(context);

    expect(node.kind).toBe(SyntaxKind.ImportNameList);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenToken).isMissing).toBe(true);
    expect(context.draftDiagnostics()).toHaveLength(1);
  });
});

describe("parseDottedModuleName", () => {
  test("parses single segment", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "bar", 0, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseDottedModuleName(context);

    expect(node.kind).toBe(SyntaxKind.DottedModuleName);
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as GreenToken).lexeme).toBe("bar");
    expect(node.reconstruct()).toBe("bar");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses dotted segments with keyword tokens", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "core", 0, 4),
      makeToken(TokenKind.Dot, ".", 4, 5),
      makeToken(TokenKind.Uefi, "uefi", 5, 9),
      makeToken(TokenKind.Dot, ".", 9, 10),
      makeToken(TokenKind.Class, "class", 10, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseDottedModuleName(context);

    expect(node.kind).toBe(SyntaxKind.DottedModuleName);
    expect(node.children).toHaveLength(5);
    expect((node.children[0] as GreenToken).lexeme).toBe("core");
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.UefiKeyword);
    expect(node.children[3]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.children[4]!.kind).toBe(SyntaxKind.ClassKeyword);
    expect(node.reconstruct()).toBe("core.uefi.class");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reports diagnostic for missing initial segment", () => {
    const tokens = [makeToken(TokenKind.Newline, "\n", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseDottedModuleName(context);

    expect(node.kind).toBe(SyntaxKind.DottedModuleName);
    expect(node.children).toHaveLength(0);
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("reports diagnostic when dot is followed by non-name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "core", 0, 4),
      makeToken(TokenKind.Dot, ".", 4, 5),
      makeToken(TokenKind.LeftBracket, "[", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseDottedModuleName(context);

    expect(node.kind).toBe(SyntaxKind.DottedModuleName);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.reconstruct()).toBe("core.");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

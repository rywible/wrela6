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
  parseQualifiedName,
  parseTypeReference,
  parseTypeParameter,
  parseTypeParameterList,
  parseTypeArgumentList,
  parseBracketAfterName,
} from "../../../../src/frontend/parser/type-parser";

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

describe("parseQualifiedName", () => {
  test("parses a single name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Result", 0, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseQualifiedName(context);

    expect(node.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("Result");
    expect(node.reconstruct()).toBe("Result");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a dotted name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "std", 0, 3),
      makeToken(TokenKind.Dot, ".", 3, 4),
      makeToken(TokenKind.Identifier, "io", 4, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseQualifiedName(context);

    expect(node.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("std");
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("io");
    expect(node.reconstruct()).toBe("std.io");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses keyword members after dots", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "core", 0, 4),
      makeToken(TokenKind.Dot, ".", 4, 5),
      makeToken(TokenKind.Uefi, "uefi", 5, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseQualifiedName(context);

    expect(node.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.UefiKeyword);
    expect(node.reconstruct()).toBe("core.uefi");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reports diagnostic when no name at current position", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Eof, "", 1, 1),
    ];
    const context = makeContext(tokens);
    const node = parseQualifiedName(context);

    expect(node.kind).toBe(SyntaxKind.QualifiedName);
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
    const node = parseQualifiedName(context);

    expect(node.kind).toBe(SyntaxKind.QualifiedName);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.DotToken);
    expect(node.reconstruct()).toBe("core.");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

describe("parseTypeReference", () => {
  test("parses a simple type name", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "String", 0, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseTypeReference(context);

    expect(node.kind).toBe(SyntaxKind.TypeReference);
    expect(node.children).toHaveLength(1);
    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect(qName.children).toHaveLength(1);
    expect(node.reconstruct()).toBe("String");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a type with type argument list", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "Result", 0, 6),
      makeToken(TokenKind.LeftBracket, "[", 6, 7),
      makeToken(TokenKind.Identifier, "Never", 7, 12),
      makeToken(TokenKind.Comma, ",", 12, 13),
      makeToken(TokenKind.Identifier, "BootError", 13, 22),
      makeToken(TokenKind.RightBracket, "]", 22, 23),
      makeToken(TokenKind.Eof, "", 23, 23),
    ];
    const context = makeContext(tokens);
    const node = parseTypeReference(context);

    expect(node.kind).toBe(SyntaxKind.TypeReference);
    expect(node.children).toHaveLength(2);

    const qName = node.children[0] as GreenNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect((qName.children[0] as GreenToken).lexeme).toBe("Result");

    const taList = node.children[1] as GreenNode;
    expect(taList.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(taList.children).toHaveLength(5);
    expect(taList.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((taList.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect((taList.children[1] as GreenNode).children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(
      ((taList.children[1] as GreenNode).children[0] as GreenNode).children[0] as GreenToken,
    ).toHaveProperty("lexeme", "Never");
    expect(taList.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect((taList.children[3] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(taList.children[4]!.kind).toBe(SyntaxKind.RightBracketToken);

    expect(node.reconstruct()).toBe("Result[Never,BootError]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses qualified name with type arguments", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "std", 0, 3),
      makeToken(TokenKind.Dot, ".", 3, 4),
      makeToken(TokenKind.Identifier, "Vec", 4, 7),
      makeToken(TokenKind.LeftBracket, "[", 7, 8),
      makeToken(TokenKind.Identifier, "u8", 8, 10),
      makeToken(TokenKind.RightBracket, "]", 10, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseTypeReference(context);

    expect(node.kind).toBe(SyntaxKind.TypeReference);
    expect(node.children).toHaveLength(2);
    expect((node.children[0] as GreenNode).kind).toBe(SyntaxKind.QualifiedName);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node.reconstruct()).toBe("std.Vec[u8]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseTypeParameter", () => {
  test("parses a type parameter without bound", () => {
    const tokens = [makeToken(TokenKind.Identifier, "T", 0, 1), makeToken(TokenKind.Eof, "", 1, 1)];
    const context = makeContext(tokens);
    const node = parseTypeParameter(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("T");
    expect(node.reconstruct()).toBe("T");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a type parameter with bound", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "T", 0, 1),
      makeToken(TokenKind.Colon, ":", 1, 2),
      makeToken(TokenKind.Identifier, "CoreMovableOwned", 2, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameter(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[0] as GreenToken).lexeme).toBe("T");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(
      ((node.children[2] as GreenNode).children[0] as GreenNode).children[0] as GreenToken,
    ).toHaveProperty("lexeme", "CoreMovableOwned");
    expect(node.reconstruct()).toBe("T:CoreMovableOwned");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseTypeParameterList", () => {
  test("parses a single type parameter", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.RightBracket, "]", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.reconstruct()).toBe("[T]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple type parameters with commas", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.Comma, ",", 2, 3),
      makeToken(TokenKind.Identifier, "U", 3, 4),
      makeToken(TokenKind.Comma, ",", 4, 5),
      makeToken(TokenKind.Identifier, "V", 5, 6),
      makeToken(TokenKind.RightBracket, "]", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(7);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[4]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[5] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[6]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.reconstruct()).toBe("[T,U,V]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses type parameters with bounds", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.Colon, ":", 2, 3),
      makeToken(TokenKind.Identifier, "CoreMovableOwned", 3, 19),
      makeToken(TokenKind.RightBracket, "]", 19, 20),
      makeToken(TokenKind.Eof, "", 20, 20),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(((node.children[1] as GreenNode).children[2] as GreenNode).kind).toBe(
      SyntaxKind.TypeReference,
    );
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.reconstruct()).toBe("[T:CoreMovableOwned]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("allows trailing comma", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.Comma, ",", 2, 3),
      makeToken(TokenKind.RightBracket, "]", 3, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect(node.children[3]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.reconstruct()).toBe("[T,]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves newlines between parameters", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Identifier, "T", 2, 3),
      makeToken(TokenKind.Colon, ":", 3, 4),
      makeToken(TokenKind.Identifier, "Foo", 4, 7),
      makeToken(TokenKind.Comma, ",", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Identifier, "U", 9, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Identifier, "Bar", 11, 14),
      makeToken(TokenKind.Comma, ",", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.RightBracket, "]", 16, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.reconstruct()).toBe("[\nT:Foo,\nU:Bar,\n]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits diagnostic for missing closing bracket", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect((node.children[2] as GreenToken).isMissing).toBe(true);
    expect(node.reconstruct()).toBe("[T");
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("recovers at RightParenToken when closing bracket is missing", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.RightParen, ")", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseTypeParameterList(context);

    expect(node.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeParameter);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect((node.children[2] as GreenToken).isMissing).toBe(true);
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(context.peek(0).kind).toBe(TokenKind.RightParen);
  });
});

describe("parseTypeArgumentList", () => {
  test("parses multiple type arguments", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "Never", 1, 6),
      makeToken(TokenKind.Comma, ",", 6, 7),
      makeToken(TokenKind.Identifier, "BootError", 7, 16),
      makeToken(TokenKind.RightBracket, "]", 16, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseTypeArgumentList(context);

    expect(node.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.children[2]!.kind).toBe(SyntaxKind.CommaToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.children[4]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.reconstruct()).toBe("[Never,BootError]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves newlines between type arguments", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Newline, "\n", 1, 2),
      makeToken(TokenKind.Identifier, "A", 2, 3),
      makeToken(TokenKind.Comma, ",", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Identifier, "B", 5, 6),
      makeToken(TokenKind.Comma, ",", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.RightBracket, "]", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseTypeArgumentList(context);

    expect(node.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node.reconstruct()).toBe("[\nA,\nB,\n]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits diagnostic for missing closing bracket", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const node = parseTypeArgumentList(context);

    expect(node.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect((node.children[2] as GreenToken).isMissing).toBe(true);
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

describe("parseBracketAfterName", () => {
  test("declaration mode parses type parameter list", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "T", 1, 2),
      makeToken(TokenKind.RightBracket, "]", 2, 3),
      makeToken(TokenKind.Eof, "", 3, 3),
    ];
    const context = makeContext(tokens);
    const node = parseBracketAfterName(context, "declaration");

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.TypeParameterList);
    expect(node!.reconstruct()).toBe("[T]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("type-reference mode parses type argument list", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "Never", 1, 6),
      makeToken(TokenKind.RightBracket, "]", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseBracketAfterName(context, "type-reference");

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node!.reconstruct()).toBe("[Never]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("expression mode parses type argument list", () => {
    const tokens = [
      makeToken(TokenKind.LeftBracket, "[", 0, 1),
      makeToken(TokenKind.Identifier, "u8", 1, 3),
      makeToken(TokenKind.RightBracket, "]", 3, 4),
      makeToken(TokenKind.Eof, "", 4, 4),
    ];
    const context = makeContext(tokens);
    const node = parseBracketAfterName(context, "expression");

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.TypeArgumentList);
    expect(node!.reconstruct()).toBe("[u8]");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

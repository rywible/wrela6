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
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import {
  parseEdgeClassDeclaration,
  parseStreamDeclaration,
} from "../../../../src/frontend/parser/edge-stream-declaration-parser";

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

describe("parseEdgeClassDeclaration", () => {
  test("parses edge class with empty body", () => {
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.Colon, ":", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.Eof, "", 16, 16),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.EdgeKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("edge");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ClassKeyword);
    expect((node.children[1] as GreenToken).lexeme).toBe("class");
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("Foo");
    expect(node.children[3]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[4] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("edge class Foo:\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses unique edge class", () => {
    const tokens = [
      makeToken(TokenKind.Unique, "unique", 0, 6, " "),
      makeToken(TokenKind.Edge, "edge", 7, 11, " "),
      makeToken(TokenKind.Class, "class", 12, 17, " "),
      makeToken(TokenKind.Identifier, "NetworkDevice", 18, 31),
      makeToken(TokenKind.Colon, ":", 31, 32),
      makeToken(TokenKind.Newline, "\n", 32, 33),
      makeToken(TokenKind.Eof, "", 33, 33),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(node.children).toHaveLength(6);
    expect(node.children[0]!.kind).toBe(SyntaxKind.UniqueKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("unique");
    expect(node.children[1]!.kind).toBe(SyntaxKind.EdgeKeyword);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ClassKeyword);
    expect(node.children[3]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[3] as GreenToken).lexeme).toBe("NetworkDevice");

    expect(node.reconstruct()).toBe("unique edge class NetworkDevice:\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses generic edge class with type parameter list", () => {
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.LeftBracket, "[", 14, 15),
      makeToken(TokenKind.Identifier, "T", 15, 16),
      makeToken(TokenKind.RightBracket, "]", 16, 17),
      makeToken(TokenKind.Colon, ":", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.Eof, "", 19, 19),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(node.children).toHaveLength(6);
    expect(node.children[0]!.kind).toBe(SyntaxKind.EdgeKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.ClassKeyword);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("Foo");

    const typeParamList = node.children[3] as GreenNode;
    expect(typeParamList.kind).toBe(SyntaxKind.TypeParameterList);
    expect(typeParamList.children).toHaveLength(3);
    expect(typeParamList.children[0]!.kind).toBe(SyntaxKind.LeftBracketToken);
    expect(typeParamList.children[1]!.kind).toBe(SyntaxKind.TypeParameter);

    const typeParam = typeParamList.children[1] as GreenNode;
    expect(typeParam.children).toHaveLength(1);
    expect(typeParam.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((typeParam.children[0] as GreenToken).lexeme).toBe("T");

    expect(typeParamList.children[2]!.kind).toBe(SyntaxKind.RightBracketToken);
    expect(node.children[4]!.kind).toBe(SyntaxKind.ColonToken);

    expect(node.reconstruct()).toBe("edge class Foo[T]:\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("preserves block contents", () => {
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.Colon, ":", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.Indent, "    ", 16, 20),
      makeToken(TokenKind.Identifier, "bar", 20, 23),
      makeToken(TokenKind.Newline, "\n", 23, 24),
      makeToken(TokenKind.Dedent, "", 24, 24),
      makeToken(TokenKind.Eof, "", 24, 24),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);
    expect(node.reconstruct()).toBe("edge class Foo:\n    bar\n");

    const block = node.children[4] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    expect(block.children).toHaveLength(4);
    expect(block.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(block.children[1]!.kind).toBe(SyntaxKind.IndentToken);
    expect(block.children[2]!.kind).toBe(SyntaxKind.StatementList);
    expect(block.children[3]!.kind).toBe(SyntaxKind.DedentToken);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text", () => {
    const source = "edge class Foo:\n    bar\n";
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.Colon, ":", 14, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.Indent, "    ", 16, 20),
      makeToken(TokenKind.Identifier, "bar", 20, 23),
      makeToken(TokenKind.Newline, "\n", 23, 24),
      makeToken(TokenKind.Dedent, "", 24, 24),
      makeToken(TokenKind.Eof, "", 24, 24),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits diagnostic for missing class identifier", () => {
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Colon, ":", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);

    const nameToken = node.children[2] as GreenToken;
    expect(nameToken.kind).toBe(SyntaxKind.IdentifierToken);
    expect(nameToken.isMissing).toBe(true);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test("emits diagnostic for missing colon", () => {
    const tokens = [
      makeToken(TokenKind.Edge, "edge", 0, 4, " "),
      makeToken(TokenKind.Class, "class", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseEdgeClassDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.EdgeClassDeclaration);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseStreamDeclaration", () => {
  test("parses stream declaration with empty body", () => {
    const tokens = [
      makeToken(TokenKind.Stream, "stream", 0, 6, " "),
      makeToken(TokenKind.Identifier, "Rx", 7, 9, " "),
      makeToken(TokenKind.Contains, "contains", 10, 18, " "),
      makeToken(TokenKind.Identifier, "ReadableBuffer", 19, 32, " "),
      makeToken(TokenKind.Bound, "bound", 33, 38, " "),
      makeToken(TokenKind.IntegerLiteral, "64", 39, 41),
      makeToken(TokenKind.Colon, ":", 41, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseStreamDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.StreamDeclaration);
    expect(node.children).toHaveLength(8);
    expect(node.children[0]!.kind).toBe(SyntaxKind.StreamKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("stream");
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[1] as GreenToken).lexeme).toBe("Rx");
    expect(node.children[2]!.kind).toBe(SyntaxKind.ContainsKeyword);
    expect((node.children[2] as GreenToken).lexeme).toBe("contains");

    const typeRef = node.children[3] as GreenNode;
    expect(typeRef.kind).toBe(SyntaxKind.TypeReference);

    expect(node.children[4]!.kind).toBe(SyntaxKind.BoundKeyword);
    expect((node.children[4] as GreenToken).lexeme).toBe("bound");

    const expr = node.children[5] as GreenNode;
    expect(expr.kind).toBe(SyntaxKind.LiteralExpression);

    expect(node.children[6]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[7] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("stream Rx contains ReadableBuffer bound 64:\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text", () => {
    const source = "stream Rx contains ReadableBuffer bound 64:\n";
    const tokens = [
      makeToken(TokenKind.Stream, "stream", 0, 6, " "),
      makeToken(TokenKind.Identifier, "Rx", 7, 9, " "),
      makeToken(TokenKind.Contains, "contains", 10, 18, " "),
      makeToken(TokenKind.Identifier, "ReadableBuffer", 19, 32, " "),
      makeToken(TokenKind.Bound, "bound", 33, 38, " "),
      makeToken(TokenKind.IntegerLiteral, "64", 39, 41),
      makeToken(TokenKind.Colon, ":", 41, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseStreamDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits diagnostic for missing identifier", () => {
    const tokens = [
      makeToken(TokenKind.Stream, "stream", 0, 6, " "),
      makeToken(TokenKind.Contains, "contains", 7, 15, " "),
      makeToken(TokenKind.Identifier, "Bar", 16, 19, " "),
      makeToken(TokenKind.Bound, "bound", 20, 25, " "),
      makeToken(TokenKind.IntegerLiteral, "64", 26, 28),
      makeToken(TokenKind.Colon, ":", 28, 29),
      makeToken(TokenKind.Newline, "\n", 29, 30),
      makeToken(TokenKind.Eof, "", 30, 30),
    ];
    const context = makeContext(tokens);
    const node = parseStreamDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.StreamDeclaration);

    const nameToken = node.children[1] as GreenToken;
    expect(nameToken.kind).toBe(SyntaxKind.IdentifierToken);
    expect(nameToken.isMissing).toBe(true);

    const sourceDiagnostics = context
      .draftDiagnostics()
      .filter((diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

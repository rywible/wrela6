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
  parseValidatedBufferDeclaration,
  parseParamsSection,
  parseLayoutSection,
  parseLayoutField,
} from "../../../../src/frontend/parser/validated-buffer-parser";

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

describe("parseValidatedBufferDeclaration", () => {
  test("parses validated buffer declaration with empty body", () => {
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Eof, "", 25, 25),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);
    expect((node.children[0] as GreenToken).lexeme).toBe("validated");
    expect((node.children[1] as GreenToken).lexeme).toBe("buffer");
    expect((node.children[2] as GreenToken).lexeme).toBe("Packet");
    expect(node.children[3]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[4] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    expect(block.children[0]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node.reconstruct()).toBe("validated buffer Packet:\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses validated buffer with params section", () => {
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Indent, "    ", 25, 29),
      makeToken(TokenKind.Params, "params", 29, 35),
      makeToken(TokenKind.Colon, ":", 35, 36),
      makeToken(TokenKind.Newline, "\n", 36, 37),
      makeToken(TokenKind.Indent, "        ", 37, 45),
      makeToken(TokenKind.Identifier, "field1", 45, 51),
      makeToken(TokenKind.Colon, ":", 51, 52, " "),
      makeToken(TokenKind.Identifier, "Type", 53, 57),
      makeToken(TokenKind.Newline, "\n", 57, 58),
      makeToken(TokenKind.Dedent, "", 58, 58),
      makeToken(TokenKind.Dedent, "", 58, 58),
      makeToken(TokenKind.Eof, "", 58, 58),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);
    expect((node.children[0] as GreenToken).lexeme).toBe("validated");
    expect((node.children[1] as GreenToken).lexeme).toBe("buffer");
    expect((node.children[2] as GreenToken).lexeme).toBe("Packet");

    const outerBlock = node.children[4] as GreenNode;
    const stmtList = outerBlock.children[2] as GreenNode;
    const paramsSection = stmtList.children[0] as GreenNode;
    expect(paramsSection.kind).toBe(SyntaxKind.ParamsSection);
    expect((paramsSection.children[0] as GreenToken).lexeme).toBe("params");
    expect(paramsSection.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = paramsSection.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses validated buffer with layout section", () => {
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Indent, "    ", 25, 29),
      makeToken(TokenKind.Layout, "layout", 29, 35),
      makeToken(TokenKind.Colon, ":", 35, 36),
      makeToken(TokenKind.Newline, "\n", 36, 37),
      makeToken(TokenKind.Indent, "        ", 37, 45),
      makeToken(TokenKind.Identifier, "field1", 45, 51),
      makeToken(TokenKind.Colon, ":", 51, 52, " "),
      makeToken(TokenKind.Identifier, "U8", 53, 55),
      makeToken(TokenKind.At, "@", 55, 56, " ", " "),
      makeToken(TokenKind.IntegerLiteral, "0", 57, 58),
      makeToken(TokenKind.Newline, "\n", 58, 59),
      makeToken(TokenKind.Dedent, "", 59, 59),
      makeToken(TokenKind.Dedent, "", 59, 59),
      makeToken(TokenKind.Eof, "", 59, 59),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const outerBlock = node.children[4] as GreenNode;
    const stmtList = outerBlock.children[2] as GreenNode;
    const layoutSection = stmtList.children[0] as GreenNode;
    expect(layoutSection.kind).toBe(SyntaxKind.LayoutSection);
    expect((layoutSection.children[0] as GreenToken).lexeme).toBe("layout");
    expect(layoutSection.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = layoutSection.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses validated buffer with both sections", () => {
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Indent, "    ", 25, 29),
      makeToken(TokenKind.Params, "params", 29, 35),
      makeToken(TokenKind.Colon, ":", 35, 36),
      makeToken(TokenKind.Newline, "\n", 36, 37),
      makeToken(TokenKind.Indent, "        ", 37, 45),
      makeToken(TokenKind.Identifier, "f1", 45, 47),
      makeToken(TokenKind.Colon, ":", 47, 48, " "),
      makeToken(TokenKind.Identifier, "U8", 49, 51),
      makeToken(TokenKind.Newline, "\n", 51, 52),
      makeToken(TokenKind.Dedent, "", 52, 52),
      makeToken(TokenKind.Layout, "layout", 52, 58, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 58, 59),
      makeToken(TokenKind.Newline, "\n", 59, 60),
      makeToken(TokenKind.Indent, "        ", 60, 68),
      makeToken(TokenKind.Identifier, "f2", 68, 70),
      makeToken(TokenKind.Colon, ":", 70, 71, " "),
      makeToken(TokenKind.Identifier, "U16", 72, 75),
      makeToken(TokenKind.At, "@", 75, 76, " ", " "),
      makeToken(TokenKind.IntegerLiteral, "0", 77, 78),
      makeToken(TokenKind.Newline, "\n", 78, 79),
      makeToken(TokenKind.Dedent, "", 79, 79),
      makeToken(TokenKind.Dedent, "", 79, 79),
      makeToken(TokenKind.Eof, "", 79, 79),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const outerBlock = node.children[4] as GreenNode;
    const stmtList = outerBlock.children[2] as GreenNode;
    const paramsSection = stmtList.children[0] as GreenNode;
    expect(paramsSection.kind).toBe(SyntaxKind.ParamsSection);

    const layoutSection = stmtList.children[1] as GreenNode;
    expect(layoutSection.kind).toBe(SyntaxKind.LayoutSection);

    expect(node.reconstruct()).toBe(
      "validated buffer Packet:\n    params:\n        f1: U8\n    layout:\n        f2: U16 @ 0\n",
    );
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovers from unknown section", () => {
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Indent, "    ", 25, 29),
      makeToken(TokenKind.IntegerLiteral, "42", 29, 31),
      makeToken(TokenKind.Newline, "\n", 31, 32),
      makeToken(TokenKind.Dedent, "", 32, 32),
      makeToken(TokenKind.Eof, "", 32, 32),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ValidatedBufferDeclaration);

    const outerBlock = node.children[4] as GreenNode;
    const stmtList = outerBlock.children[2] as GreenNode;
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);

    const diagnostics = context.draftDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("reconstruction exactness", () => {
    const source = "validated buffer Packet:\n    params:\n        f1: U8\n";
    const tokens = [
      makeToken(TokenKind.Validated, "validated", 0, 9, " "),
      makeToken(TokenKind.Buffer, "buffer", 10, 16, " "),
      makeToken(TokenKind.Identifier, "Packet", 17, 23),
      makeToken(TokenKind.Colon, ":", 23, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Indent, "    ", 25, 29),
      makeToken(TokenKind.Params, "params", 29, 35),
      makeToken(TokenKind.Colon, ":", 35, 36),
      makeToken(TokenKind.Newline, "\n", 36, 37),
      makeToken(TokenKind.Indent, "        ", 37, 45),
      makeToken(TokenKind.Identifier, "f1", 45, 47),
      makeToken(TokenKind.Colon, ":", 47, 48, " "),
      makeToken(TokenKind.Identifier, "U8", 49, 51),
      makeToken(TokenKind.Newline, "\n", 51, 52),
      makeToken(TokenKind.Dedent, "", 52, 52),
      makeToken(TokenKind.Dedent, "", 52, 52),
      makeToken(TokenKind.Eof, "", 52, 52),
    ];
    const context = makeContext(tokens);
    const node = parseValidatedBufferDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseParamsSection", () => {
  test("parses params section with field declarations", () => {
    const tokens = [
      makeToken(TokenKind.Params, "params", 0, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "x", 12, 13),
      makeToken(TokenKind.Colon, ":", 13, 14, " "),
      makeToken(TokenKind.Identifier, "Int", 15, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.Dedent, "", 19, 19),
      makeToken(TokenKind.Eof, "", 19, 19),
    ];
    const context = makeContext(tokens);
    const node = parseParamsSection(context);

    expect(node.kind).toBe(SyntaxKind.ParamsSection);
    expect((node.children[0] as GreenToken).lexeme).toBe("params");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("params:\n    x: Int\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseLayoutSection", () => {
  test("parses layout section with layout fields", () => {
    const tokens = [
      makeToken(TokenKind.Layout, "layout", 0, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "data", 12, 16),
      makeToken(TokenKind.Colon, ":", 16, 17, " "),
      makeToken(TokenKind.Identifier, "U8", 18, 20),
      makeToken(TokenKind.At, "@", 20, 21, " ", " "),
      makeToken(TokenKind.IntegerLiteral, "0", 22, 23),
      makeToken(TokenKind.Newline, "\n", 23, 24),
      makeToken(TokenKind.Dedent, "", 24, 24),
      makeToken(TokenKind.Eof, "", 24, 24),
    ];
    const context = makeContext(tokens);
    const node = parseLayoutSection(context);

    expect(node.kind).toBe(SyntaxKind.LayoutSection);
    expect((node.children[0] as GreenToken).lexeme).toBe("layout");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("layout:\n    data: U8 @ 0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseLayoutField", () => {
  test("parses layout field with at expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "data", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5, " "),
      makeToken(TokenKind.Identifier, "U8", 6, 8),
      makeToken(TokenKind.At, "@", 8, 9, " ", " "),
      makeToken(TokenKind.IntegerLiteral, "0", 10, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseLayoutField(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.LayoutField);
    expect((node!.children[0] as GreenToken).lexeme).toBe("data");
    expect(node!.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.TypeReference);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.AtKeyword);
    expect(node!.children[4]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[5]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("data: U8 @ 0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses layout field with at and len expressions", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "data", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5, " "),
      makeToken(TokenKind.Identifier, "U8", 6, 8),
      makeToken(TokenKind.At, "@", 8, 9, " ", " "),
      makeToken(TokenKind.IntegerLiteral, "0", 10, 11, " "),
      makeToken(TokenKind.Len, "len", 12, 15, " "),
      makeToken(TokenKind.IntegerLiteral, "4", 16, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseLayoutField(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.LayoutField);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.AtKeyword);
    expect(node!.children[4]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[5]!.kind).toBe(SyntaxKind.LenKeyword);
    expect(node!.children[6]!.kind).toBe(SyntaxKind.LiteralExpression);

    expect(node!.reconstruct()).toBe("data: U8 @ 0 len 4\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined for non-identifier token", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "42", 0, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const result = parseLayoutField(context);

    expect(result).toBeUndefined();
  });
});

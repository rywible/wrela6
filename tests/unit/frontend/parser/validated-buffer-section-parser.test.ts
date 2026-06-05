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
  parseDeriveSection,
  parseDerivedField,
  parseDeriveCase,
  parseRequireSection,
  parseRequirement,
} from "../../../../src/frontend/parser/validated-buffer-section-parser";

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

describe("parseDeriveSection", () => {
  test("parses derive section with derived fields and cases", () => {
    const tokens = [
      makeToken(TokenKind.Derive, "derive", 0, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "checksum", 12, 20),
      makeToken(TokenKind.Colon, ":", 20, 21, " "),
      makeToken(TokenKind.Identifier, "U16", 22, 25, " "),
      makeToken(TokenKind.From, "from", 26, 30, " "),
      makeToken(TokenKind.IntegerLiteral, "0", 31, 32),
      makeToken(TokenKind.Colon, ":", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Indent, "        ", 34, 42),
      makeToken(TokenKind.IntegerLiteral, "0", 42, 43, " "),
      makeToken(TokenKind.FatArrow, "=>", 44, 46, " "),
      makeToken(TokenKind.Identifier, "PacketKind", 47, 57),
      makeToken(TokenKind.Dot, ".", 57, 58),
      makeToken(TokenKind.Identifier, "ping", 58, 62),
      makeToken(TokenKind.Newline, "\n", 62, 63),
      makeToken(TokenKind.Otherwise, "otherwise", 71, 80, " ", "        "),
      makeToken(TokenKind.FatArrow, "=>", 81, 83, " "),
      makeToken(TokenKind.IntegerLiteral, "1", 84, 85),
      makeToken(TokenKind.Newline, "\n", 85, 86),
      makeToken(TokenKind.Dedent, "", 86, 86),
      makeToken(TokenKind.Dedent, "", 86, 86),
      makeToken(TokenKind.Eof, "", 86, 86),
    ];
    const context = makeContext(tokens);
    const node = parseDeriveSection(context);

    expect(node.kind).toBe(SyntaxKind.DeriveSection);
    expect((node.children[0] as GreenToken).lexeme).toBe("derive");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);

    const derivedField = stmtList.children[0] as GreenNode;
    expect(derivedField.kind).toBe(SyntaxKind.DerivedField);
    expect((derivedField.children[0] as GreenToken).lexeme).toBe("checksum");
    expect(derivedField.children[2]!.kind).toBe(SyntaxKind.TypeReference);

    const deriveBlock = derivedField.children[6] as GreenNode;
    expect(deriveBlock.kind).toBe(SyntaxKind.Block);

    const deriveStmtList = deriveBlock.children[2] as GreenNode;
    expect(deriveStmtList.kind).toBe(SyntaxKind.StatementList);

    const case1 = deriveStmtList.children[0] as GreenNode;
    expect(case1.kind).toBe(SyntaxKind.DeriveCase);
    expect(case1.children[0]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(case1.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect(case1.children[2]!.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(case1.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    const case2 = deriveStmtList.children[1] as GreenNode;
    expect(case2.kind).toBe(SyntaxKind.DeriveCase);
    expect(case2.children[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect((case2.children[0] as GreenNode).children[0]!.kind).toBe(SyntaxKind.OtherwiseKeyword);
    expect(case2.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect(case2.children[2]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(case2.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness", () => {
    const source =
      "derive:\n    checksum: U16 from 0:\n        0 => PacketKind.ping\n        otherwise => 1\n";
    const tokens = [
      makeToken(TokenKind.Derive, "derive", 0, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "checksum", 12, 20),
      makeToken(TokenKind.Colon, ":", 20, 21, " "),
      makeToken(TokenKind.Identifier, "U16", 22, 25, " "),
      makeToken(TokenKind.From, "from", 26, 30, " "),
      makeToken(TokenKind.IntegerLiteral, "0", 31, 32),
      makeToken(TokenKind.Colon, ":", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Indent, "        ", 34, 42),
      makeToken(TokenKind.IntegerLiteral, "0", 42, 43, " "),
      makeToken(TokenKind.FatArrow, "=>", 44, 46, " "),
      makeToken(TokenKind.Identifier, "PacketKind", 47, 57),
      makeToken(TokenKind.Dot, ".", 57, 58),
      makeToken(TokenKind.Identifier, "ping", 58, 62),
      makeToken(TokenKind.Newline, "\n", 62, 63),
      makeToken(TokenKind.Otherwise, "otherwise", 71, 80, " ", "        "),
      makeToken(TokenKind.FatArrow, "=>", 81, 83, " "),
      makeToken(TokenKind.IntegerLiteral, "1", 84, 85),
      makeToken(TokenKind.Newline, "\n", 85, 86),
      makeToken(TokenKind.Dedent, "", 86, 86),
      makeToken(TokenKind.Dedent, "", 86, 86),
      makeToken(TokenKind.Eof, "", 86, 86),
    ];
    const context = makeContext(tokens);
    const node = parseDeriveSection(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseDerivedField", () => {
  test("parses derived field with cases", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "checksum", 0, 8),
      makeToken(TokenKind.Colon, ":", 8, 9, " "),
      makeToken(TokenKind.Identifier, "U16", 10, 13, " "),
      makeToken(TokenKind.From, "from", 14, 18, " "),
      makeToken(TokenKind.IntegerLiteral, "0", 19, 20),
      makeToken(TokenKind.Colon, ":", 20, 21),
      makeToken(TokenKind.Newline, "\n", 21, 22),
      makeToken(TokenKind.Indent, "    ", 22, 26),
      makeToken(TokenKind.IntegerLiteral, "1", 26, 27, " "),
      makeToken(TokenKind.FatArrow, "=>", 28, 30, " "),
      makeToken(TokenKind.IntegerLiteral, "42", 31, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Dedent, "", 34, 34),
      makeToken(TokenKind.Eof, "", 34, 34),
    ];
    const context = makeContext(tokens);
    const node = parseDerivedField(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.DerivedField);
    expect((node!.children[0] as GreenToken).lexeme).toBe("checksum");
    expect(node!.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.TypeReference);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.FromKeyword);
    expect(node!.children[4]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[5]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node!.children[6] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node!.reconstruct()).toBe("checksum: U16 from 0:\n    1 => 42\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined for non-identifier token", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "42", 0, 2),
      makeToken(TokenKind.Eof, "", 2, 2),
    ];
    const context = makeContext(tokens);
    const result = parseDerivedField(context);

    expect(result).toBeUndefined();
  });
});

describe("parseDeriveCase", () => {
  test("parses derive case with integer expression and member access", () => {
    const tokens = [
      makeToken(TokenKind.IntegerLiteral, "0", 0, 1, " "),
      makeToken(TokenKind.FatArrow, "=>", 2, 4, " "),
      makeToken(TokenKind.Identifier, "PacketKind", 5, 15),
      makeToken(TokenKind.Dot, ".", 15, 16),
      makeToken(TokenKind.Identifier, "ping", 16, 20),
      makeToken(TokenKind.Newline, "\n", 20, 21),
      makeToken(TokenKind.Eof, "", 21, 21),
    ];
    const context = makeContext(tokens);
    const node = parseDeriveCase(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.DeriveCase);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.MemberAccessExpression);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("0 => PacketKind.ping\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses derive case with otherwise keyword", () => {
    const tokens = [
      makeToken(TokenKind.Otherwise, "otherwise", 0, 9, " "),
      makeToken(TokenKind.FatArrow, "=>", 10, 12, " "),
      makeToken(TokenKind.IntegerLiteral, "1", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseDeriveCase(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.DeriveCase);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect((node!.children[0] as GreenNode).children[0]!.kind).toBe(SyntaxKind.OtherwiseKeyword);
    expect(node!.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("otherwise => 1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses derive case with identifier left side", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1, " "),
      makeToken(TokenKind.FatArrow, "=>", 2, 4, " "),
      makeToken(TokenKind.IntegerLiteral, "1", 5, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseDeriveCase(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.DeriveCase);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(node!.children[1]!.kind).toBe(SyntaxKind.FatArrowToken);
    expect(node!.children[2]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(node!.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("x => 1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined at block boundaries", () => {
    const tokens = [makeToken(TokenKind.Dedent, "", 0, 0), makeToken(TokenKind.Eof, "", 0, 0)];
    const context = makeContext(tokens);
    const result = parseDeriveCase(context);

    expect(result).toBeUndefined();
  });
});

describe("parseRequireSection", () => {
  test("parses require section with requirements", () => {
    const tokens = [
      makeToken(TokenKind.Require, "require", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.Identifier, "x", 13, 14, " "),
      makeToken(TokenKind.Less, "<", 15, 16, " "),
      makeToken(TokenKind.IntegerLiteral, "10", 17, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Dedent, "", 20, 20),
      makeToken(TokenKind.Eof, "", 20, 20),
    ];
    const context = makeContext(tokens);
    const node = parseRequireSection(context);

    expect(node.kind).toBe(SyntaxKind.RequireSection);
    expect((node.children[0] as GreenToken).lexeme).toBe("require");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("require:\n    x < 10\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness", () => {
    const source = "require:\n    x < 10\n    y > 0\n";
    const tokens = [
      makeToken(TokenKind.Require, "require", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.Identifier, "x", 13, 14, " "),
      makeToken(TokenKind.Less, "<", 15, 16, " "),
      makeToken(TokenKind.IntegerLiteral, "10", 17, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Identifier, "y", 23, 24, " ", "    "),
      makeToken(TokenKind.Greater, ">", 25, 26, " "),
      makeToken(TokenKind.IntegerLiteral, "0", 27, 28),
      makeToken(TokenKind.Newline, "\n", 28, 29),
      makeToken(TokenKind.Dedent, "", 29, 29),
      makeToken(TokenKind.Eof, "", 29, 29),
    ];
    const context = makeContext(tokens);
    const node = parseRequireSection(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseRequirement", () => {
  test("parses requirement with else expression", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1, " "),
      makeToken(TokenKind.Greater, ">", 2, 3, " "),
      makeToken(TokenKind.IntegerLiteral, "0", 4, 5, " "),
      makeToken(TokenKind.Else, "else", 6, 10, " "),
      makeToken(TokenKind.IntegerLiteral, "1", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseRequirement(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.Requirement);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.ElseRequirementExpression);
    expect(node!.children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("x > 0 else 1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses simple comparison without else", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "x", 0, 1, " "),
      makeToken(TokenKind.Less, "<", 2, 3, " "),
      makeToken(TokenKind.IntegerLiteral, "10", 4, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseRequirement(context);

    expect(node).toBeDefined();
    expect(node!.kind).toBe(SyntaxKind.Requirement);
    expect(node!.children[0]!.kind).toBe(SyntaxKind.ComparisonExpression);
    expect(node!.children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node!.reconstruct()).toBe("x < 10\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("returns undefined at block boundaries", () => {
    const tokens = [makeToken(TokenKind.Dedent, "", 0, 0), makeToken(TokenKind.Eof, "", 0, 0)];
    const context = makeContext(tokens);
    const result = parseRequirement(context);

    expect(result).toBeUndefined();
  });
});

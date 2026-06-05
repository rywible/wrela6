import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import {
  parseMatchStatement,
  parseMatchCase,
} from "../../../../src/frontend/parser/match-statement-parser";

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

describe("parseMatchStatement", () => {
  test("match with a single case using qualified name pattern", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Case, "case", 12, 16),
      makeToken(TokenKind.Identifier, "PacketKind", 16, 26),
      makeToken(TokenKind.Dot, ".", 26, 27),
      makeToken(TokenKind.Identifier, "ping", 27, 31),
      makeToken(TokenKind.Colon, ":", 31, 32),
      makeToken(TokenKind.Newline, "\n", 32, 33),
      makeToken(TokenKind.Indent, "        ", 33, 41),
      makeToken(TokenKind.Identifier, "handle", 41, 47),
      makeToken(TokenKind.Newline, "\n", 47, 48),
      makeToken(TokenKind.Dedent, "", 48, 48),
      makeToken(TokenKind.Dedent, "", 48, 48),
      makeToken(TokenKind.Eof, "", 48, 48),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.kind).toBe(SyntaxKind.MatchStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.MatchKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[3] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    expect(block.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(block.children[1]!.kind).toBe(SyntaxKind.IndentToken);

    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);

    const matchCase = stmtList.children[0] as GreenNode;
    expect(matchCase.kind).toBe(SyntaxKind.MatchCase);
    expect(matchCase.children[0]!.kind).toBe(SyntaxKind.CaseKeyword);
    const pattern = matchCase.children[1] as GreenNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    const caseBlock = matchCase.children[3] as GreenNode;
    expect(caseBlock.kind).toBe(SyntaxKind.Block);

    expect(block.children[3]!.kind).toBe(SyntaxKind.DedentToken);
    expect(node.reconstruct()).toBe("matchx:\n    casePacketKind.ping:\n        handle\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("match with multiple cases", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Case, "case", 12, 16),
      makeToken(TokenKind.Identifier, "a", 16, 17),
      makeToken(TokenKind.Colon, ":", 17, 18),
      makeToken(TokenKind.Newline, "\n", 18, 19),
      makeToken(TokenKind.Indent, "        ", 19, 27),
      makeToken(TokenKind.Dedent, "", 27, 27),
      makeToken(TokenKind.Case, "case", 27, 31),
      makeToken(TokenKind.Identifier, "b", 31, 32),
      makeToken(TokenKind.Colon, ":", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Indent, "        ", 34, 42),
      makeToken(TokenKind.Dedent, "", 42, 42),
      makeToken(TokenKind.Dedent, "", 42, 42),
      makeToken(TokenKind.Eof, "", 42, 42),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.kind).toBe(SyntaxKind.MatchStatement);
    expect(node.children).toHaveLength(4);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    const case1 = stmtList.children[0] as GreenNode;
    expect(case1.kind).toBe(SyntaxKind.MatchCase);

    const case2 = stmtList.children[1] as GreenNode;
    expect(case2.kind).toBe(SyntaxKind.MatchCase);

    expect(node.reconstruct()).toBe("matchx:\n    casea:\n        caseb:\n        ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("match with constructor pattern", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "result", 5, 11),
      makeToken(TokenKind.Colon, ":", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Indent, "    ", 13, 17),
      makeToken(TokenKind.Case, "case", 17, 21),
      makeToken(TokenKind.Identifier, "Ok", 21, 23),
      makeToken(TokenKind.LeftParen, "(", 23, 24),
      makeToken(TokenKind.Identifier, "value", 24, 29),
      makeToken(TokenKind.RightParen, ")", 29, 30),
      makeToken(TokenKind.Colon, ":", 30, 31),
      makeToken(TokenKind.Newline, "\n", 31, 32),
      makeToken(TokenKind.Indent, "    ", 32, 36),
      makeToken(TokenKind.Identifier, "handle", 36, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.kind).toBe(SyntaxKind.MatchStatement);
    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    const matchCase = stmtList.children[0] as GreenNode;
    expect(matchCase.kind).toBe(SyntaxKind.MatchCase);
    expect(matchCase.children[0]!.kind).toBe(SyntaxKind.CaseKeyword);

    const pattern = matchCase.children[1] as GreenNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    expect(pattern.children[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(pattern.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((pattern.children[2] as GreenNode).kind).toBe(SyntaxKind.PatternList);
    expect(pattern.children[3]!.kind).toBe(SyntaxKind.RightParenToken);

    expect(matchCase.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((matchCase.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);

    expect(node.reconstruct()).toBe("matchresult:\n    caseOk(value):\n    handle\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("match with body containing only blank lines", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Dedent, "", 13, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.kind).toBe(SyntaxKind.MatchStatement);
    expect(node.reconstruct()).toBe("matchx:\n    \n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Case, "case", 12, 16),
      makeToken(TokenKind.Identifier, "PacketKind", 16, 26),
      makeToken(TokenKind.Dot, ".", 26, 27),
      makeToken(TokenKind.Identifier, "ping", 27, 31),
      makeToken(TokenKind.Colon, ":", 31, 32),
      makeToken(TokenKind.Newline, "\n", 32, 33),
      makeToken(TokenKind.Indent, "        ", 33, 41),
      makeToken(TokenKind.Identifier, "y", 41, 42),
      makeToken(TokenKind.Newline, "\n", 42, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Dedent, "", 43, 43),
      makeToken(TokenKind.Eof, "", 43, 43),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.reconstruct()).toBe("matchx:\n    casePacketKind.ping:\n        y\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseMatchCase", () => {
  test("parses a basic case with identifier pattern", () => {
    const tokens = [
      makeToken(TokenKind.Case, "case", 0, 4),
      makeToken(TokenKind.Identifier, "x", 4, 5),
      makeToken(TokenKind.Colon, ":", 5, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Indent, "    ", 7, 11),
      makeToken(TokenKind.Identifier, "y", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Dedent, "", 13, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseMatchCase(context)!;

    expect(node.kind).toBe(SyntaxKind.MatchCase);
    expect(node.children[0]!.kind).toBe(SyntaxKind.CaseKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("casex:\n    y\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses a case with constructor pattern", () => {
    const tokens = [
      makeToken(TokenKind.Case, "case", 0, 4),
      makeToken(TokenKind.Identifier, "Ok", 4, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "value", 7, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.Dedent, "", 19, 19),
      makeToken(TokenKind.Eof, "", 19, 19),
    ];
    const context = makeContext(tokens);
    const node = parseMatchCase(context)!;

    expect(node.kind).toBe(SyntaxKind.MatchCase);
    const pattern = node.children[1] as GreenNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    expect(pattern.children[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect((pattern.children[2] as GreenNode).kind).toBe(SyntaxKind.PatternList);
    expect(pattern.children[3]!.kind).toBe(SyntaxKind.RightParenToken);
    expect(node.reconstruct()).toBe("caseOk(value):\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.Case, "case", 0, 4),
      makeToken(TokenKind.Identifier, "x", 4, 5),
      makeToken(TokenKind.Colon, ":", 5, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Indent, "    ", 7, 11),
      makeToken(TokenKind.Dedent, "", 11, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseMatchCase(context)!;

    expect(node.reconstruct()).toBe("casex:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("recovery", () => {
  test("recovers from unexpected tokens in match body", () => {
    const tokens = [
      makeToken(TokenKind.Match, "match", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "unexpected", 12, 22),
      makeToken(TokenKind.Newline, "\n", 22, 23),
      makeToken(TokenKind.Case, "case", 23, 27),
      makeToken(TokenKind.Identifier, "a", 27, 28),
      makeToken(TokenKind.Colon, ":", 28, 29),
      makeToken(TokenKind.Newline, "\n", 29, 30),
      makeToken(TokenKind.Indent, "        ", 30, 38),
      makeToken(TokenKind.Dedent, "", 38, 38),
      makeToken(TokenKind.Dedent, "", 38, 38),
      makeToken(TokenKind.Eof, "", 38, 38),
    ];
    const context = makeContext(tokens);
    const node = parseMatchStatement(context);

    expect(node.kind).toBe(SyntaxKind.MatchStatement);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    // The unexpected token should be wrapped in a SkippedTokens node
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);

    // The case after recovery should parse
    const matchCase = stmtList.children[1] as GreenNode;
    expect(matchCase.kind).toBe(SyntaxKind.MatchCase);

    // Diagnostics should include a recovery diagnostic
    expect(context.draftDiagnostics().length).toBeGreaterThan(0);
    expect(
      context
        .draftDiagnostics()
        .some((diagnostic) => diagnostic.code === "PARSE_RECOVERY_SKIPPED_TOKENS"),
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import {
  parseBlock,
  parseStatementList,
  tryParseStatement,
  expectNewline,
} from "../../../../src/frontend/parser/block-parser";
import type { GreenElement, GreenNode } from "../../../../src/frontend/syntax/green-node";

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
  return new ParserContext({ tokens: TokenStream.from(tokens), factory: new SyntaxFactory() });
}

function itemParser(context: ParserContext): GreenElement | undefined {
  if (context.currentSyntaxKind() === SyntaxKind.IdentifierToken) {
    return context.consume();
  }
  return undefined;
}

function itemParserWithOwnedNewline(context: ParserContext): GreenElement | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.IdentifierToken) return undefined;
  const children = [context.consume()];
  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }
  return context.factory.node(SyntaxKind.ExpressionStatement, children);
}

const recoveryKinds = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

const colonT = makeToken(TokenKind.Colon, ":", 0, 1);
const newlineT = makeToken(TokenKind.Newline, "\n", 1, 2);
const indentT = makeToken(TokenKind.Indent, "    ", 2, 6);
const identT = makeToken(TokenKind.Identifier, "item", 6, 10);
const newline2T = makeToken(TokenKind.Newline, "\n", 10, 11);
const dedentT = makeToken(TokenKind.Dedent, "", 11, 11);
const eofT = makeToken(TokenKind.Eof, "", 11, 11);

describe("parseBlock", () => {
  test("normal block consumes colon, newline, indent, items, dedent", () => {
    const context = makeContext([colonT, newlineT, indentT, identT, newline2T, dedentT, eofT]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IndentToken);
    expect(node.children[3]!.kind).toBe(SyntaxKind.StatementList);
    expect(node.children[4]!.kind).toBe(SyntaxKind.DedentToken);
    expect(node.diagnostics).toHaveLength(0);

    const stmtList = node.children[3] as GreenNode;
    expect(stmtList.children).toHaveLength(2);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node.reconstruct()).toBe(":\n    item\n");
  });

  test("bodyless block with newline but no indent", () => {
    const context = makeContext([colonT, newlineT, eofT]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.diagnostics).toHaveLength(0);
  });

  test("bodyless block with colon only (no newline, no indent)", () => {
    const context = makeContext([colonT, eofT]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node.diagnostics).toHaveLength(0);
  });

  test("unterminated block emits PARSE_UNTERMINATED_BLOCK", () => {
    const context = makeContext([colonT, newlineT, indentT, identT, newline2T, eofT]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ColonToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.IndentToken);
    expect(node.children[3]!.kind).toBe(SyntaxKind.StatementList);

    const unterminatedDiagnostic = node.diagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_UNTERMINATED_BLOCK",
    );
    expect(unterminatedDiagnostic).toBeDefined();
  });

  test("blank lines inside block are preserved as newlines in statement list", () => {
    const blankLineT = makeToken(TokenKind.Newline, "\n", 11, 12);
    const eofAfterBlankT = makeToken(TokenKind.Eof, "", 12, 12);
    const context = makeContext([
      colonT,
      newlineT,
      indentT,
      identT,
      newline2T,
      blankLineT,
      dedentT,
      eofAfterBlankT,
    ]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    const stmtList = node.children[3] as GreenNode;
    expect(stmtList.children).toHaveLength(3);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(stmtList.children[2]!.kind).toBe(SyntaxKind.NewlineToken);
  });

  test("optional colon consumes colon when present", () => {
    const context = makeContext([colonT, newlineT, indentT, identT, newline2T, dedentT, eofT]);

    const node = parseBlock(context, {
      optionalColon: true,
      itemParser,
      recoveryKinds,
    });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ColonToken);
  });

  test("optional colon does not require a colon", () => {
    const context = makeContext([newlineT, indentT, identT, newline2T, dedentT, eofT]);

    const node = parseBlock(context, {
      optionalColon: true,
      itemParser,
      recoveryKinds,
    });

    expect(node.kind).toBe(SyntaxKind.Block);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.IndentToken);
    expect(node.children[2]!.kind).toBe(SyntaxKind.StatementList);
    expect(node.children[3]!.kind).toBe(SyntaxKind.DedentToken);
    expect(node.diagnostics).toHaveLength(0);
  });

  test("recovery from unexpected tokens wraps skipped tokens", () => {
    const bangT = makeToken(TokenKind.Invalid, "!", 6, 7);
    const atT = makeToken(TokenKind.Invalid, "@", 7, 8);
    const newlineBetweenT = makeToken(TokenKind.Newline, "\n", 8, 9);
    const identAfterT = makeToken(TokenKind.Identifier, "item", 9, 13);
    const newlineAfterT = makeToken(TokenKind.Newline, "\n", 13, 14);
    const dedentAfterT = makeToken(TokenKind.Dedent, "", 14, 14);
    const eofAfterT = makeToken(TokenKind.Eof, "", 14, 14);
    const context = makeContext([
      colonT,
      newlineT,
      indentT,
      bangT,
      atT,
      newlineBetweenT,
      identAfterT,
      newlineAfterT,
      dedentAfterT,
      eofAfterT,
    ]);

    const node = parseBlock(context, { itemParser, recoveryKinds });

    const stmtList = node.children[3] as GreenNode;
    expect(stmtList.children).toHaveLength(4);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.SkippedTokens);
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(stmtList.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(stmtList.children[3]!.kind).toBe(SyntaxKind.NewlineToken);

    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.children).toHaveLength(2);
    expect(skipped.children[0]!.reconstruct()).toBe("!");
    expect(skipped.children[1]!.reconstruct()).toBe("@");
  });
});

describe("parseStatementList", () => {
  test("empty statement list with immediate dedent", () => {
    const context = makeContext([dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(0);
  });

  test("statement list with only newlines", () => {
    const nl1 = makeToken(TokenKind.Newline, "\n", 0, 1);
    const nl2 = makeToken(TokenKind.Newline, "\n", 1, 2);
    const context = makeContext([nl1, nl2, dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
  });

  test("statement list recovers from unexpected tokens", () => {
    const bangT = makeToken(TokenKind.Invalid, "!", 0, 1);
    const context = makeContext([bangT, dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.SkippedTokens);
  });

  test("statement list parses items with provided parser", () => {
    const context = makeContext([identT, newline2T, dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
  });

  test("statement list accepts a newline consumed by the parsed item", () => {
    const secondIdent = makeToken(TokenKind.Identifier, "next", 11, 15);
    const finalNewline = makeToken(TokenKind.Newline, "\n", 15, 16);
    const finalDedent = makeToken(TokenKind.Dedent, "", 16, 16);
    const finalEof = makeToken(TokenKind.Eof, "", 16, 16);
    const context = makeContext([
      identT,
      newline2T,
      secondIdent,
      finalNewline,
      finalDedent,
      finalEof,
    ]);

    const node = parseStatementList(context, itemParserWithOwnedNewline);

    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.children[1]!.kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "PARSE_EXPECTED_STATEMENT_SEPARATOR",
    );
  });

  test("statement list stops at dedent", () => {
    const context = makeContext([dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(0);
  });

  test("statement list stops at EOF", () => {
    const context = makeContext([eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.kind).toBe(SyntaxKind.StatementList);
    expect(node.children).toHaveLength(0);
  });

  test("statement list reconstructs correctly", () => {
    const context = makeContext([identT, newline2T, dedentT, eofT]);

    const node = parseStatementList(context, itemParser);

    expect(node.reconstruct()).toBe("item\n");
  });
});

describe("tryParseStatement", () => {
  test("returns undefined for unrecognized token", () => {
    const pipeT = makeToken(TokenKind.Invalid, "|", 0, 1);
    const context = makeContext([pipeT, eofT]);

    const result = tryParseStatement(context);

    expect(result).toBeUndefined();
  });

  test("returns ExpressionStatement for identifier token", () => {
    const context = makeContext([identT, eofT]);

    const result = tryParseStatement(context);

    expect(result).not.toBeUndefined();
    expect((result as GreenNode).kind).toBe(SyntaxKind.ExpressionStatement);
  });
});

describe("expectNewline", () => {
  test("consumes newline when present", () => {
    const context = makeContext([newlineT, eofT]);

    const token = expectNewline(context);

    expect(token.kind).toBe(SyntaxKind.NewlineToken);
    expect(token.isMissing).toBe(false);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits missing newline and diagnostic when not present", () => {
    const context = makeContext([identT, eofT]);

    const token = expectNewline(context);

    expect(token.kind).toBe(SyntaxKind.NewlineToken);
    expect(token.isMissing).toBe(true);
    expect(context.draftDiagnostics()).toHaveLength(1);
    expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { parseSourceFile } from "../../../../src/frontend/parser/source-file-parser";
import { parseBlock, tryParseStatement } from "../../../../src/frontend/parser/block-parser";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";

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

function makeLexedContextWithDepth(sourceText: string, maxDepth: number): ParserContext {
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const lexResult = lexer.lex(SourceText.from("depth.wr", sourceText));
  return new ParserContext({
    tokens: lexResult.tokens,
    factory: new SyntaxFactory(),
    maxDepth,
  });
}

const recoveryKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

describe("top-level recovery", () => {
  test("broken top-level token is wrapped in ErrorNode followed by valid image declaration", () => {
    const atToken = makeToken(TokenKind.At, "@", 0, 1);
    const newlineToken = makeToken(TokenKind.Newline, "\n", 1, 2);
    const uefiToken = makeToken(TokenKind.Uefi, "uefi", 2, 6);
    const imageToken = makeToken(TokenKind.Image, "image", 7, 12);
    const nameToken = makeToken(TokenKind.Identifier, "Main", 13, 17);
    const colonToken = makeToken(TokenKind.Colon, ":", 17, 18);
    const newlineToken2 = makeToken(TokenKind.Newline, "\n", 18, 18);
    const eofToken = makeToken(TokenKind.Eof, "", 18, 18);

    const context = makeContext([
      atToken,
      newlineToken,
      uefiToken,
      imageToken,
      nameToken,
      colonToken,
      newlineToken2,
      eofToken,
    ]);
    const node = parseSourceFile(context);

    expect(node.kind).toBe(SyntaxKind.SourceFile);

    const children = node.children.filter(
      (child) => child.kind !== SyntaxKind.EndOfFileToken && child.kind !== SyntaxKind.NewlineToken,
    );

    expect(children.length).toBe(2);
    expect(children[0]!.kind).toBe(SyntaxKind.ErrorNode);
    expect(children[1]!.kind).toBe(SyntaxKind.ImageDeclaration);

    const errorNode = children[0] as GreenNode;
    expect(errorNode.children.length).toBe(1);
    expect(errorNode.children[0]!.reconstruct()).toBe("@");

    const recoveredDiag = node.diagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
    );
    expect(recoveredDiag).toBeDefined();
  });

  test("malformed top-level does not prevent later valid declarations", () => {
    const atToken = makeToken(TokenKind.At, "@", 0, 1);
    const newlineToken = makeToken(TokenKind.Newline, "\n", 1, 2);
    const atToken2 = makeToken(TokenKind.At, "@", 2, 3);
    const newlineToken2 = makeToken(TokenKind.Newline, "\n", 3, 4);
    const uefiToken = makeToken(TokenKind.Uefi, "uefi", 4, 8);
    const imageToken = makeToken(TokenKind.Image, "image", 9, 14);
    const nameToken = makeToken(TokenKind.Identifier, "Main", 15, 19);
    const colonToken = makeToken(TokenKind.Colon, ":", 19, 20);
    const newlineToken3 = makeToken(TokenKind.Newline, "\n", 20, 20);
    const eofToken = makeToken(TokenKind.Eof, "", 20, 20);

    const context = makeContext([
      atToken,
      newlineToken,
      atToken2,
      newlineToken2,
      uefiToken,
      imageToken,
      nameToken,
      colonToken,
      newlineToken3,
      eofToken,
    ]);
    const node = parseSourceFile(context);

    const errorNodes = node.children.filter(
      (child) => child.kind === SyntaxKind.ErrorNode,
    ) as GreenNode[];
    expect(errorNodes.length).toBeGreaterThanOrEqual(1);

    const imageDecl = node.children.find((child) => child.kind === SyntaxKind.ImageDeclaration);
    expect(imageDecl).toBeDefined();
  });

  test("repeated unexpected tokens at top level do not cause infinite loop", () => {
    const atToken1 = makeToken(TokenKind.At, "@", 0, 1);
    const atToken2 = makeToken(TokenKind.At, "@", 1, 2);
    const atToken3 = makeToken(TokenKind.At, "@", 2, 3);
    const atToken4 = makeToken(TokenKind.At, "@", 3, 4);
    const atToken5 = makeToken(TokenKind.At, "@", 4, 5);
    const eofToken = makeToken(TokenKind.Eof, "", 5, 5);

    const context = makeContext([atToken1, atToken2, atToken3, atToken4, atToken5, eofToken]);
    const node = parseSourceFile(context);

    expect(node.kind).toBe(SyntaxKind.SourceFile);

    const errorNodes = node.children.filter((child) => child.kind === SyntaxKind.ErrorNode);
    expect(errorNodes.length).toBe(1);

    const skipped = (errorNodes[0] as GreenNode).children;
    expect(skipped.length).toBe(5);
  });

  test("repeated invalid tokens at top level do not cause infinite loop", () => {
    const invalidToken1 = makeToken(TokenKind.Invalid, "!", 0, 1);
    const invalidToken2 = makeToken(TokenKind.Invalid, "!", 1, 2);
    const invalidToken3 = makeToken(TokenKind.Invalid, "!", 2, 3);
    const eofToken = makeToken(TokenKind.Eof, "", 3, 3);

    const context = makeContext([invalidToken1, invalidToken2, invalidToken3, eofToken]);
    const node = parseSourceFile(context);

    expect(node.kind).toBe(SyntaxKind.SourceFile);
  });
});

describe("block recovery", () => {
  test("broken block item followed by valid statement", () => {
    const colonToken = makeToken(TokenKind.Colon, ":", 0, 1);
    const newlineToken = makeToken(TokenKind.Newline, "\n", 1, 2);
    const indentToken = makeToken(TokenKind.Indent, "  ", 2, 4);
    const atToken = makeToken(TokenKind.At, "@", 4, 5);
    const newlineToken2 = makeToken(TokenKind.Newline, "\n", 5, 6);
    const identToken = makeToken(TokenKind.Identifier, "item", 6, 10);
    const newlineToken3 = makeToken(TokenKind.Newline, "\n", 10, 11);
    const dedentToken = makeToken(TokenKind.Dedent, "", 11, 11);
    const eofToken = makeToken(TokenKind.Eof, "", 11, 11);

    const context = makeContext([
      colonToken,
      newlineToken,
      indentToken,
      atToken,
      newlineToken2,
      identToken,
      newlineToken3,
      dedentToken,
      eofToken,
    ]);

    const block = parseBlock(context, {
      itemParser: tryParseStatement,
      recoveryKinds,
    });

    expect(block.kind).toBe(SyntaxKind.Block);

    const stmtList = block.children.find(
      (child) => child.kind === SyntaxKind.StatementList,
    ) as GreenNode;
    expect(stmtList).toBeDefined();

    const skippedNodes = stmtList.children.filter(
      (child) => child.kind === SyntaxKind.SkippedTokens,
    );
    expect(skippedNodes.length).toBe(1);

    const validNode = stmtList.children.find(
      (child) => child.kind === SyntaxKind.ExpressionStatement,
    );
    expect(validNode).toBeDefined();
  });

  test("repeated unexpected tokens inside block do not cause infinite loop", () => {
    const colonToken = makeToken(TokenKind.Colon, ":", 0, 1);
    const newlineToken = makeToken(TokenKind.Newline, "\n", 1, 2);
    const indentToken = makeToken(TokenKind.Indent, "  ", 2, 8);
    const atToken1 = makeToken(TokenKind.At, "@", 8, 9);
    const atToken2 = makeToken(TokenKind.At, "@", 9, 10);
    const atToken3 = makeToken(TokenKind.At, "@", 10, 11);
    const newlineToken2 = makeToken(TokenKind.Newline, "\n", 11, 12);
    const dedentToken = makeToken(TokenKind.Dedent, "", 12, 12);
    const eofToken = makeToken(TokenKind.Eof, "", 12, 12);

    const context = makeContext([
      colonToken,
      newlineToken,
      indentToken,
      atToken1,
      atToken2,
      atToken3,
      newlineToken2,
      dedentToken,
      eofToken,
    ]);

    const block = parseBlock(context, {
      itemParser: tryParseStatement,
      recoveryKinds,
    });

    expect(block.kind).toBe(SyntaxKind.Block);

    const stmtList = block.children.find(
      (child) => child.kind === SyntaxKind.StatementList,
    ) as GreenNode;
    expect(stmtList).toBeDefined();
    expect(stmtList.children.length).toBeGreaterThan(0);
  });
});

function collectAllDiagnostics(node: GreenNode): readonly any[] {
  const result: any[] = [...node.diagnostics];
  for (const child of node.children) {
    if (child instanceof GreenNode) {
      result.push(...collectAllDiagnostics(child));
    }
  }
  return result;
}

describe("nesting depth", () => {
  test("PARSE_NESTING_LIMIT_EXCEEDED is emitted instead of stack overflow with maxDepth 2", () => {
    const context = makeLexedContextWithDepth(
      [
        "fn main() -> Never:",
        "    if true:",
        "        if true:",
        "            if true:",
        "                continue",
        "",
      ].join("\n"),
      2,
    );
    const node = parseSourceFile(context);

    const allDiagnostics = collectAllDiagnostics(node);
    const nestingDiag = allDiagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_NESTING_LIMIT_EXCEEDED",
    );
    expect(nestingDiag).toBeDefined();
  });
});

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
  parseIfStatement,
  parseWhileStatement,
  parseForStatement,
  parseTakeStatement,
} from "../../../../src/frontend/parser/control-statement-parser";

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

describe("parseIfStatement", () => {
  test("if statement with condition and block", () => {
    const tokens = [
      makeToken(TokenKind.If, "if", 0, 2),
      makeToken(TokenKind.Identifier, "x", 2, 3),
      makeToken(TokenKind.Colon, ":", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Indent, "    ", 5, 9),
      makeToken(TokenKind.Identifier, "y", 9, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Dedent, "", 11, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseIfStatement(context);

    expect(node.kind).toBe(SyntaxKind.IfStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Condition);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("ifx:\n    y\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("if with let-condition", () => {
    const tokens = [
      makeToken(TokenKind.If, "if", 0, 2),
      makeToken(TokenKind.Let, "let", 2, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Equals, "=", 6, 7),
      makeToken(TokenKind.IntegerLiteral, "42", 7, 9),
      makeToken(TokenKind.Colon, ":", 9, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Indent, "    ", 11, 15),
      makeToken(TokenKind.Dedent, "", 15, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseIfStatement(context);

    expect(node.kind).toBe(SyntaxKind.IfStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    const condition = node.children[1] as GreenNode;
    expect(condition.kind).toBe(SyntaxKind.Condition);
    expect(condition.children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect(node.reconstruct()).toBe("ifletx=42:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("if/else with block", () => {
    const tokens = [
      makeToken(TokenKind.If, "if", 0, 2),
      makeToken(TokenKind.Identifier, "x", 2, 3),
      makeToken(TokenKind.Colon, ":", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Indent, "    ", 5, 9),
      makeToken(TokenKind.Dedent, "", 9, 9),
      makeToken(TokenKind.Else, "else", 9, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "    ", 15, 19),
      makeToken(TokenKind.Identifier, "z", 19, 20),
      makeToken(TokenKind.Newline, "\n", 20, 21),
      makeToken(TokenKind.Dedent, "", 21, 21),
      makeToken(TokenKind.Eof, "", 21, 21),
    ];
    const context = makeContext(tokens);
    const node = parseIfStatement(context);

    expect(node.kind).toBe(SyntaxKind.IfStatement);
    expect(node.children).toHaveLength(5);
    const elseClause = node.children[4] as GreenNode;
    expect(elseClause.kind).toBe(SyntaxKind.ElseClause);
    expect(elseClause.children[0]!.kind).toBe(SyntaxKind.ElseKeyword);
    expect(elseClause.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((elseClause.children[2] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("ifx:\n    else:\n    z\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("if/else with single statement", () => {
    const tokens = [
      makeToken(TokenKind.If, "if", 0, 2),
      makeToken(TokenKind.Identifier, "x", 2, 3),
      makeToken(TokenKind.Colon, ":", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Indent, "    ", 5, 9),
      makeToken(TokenKind.Dedent, "", 9, 9),
      makeToken(TokenKind.Else, "else", 9, 13),
      makeToken(TokenKind.Identifier, "z", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseIfStatement(context);

    expect(node.kind).toBe(SyntaxKind.IfStatement);
    const elseClause = node.children[4] as GreenNode;
    expect(elseClause.kind).toBe(SyntaxKind.ElseClause);
    expect((elseClause.children[1] as GreenNode).kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.reconstruct()).toBe("ifx:\n    elsez\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.If, "if", 0, 2),
      makeToken(TokenKind.Identifier, "x", 2, 3),
      makeToken(TokenKind.Colon, ":", 3, 4),
      makeToken(TokenKind.Newline, "\n", 4, 5),
      makeToken(TokenKind.Indent, "    ", 5, 9),
      makeToken(TokenKind.Identifier, "y", 9, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Dedent, "", 11, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseIfStatement(context);

    expect(node.reconstruct()).toBe("ifx:\n    y\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseWhileStatement", () => {
  test("while statement with condition and block", () => {
    const tokens = [
      makeToken(TokenKind.While, "while", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Identifier, "y", 12, 13),
      makeToken(TokenKind.Newline, "\n", 13, 14),
      makeToken(TokenKind.Dedent, "", 14, 14),
      makeToken(TokenKind.Eof, "", 14, 14),
    ];
    const context = makeContext(tokens);
    const node = parseWhileStatement(context);

    expect(node.kind).toBe(SyntaxKind.WhileStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.WhileKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Condition);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("whilex:\n    y\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("while reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.While, "while", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Colon, ":", 6, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Indent, "    ", 8, 12),
      makeToken(TokenKind.Dedent, "", 12, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseWhileStatement(context);

    expect(node.reconstruct()).toBe("whilex:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseForStatement", () => {
  test("for statement with pattern", () => {
    const tokens = [
      makeToken(TokenKind.For, "for", 0, 3),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.In, "in", 4, 6),
      makeToken(TokenKind.Identifier, "items", 6, 11),
      makeToken(TokenKind.Colon, ":", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Indent, "    ", 13, 17),
      makeToken(TokenKind.Dedent, "", 17, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseForStatement(context);

    expect(node.kind).toBe(SyntaxKind.ForStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ForKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[2]!.kind).toBe(SyntaxKind.InKeyword);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[5] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("forxinitems:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("for reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.For, "for", 0, 3),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.In, "in", 4, 6),
      makeToken(TokenKind.Identifier, "items", 6, 11),
      makeToken(TokenKind.Colon, ":", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Indent, "    ", 13, 17),
      makeToken(TokenKind.Dedent, "", 17, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseForStatement(context);

    expect(node.reconstruct()).toBe("forxinitems:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseTakeStatement", () => {
  test("take with as clause", () => {
    const tokens = [
      makeToken(TokenKind.Take, "take", 0, 4),
      makeToken(TokenKind.Identifier, "value", 4, 9),
      makeToken(TokenKind.As, "as", 9, 11),
      makeToken(TokenKind.Identifier, "x", 11, 12),
      makeToken(TokenKind.Colon, ":", 12, 13),
      makeToken(TokenKind.Newline, "\n", 13, 14),
      makeToken(TokenKind.Indent, "    ", 14, 18),
      makeToken(TokenKind.Dedent, "", 18, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseTakeStatement(context);

    expect(node.kind).toBe(SyntaxKind.TakeStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.AsKeyword);
    expect(node.children[3]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(node.children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[5] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("takevalueasx:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("take without as clause", () => {
    const tokens = [
      makeToken(TokenKind.Take, "take", 0, 4),
      makeToken(TokenKind.Identifier, "value", 4, 9),
      makeToken(TokenKind.Colon, ":", 9, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Indent, "    ", 11, 15),
      makeToken(TokenKind.Dedent, "", 15, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseTakeStatement(context);

    expect(node.kind).toBe(SyntaxKind.TakeStatement);
    expect(node.children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("takevalue:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("take reconstruction exactness", () => {
    const tokens = [
      makeToken(TokenKind.Take, "take", 0, 4),
      makeToken(TokenKind.Identifier, "value", 4, 9),
      makeToken(TokenKind.As, "as", 9, 11),
      makeToken(TokenKind.Identifier, "x", 11, 12),
      makeToken(TokenKind.Colon, ":", 12, 13),
      makeToken(TokenKind.Newline, "\n", 13, 14),
      makeToken(TokenKind.Indent, "    ", 14, 18),
      makeToken(TokenKind.Dedent, "", 18, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseTakeStatement(context);

    expect(node.reconstruct()).toBe("takevalueasx:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

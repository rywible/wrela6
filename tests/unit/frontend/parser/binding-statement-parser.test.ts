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
  parseLetStatement,
  parseReturnStatement,
  parseYieldStatement,
  parseContinueStatement,
  parseLoopStatement,
} from "../../../../src/frontend/parser/binding-statement-parser";

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

describe("parseLetStatement", () => {
  test("let with pattern and expression", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.Equals, "=", 4, 5),
      makeToken(TokenKind.IntegerLiteral, "42", 5, 7),
      makeToken(TokenKind.Newline, "\n", 7, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parseLetStatement(context);

    expect(node.kind).toBe(SyntaxKind.LetStatement);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[2]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children[4]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("letx=42\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("let with type annotation", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.Colon, ":", 4, 5),
      makeToken(TokenKind.Identifier, "Int", 5, 8),
      makeToken(TokenKind.Equals, "=", 8, 9),
      makeToken(TokenKind.IntegerLiteral, "5", 9, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseLetStatement(context);

    expect(node.kind).toBe(SyntaxKind.LetStatement);
    expect(node.children).toHaveLength(7);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LetKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.Pattern);
    expect(node.children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.TypeReference);
    expect(node.children[4]!.kind).toBe(SyntaxKind.EqualsToken);
    expect((node.children[5] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children[6]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("letx:Int=5\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("let without trailing newline", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "x", 3, 4),
      makeToken(TokenKind.Equals, "=", 4, 5),
      makeToken(TokenKind.IntegerLiteral, "1", 5, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseLetStatement(context);

    expect(node.kind).toBe(SyntaxKind.LetStatement);
    expect(node.children).toHaveLength(4);
    expect(node.reconstruct()).toBe("letx=1");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("let rejects true as a binding pattern", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.True, "true", 4, 8),
      makeToken(TokenKind.Equals, "=", 9, 10),
      makeToken(TokenKind.IntegerLiteral, "1", 11, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseLetStatement(context);

    expect(node.kind).toBe(SyntaxKind.LetStatement);
    expect(context.draftDiagnostics().map((diagnostic) => diagnostic.code)).toContain(
      "PARSE_EXPECTED_TOKEN",
    );
  });

  test("reconstructs exact source", () => {
    const tokens = [
      makeToken(TokenKind.Let, "let", 0, 3),
      makeToken(TokenKind.Identifier, "counter", 3, 10),
      makeToken(TokenKind.Colon, ":", 10, 11),
      makeToken(TokenKind.Identifier, "Int", 11, 14),
      makeToken(TokenKind.Equals, "=", 14, 15),
      makeToken(TokenKind.IntegerLiteral, "0", 15, 16),
      makeToken(TokenKind.Newline, "\n", 16, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseLetStatement(context);

    expect(node.kind).toBe(SyntaxKind.LetStatement);
    expect(node.reconstruct()).toBe("letcounter:Int=0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseReturnStatement", () => {
  test("return with expression", () => {
    const tokens = [
      makeToken(TokenKind.Return, "return", 0, 6),
      makeToken(TokenKind.IntegerLiteral, "42", 6, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseReturnStatement(context);

    expect(node.kind).toBe(SyntaxKind.ReturnStatement);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ReturnKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("return42\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("return without expression", () => {
    const tokens = [
      makeToken(TokenKind.Return, "return", 0, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseReturnStatement(context);

    expect(node.kind).toBe(SyntaxKind.ReturnStatement);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ReturnKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("return\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("return without expression and without newline", () => {
    const tokens = [
      makeToken(TokenKind.Return, "return", 0, 6),
      makeToken(TokenKind.Eof, "", 6, 6),
    ];
    const context = makeContext(tokens);
    const node = parseReturnStatement(context);

    expect(node.kind).toBe(SyntaxKind.ReturnStatement);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ReturnKeyword);
    expect(node.reconstruct()).toBe("return");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("return reconstructs exact source", () => {
    const tokens = [
      makeToken(TokenKind.Return, "return", 0, 6),
      makeToken(TokenKind.Identifier, "result", 6, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseReturnStatement(context);

    expect(node.reconstruct()).toBe("returnresult\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseYieldStatement", () => {
  test("yield with expression", () => {
    const tokens = [
      makeToken(TokenKind.Yield, "yield", 0, 5),
      makeToken(TokenKind.IntegerLiteral, "1", 5, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseYieldStatement(context);

    expect(node.kind).toBe(SyntaxKind.YieldStatement);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.YieldKeyword);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.LiteralExpression);
    expect(node.children[2]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("yield1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("yield with identifier expression", () => {
    const tokens = [
      makeToken(TokenKind.Yield, "yield", 0, 5),
      makeToken(TokenKind.Identifier, "value", 5, 10),
      makeToken(TokenKind.Newline, "\n", 10, 11),
      makeToken(TokenKind.Eof, "", 11, 11),
    ];
    const context = makeContext(tokens);
    const node = parseYieldStatement(context);

    expect(node.kind).toBe(SyntaxKind.YieldStatement);
    expect(node.children).toHaveLength(3);
    expect((node.children[1] as GreenNode).kind).toBe(SyntaxKind.NameExpression);
    expect(node.reconstruct()).toBe("yieldvalue\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("yield reconstructs exact source", () => {
    const tokens = [
      makeToken(TokenKind.Yield, "yield", 0, 5),
      makeToken(TokenKind.Identifier, "x", 5, 6),
      makeToken(TokenKind.Newline, "\n", 6, 7),
      makeToken(TokenKind.Eof, "", 7, 7),
    ];
    const context = makeContext(tokens);
    const node = parseYieldStatement(context);

    expect(node.reconstruct()).toBe("yieldx\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseContinueStatement", () => {
  test("continue consumes newline", () => {
    const tokens = [
      makeToken(TokenKind.Continue, "continue", 0, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseContinueStatement(context);

    expect(node.kind).toBe(SyntaxKind.ContinueStatement);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ContinueKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("continue\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("continue without trailing newline", () => {
    const tokens = [
      makeToken(TokenKind.Continue, "continue", 0, 8),
      makeToken(TokenKind.Eof, "", 8, 8),
    ];
    const context = makeContext(tokens);
    const node = parseContinueStatement(context);

    expect(node.kind).toBe(SyntaxKind.ContinueStatement);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.kind).toBe(SyntaxKind.ContinueKeyword);
    expect(node.reconstruct()).toBe("continue");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("continue reconstructs exact source", () => {
    const tokens = [
      makeToken(TokenKind.Continue, "continue", 0, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseContinueStatement(context);

    expect(node.reconstruct()).toBe("continue\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseLoopStatement", () => {
  test("loop with empty block", () => {
    const tokens = [
      makeToken(TokenKind.Loop, "loop", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Indent, "    ", 6, 10),
      makeToken(TokenKind.Dedent, "", 10, 10),
      makeToken(TokenKind.Eof, "", 10, 10),
    ];
    const context = makeContext(tokens);
    const node = parseLoopStatement(context);

    expect(node.kind).toBe(SyntaxKind.LoopStatement);
    expect(node.children).toHaveLength(3);
    expect(node.children[0]!.kind).toBe(SyntaxKind.LoopKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("loop:\n    ");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("loop with statement in block", () => {
    const tokens = [
      makeToken(TokenKind.Loop, "loop", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Indent, "    ", 6, 10),
      makeToken(TokenKind.Identifier, "x", 10, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Dedent, "", 12, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseLoopStatement(context);

    expect(node.kind).toBe(SyntaxKind.LoopStatement);
    expect(node.children).toHaveLength(3);
    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.ExpressionStatement);
    expect(node.reconstruct()).toBe("loop:\n    x\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("loop reconstructs exact source", () => {
    const tokens = [
      makeToken(TokenKind.Loop, "loop", 0, 4),
      makeToken(TokenKind.Colon, ":", 4, 5),
      makeToken(TokenKind.Newline, "\n", 5, 6),
      makeToken(TokenKind.Indent, "    ", 6, 10),
      makeToken(TokenKind.Identifier, "x", 10, 11),
      makeToken(TokenKind.Newline, "\n", 11, 12),
      makeToken(TokenKind.Dedent, "", 12, 12),
      makeToken(TokenKind.Eof, "", 12, 12),
    ];
    const context = makeContext(tokens);
    const node = parseLoopStatement(context);

    expect(node.reconstruct()).toBe("loop:\n    x\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

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
  parseFunctionDeclaration,
  parseRequiresSection,
  isFunctionStarter,
} from "../../../../src/frontend/parser/function-declaration-parser";

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

describe("isFunctionStarter", () => {
  test("returns true for fn keyword", () => {
    expect(isFunctionStarter(SyntaxKind.FnKeyword)).toBe(true);
  });

  test("returns true for modifier keywords", () => {
    expect(isFunctionStarter(SyntaxKind.ConstructorKeyword)).toBe(true);
    expect(isFunctionStarter(SyntaxKind.TerminalKeyword)).toBe(true);
    expect(isFunctionStarter(SyntaxKind.PredicateKeyword)).toBe(true);
    expect(isFunctionStarter(SyntaxKind.PlatformKeyword)).toBe(true);
    expect(isFunctionStarter(SyntaxKind.PrivateKeyword)).toBe(true);
  });

  test("returns false for non-function starters", () => {
    expect(isFunctionStarter(SyntaxKind.EnumKeyword)).toBe(false);
    expect(isFunctionStarter(SyntaxKind.UseKeyword)).toBe(false);
    expect(isFunctionStarter(SyntaxKind.LetKeyword)).toBe(false);
    expect(isFunctionStarter(SyntaxKind.IdentifierToken)).toBe(false);
  });
});

describe("parseFunctionDeclaration", () => {
  test("parses bodyless function fn foo()", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(node.children[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("fn");
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[1] as GreenToken).lexeme).toBe("foo");
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect(node.children[3]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.reconstruct()).toBe("fnfoo()\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses function with block body fn foo():\n    1", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "", 10, 10),
      makeToken(TokenKind.IntegerLiteral, "1", 11, 12),
      makeToken(TokenKind.Newline, "\n", 12, 13),
      makeToken(TokenKind.Dedent, "", 13, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("fnfoo():\n1\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses function with return type and body", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "Int", 9, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Arrow, "->", 14, 16),
      makeToken(TokenKind.Identifier, "Bool", 17, 21),
      makeToken(TokenKind.Colon, ":", 21, 22),
      makeToken(TokenKind.Newline, "\n", 22, 23),
      makeToken(TokenKind.Indent, "", 23, 23),
      makeToken(TokenKind.Identifier, "x", 24, 25),
      makeToken(TokenKind.Newline, "\n", 25, 26),
      makeToken(TokenKind.Dedent, "", 26, 26),
      makeToken(TokenKind.Eof, "", 26, 26),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.ReturnTypeClause);
    expect((node.children[4] as GreenNode).kind).toBe(SyntaxKind.Block);
    expect(node.reconstruct()).toBe("fnfoo(x:Int)->Bool:\nx\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses function with requires section and body", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "Int", 9, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "", 15, 15),
      makeToken(TokenKind.Requires, "requires", 16, 24),
      makeToken(TokenKind.Colon, ":", 24, 25),
      makeToken(TokenKind.Newline, "\n", 25, 26),
      makeToken(TokenKind.Indent, "", 26, 26),
      makeToken(TokenKind.Identifier, "x", 27, 28),
      makeToken(TokenKind.Greater, ">", 29, 30),
      makeToken(TokenKind.IntegerLiteral, "0", 31, 32),
      makeToken(TokenKind.Newline, "\n", 32, 33),
      makeToken(TokenKind.Dedent, "", 33, 33),
      makeToken(TokenKind.Identifier, "x", 34, 35),
      makeToken(TokenKind.Newline, "\n", 35, 36),
      makeToken(TokenKind.Dedent, "", 36, 36),
      makeToken(TokenKind.Eof, "", 36, 36),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(node.children).toHaveLength(4);
    expect(node.children[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[3] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(2);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.RequiresSection);
    expect((stmtList.children[1] as GreenNode).kind).toBe(SyntaxKind.ExpressionStatement);

    expect(node.reconstruct()).toBe("fnfoo(x:Int):\nrequires:\nx>0\nx\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses function with requires section only (no body statements)", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "", 10, 10),
      makeToken(TokenKind.Requires, "requires", 11, 19),
      makeToken(TokenKind.Colon, ":", 19, 20),
      makeToken(TokenKind.Newline, "\n", 20, 21),
      makeToken(TokenKind.Indent, "", 21, 21),
      makeToken(TokenKind.Identifier, "x", 22, 23),
      makeToken(TokenKind.Greater, ">", 24, 25),
      makeToken(TokenKind.IntegerLiteral, "0", 26, 27),
      makeToken(TokenKind.Newline, "\n", 27, 28),
      makeToken(TokenKind.Dedent, "", 28, 28),
      makeToken(TokenKind.Dedent, "", 28, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(node.children).toHaveLength(4);
    expect((node.children[3] as GreenNode).kind).toBe(SyntaxKind.Block);

    const block = node.children[3] as GreenNode;
    const stmtList = block.children[3] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(1);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.RequiresSection);

    expect(node.reconstruct()).toBe("fnfoo():\nrequires:\nx>0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses bodyless function with requires section", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "", 9, 9),
      makeToken(TokenKind.Requires, "requires", 13, 21),
      makeToken(TokenKind.Colon, ":", 21, 22),
      makeToken(TokenKind.Newline, "\n", 22, 23),
      makeToken(TokenKind.Indent, "", 23, 23),
      makeToken(TokenKind.Identifier, "x", 28, 29),
      makeToken(TokenKind.Greater, ">", 30, 31),
      makeToken(TokenKind.IntegerLiteral, "0", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Dedent, "", 34, 34),
      makeToken(TokenKind.Dedent, "", 34, 34),
      makeToken(TokenKind.Eof, "", 34, 34),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.FunctionDeclaration);
    expect(node.children).toHaveLength(7);
    expect(node.children[0]!.kind).toBe(SyntaxKind.FnKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.ParameterList);
    expect(node.children[3]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(node.children[4]!.kind).toBe(SyntaxKind.IndentToken);
    expect((node.children[5] as GreenNode).kind).toBe(SyntaxKind.RequiresSection);
    expect(node.children[6]!.kind).toBe(SyntaxKind.DedentToken);

    const requiresSection = node.children[5] as GreenNode;
    expect(requiresSection.children[0]!.kind).toBe(SyntaxKind.RequiresKeyword);
    expect(requiresSection.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((requiresSection.children[2] as GreenNode).kind).toBe(SyntaxKind.Block);

    const innerBlock = requiresSection.children[2] as GreenNode;
    const stmtList = innerBlock.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(1);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.Requirement);

    expect(node.reconstruct()).toBe("fnfoo()\nrequires:\nx>0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text for bodyless function", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.RightParen, ")", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Eof, "", 9, 9),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    const source = "fnfoo()\n";
    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text for function with block body", () => {
    const tokens = [
      makeToken(TokenKind.Fn, "fn", 0, 2),
      makeToken(TokenKind.Identifier, "foo", 3, 6),
      makeToken(TokenKind.LeftParen, "(", 6, 7),
      makeToken(TokenKind.Identifier, "x", 7, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Identifier, "Int", 9, 12),
      makeToken(TokenKind.RightParen, ")", 12, 13),
      makeToken(TokenKind.Colon, ":", 13, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Indent, "", 15, 15),
      makeToken(TokenKind.Identifier, "x", 16, 17),
      makeToken(TokenKind.Newline, "\n", 17, 18),
      makeToken(TokenKind.Dedent, "", 18, 18),
      makeToken(TokenKind.Eof, "", 18, 18),
    ];
    const context = makeContext(tokens);
    const node = parseFunctionDeclaration(context);

    const source = "fnfoo(x:Int):\nx\n";
    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

describe("parseRequiresSection", () => {
  test("parses requires section with one requirement", () => {
    const tokens = [
      makeToken(TokenKind.Requires, "requires", 0, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "", 10, 10),
      makeToken(TokenKind.Identifier, "x", 11, 12),
      makeToken(TokenKind.Greater, ">", 13, 14),
      makeToken(TokenKind.IntegerLiteral, "0", 15, 16),
      makeToken(TokenKind.Newline, "\n", 16, 17),
      makeToken(TokenKind.Dedent, "", 17, 17),
      makeToken(TokenKind.Eof, "", 17, 17),
    ];
    const context = makeContext(tokens);
    const node = parseRequiresSection(context);

    expect(node.kind).toBe(SyntaxKind.RequiresSection);
    expect(node.children[0]!.kind).toBe(SyntaxKind.RequiresKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("requires");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);
    expect((node.children[2] as GreenNode).kind).toBe(SyntaxKind.Block);

    const innerBlock = node.children[2] as GreenNode;
    const stmtList = innerBlock.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(1);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.Requirement);

    const requirement = stmtList.children[0] as GreenNode;
    expect(requirement.children).toHaveLength(2);
    expect((requirement.children[0] as GreenNode).kind).toBe(SyntaxKind.ComparisonExpression);
    expect(requirement.children[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(node.reconstruct()).toBe("requires:\nx>0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses requires section with else requirement expression", () => {
    const tokens = [
      makeToken(TokenKind.Requires, "requires", 0, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "", 10, 10),
      makeToken(TokenKind.Identifier, "x", 11, 12),
      makeToken(TokenKind.Greater, ">", 13, 14),
      makeToken(TokenKind.IntegerLiteral, "0", 15, 16),
      makeToken(TokenKind.Else, "else", 17, 21),
      makeToken(TokenKind.StringLiteral, '"err"', 22, 27),
      makeToken(TokenKind.Newline, "\n", 27, 28),
      makeToken(TokenKind.Dedent, "", 28, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseRequiresSection(context);

    expect(node.kind).toBe(SyntaxKind.RequiresSection);

    const innerBlock = node.children[2] as GreenNode;
    const stmtList = innerBlock.children[2] as GreenNode;
    const requirement = stmtList.children[0] as GreenNode;
    expect(requirement.kind).toBe(SyntaxKind.Requirement);
    expect((requirement.children[0] as GreenNode).kind).toBe(SyntaxKind.ElseRequirementExpression);

    expect(node.reconstruct()).toBe('requires:\nx>0else"err"\n');
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses multiple requirements", () => {
    const tokens = [
      makeToken(TokenKind.Requires, "requires", 0, 8),
      makeToken(TokenKind.Colon, ":", 8, 9),
      makeToken(TokenKind.Newline, "\n", 9, 10),
      makeToken(TokenKind.Indent, "", 10, 10),
      makeToken(TokenKind.Identifier, "x", 11, 12),
      makeToken(TokenKind.Greater, ">", 13, 14),
      makeToken(TokenKind.IntegerLiteral, "0", 15, 16),
      makeToken(TokenKind.Newline, "\n", 16, 17),
      makeToken(TokenKind.Identifier, "y", 18, 19),
      makeToken(TokenKind.Greater, ">", 20, 21),
      makeToken(TokenKind.IntegerLiteral, "0", 22, 23),
      makeToken(TokenKind.Newline, "\n", 23, 24),
      makeToken(TokenKind.Dedent, "", 24, 24),
      makeToken(TokenKind.Eof, "", 24, 24),
    ];
    const context = makeContext(tokens);
    const node = parseRequiresSection(context);

    expect(node.kind).toBe(SyntaxKind.RequiresSection);

    const innerBlock = node.children[2] as GreenNode;
    const stmtList = innerBlock.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(2);
    expect((stmtList.children[0] as GreenNode).kind).toBe(SyntaxKind.Requirement);
    expect((stmtList.children[1] as GreenNode).kind).toBe(SyntaxKind.Requirement);

    expect(node.reconstruct()).toBe("requires:\nx>0\ny>0\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});

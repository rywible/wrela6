import { describe, expect, test } from "bun:test";
import { GreenTrivia } from "../../../../src/frontend/syntax/green-trivia";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";
import { Token } from "../../../../src/frontend/lexer/token";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { SourceSpan } from "../../../../src/shared/source-span";

function sourceSpan(start: number, end: number): SourceSpan {
  return SourceSpan.from(start, end);
}

describe("GreenTrivia", () => {
  test("stores kind and lexeme", () => {
    const greenTrivia = new GreenTrivia(TriviaKind.Whitespace, "  ");
    expect(greenTrivia.kind).toBe(TriviaKind.Whitespace);
    expect(greenTrivia.lexeme).toBe("  ");
  });

  test("width equals lexeme length", () => {
    const greenTrivia = new GreenTrivia(TriviaKind.LineComment, "// foo");
    expect(greenTrivia.width).toBe(6);
  });

  test("reconstruct returns lexeme", () => {
    const greenTrivia = new GreenTrivia(TriviaKind.Newline, "\n");
    expect(greenTrivia.reconstruct()).toBe("\n");
  });

  test("is immutable (no setters exposed)", () => {
    const greenTrivia = new GreenTrivia(TriviaKind.BlockComment, "/* hi */");
    expect(() => {
      // @ts-expect-error - intentional mutation attempt
      greenTrivia.lexeme = "changed";
    }).toThrow();
  });
});

describe("GreenToken", () => {
  test("fromToken creates a token with correct kind and lexeme", () => {
    const lexerToken = new Token({
      kind: TokenKind.Identifier,
      lexeme: "foo",
      span: sourceSpan(0, 3),
      leadingTrivia: [],
      trailingTrivia: [],
    });
    const green = GreenToken.fromToken(lexerToken);
    expect(green.kind).toBe(SyntaxKind.IdentifierToken);
    expect(green.lexeme).toBe("foo");
    expect(green.width).toBe(3);
    expect(green.isMissing).toBe(false);
  });

  test("fromToken wraps leading and trailing trivia", () => {
    const lexerToken = new Token({
      kind: TokenKind.Let,
      lexeme: "let",
      leadingTrivia: [
        new Trivia({ kind: TriviaKind.Whitespace, lexeme: "  ", span: sourceSpan(0, 2) }),
      ],
      trailingTrivia: [
        new Trivia({ kind: TriviaKind.Newline, lexeme: "\n", span: sourceSpan(5, 6) }),
      ],
      span: sourceSpan(2, 5),
    });
    const green = GreenToken.fromToken(lexerToken);
    expect(green.kind).toBe(SyntaxKind.LetKeyword);
    expect(green.lexeme).toBe("let");
    expect(green.leadingTrivia).toHaveLength(1);
    expect(green.leadingTrivia[0]!.kind).toBe(TriviaKind.Whitespace);
    expect(green.leadingTrivia[0]!.lexeme).toBe("  ");
    expect(green.trailingTrivia).toHaveLength(1);
    expect(green.trailingTrivia[0]!.kind).toBe(TriviaKind.Newline);
    expect(green.trailingTrivia[0]!.lexeme).toBe("\n");
  });

  test("reconstruct concatenates leading trivia + lexeme + trailing trivia", () => {
    const lexerToken = new Token({
      kind: TokenKind.Identifier,
      lexeme: "x",
      leadingTrivia: [
        new Trivia({ kind: TriviaKind.Whitespace, lexeme: "  ", span: sourceSpan(0, 2) }),
      ],
      trailingTrivia: [
        new Trivia({ kind: TriviaKind.Newline, lexeme: "\n", span: sourceSpan(5, 6) }),
      ],
      span: sourceSpan(2, 3),
    });
    const green = GreenToken.fromToken(lexerToken);
    expect(green.reconstruct()).toBe("  x\n");
  });

  test("missing creates token with isMissing=true and zero width", () => {
    const green = GreenToken.missing(SyntaxKind.IdentifierToken);
    expect(green.isMissing).toBe(true);
    expect(green.width).toBe(0);
    expect(green.lexeme).toBe("");
    expect(green.leadingTrivia).toHaveLength(0);
    expect(green.trailingTrivia).toHaveLength(0);
    expect(green.reconstruct()).toBe("");
  });

  test("missing token preserves expected kind", () => {
    const green = GreenToken.missing(SyntaxKind.EqualsToken);
    expect(green.kind).toBe(SyntaxKind.EqualsToken);
    expect(green.isMissing).toBe(true);
  });

  test("fromToken with EOF token", () => {
    const lexerToken = new Token({
      kind: TokenKind.Eof,
      lexeme: "",
      span: sourceSpan(10, 10),
      leadingTrivia: [],
      trailingTrivia: [],
    });
    const green = GreenToken.fromToken(lexerToken);
    expect(green.kind).toBe(SyntaxKind.EndOfFileToken);
    expect(green.lexeme).toBe("");
    expect(green.width).toBe(0);
    expect(green.isMissing).toBe(false);
  });

  test("immutability of trivia arrays (defensive copy)", () => {
    const trivia = [new GreenTrivia(TriviaKind.Whitespace, " ")];
    const green = new GreenToken(SyntaxKind.IdentifierToken, "x", trivia, [], false);
    trivia.push(new GreenTrivia(TriviaKind.Newline, "\n"));
    expect(green.leadingTrivia).toHaveLength(1);
  });

  test("reconstruct with no trivia", () => {
    const lexerToken = new Token({
      kind: TokenKind.Identifier,
      lexeme: "foo",
      span: sourceSpan(0, 3),
      leadingTrivia: [],
      trailingTrivia: [],
    });
    const green = GreenToken.fromToken(lexerToken);
    expect(green.reconstruct()).toBe("foo");
  });
});

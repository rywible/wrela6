import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";

describe("Token", () => {
  test("reconstructs leading trivia, lexeme, and trailing trivia", () => {
    const leading = [
      new Trivia({
        kind: TriviaKind.Whitespace,
        lexeme: "  ",
        span: SourceSpan.from(0, 2),
      }),
    ];

    const token = new Token({
      kind: TokenKind.Identifier,
      lexeme: "name",
      span: SourceSpan.from(2, 6),
      leadingTrivia: leading,
      trailingTrivia: [],
    });

    leading.pop();

    expect(token.reconstruct()).toBe("  name");
    expect(token.leadingTrivia).toHaveLength(1);
  });

  test("copies trivia arrays so external mutation does not affect token", () => {
    const leading = [
      new Trivia({
        kind: TriviaKind.Whitespace,
        lexeme: "\t",
        span: SourceSpan.from(0, 1),
      }),
    ];

    const trailing = [
      new Trivia({
        kind: TriviaKind.Whitespace,
        lexeme: " ",
        span: SourceSpan.from(7, 8),
      }),
    ];

    const token = new Token({
      kind: TokenKind.Identifier,
      lexeme: "value",
      span: SourceSpan.from(1, 6),
      leadingTrivia: leading,
      trailingTrivia: trailing,
    });

    leading.push(
      new Trivia({
        kind: TriviaKind.LineComment,
        lexeme: "// extra",
        span: SourceSpan.from(1, 9),
      }),
    );

    trailing.length = 0;

    expect(token.leadingTrivia).toHaveLength(1);
    expect(token.trailingTrivia).toHaveLength(1);
    expect(token.reconstruct()).toBe("\tvalue ");
  });

  test("reconstructs with no trivia", () => {
    const token = new Token({
      kind: TokenKind.IntegerLiteral,
      lexeme: "42",
      span: SourceSpan.from(0, 2),
      leadingTrivia: [],
      trailingTrivia: [],
    });

    expect(token.reconstruct()).toBe("42");
  });
});

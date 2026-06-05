import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";

describe("Trivia", () => {
  test("stores kind, lexeme, and span", () => {
    const span = SourceSpan.from(0, 3);
    const trivia = new Trivia({
      kind: TriviaKind.Whitespace,
      lexeme: "   ",
      span,
    });

    expect(trivia.kind).toBe(TriviaKind.Whitespace);
    expect(trivia.lexeme).toBe("   ");
    expect(trivia.span).toBe(span);
  });

  test("reconstruct returns the lexeme", () => {
    const trivia = new Trivia({
      kind: TriviaKind.LineComment,
      lexeme: "// comment",
      span: SourceSpan.from(0, 10),
    });

    expect(trivia.reconstruct()).toBe("// comment");
  });

  test("stores indentation whitespace", () => {
    const trivia = new Trivia({
      kind: TriviaKind.IndentationWhitespace,
      lexeme: "\t\t",
      span: SourceSpan.from(0, 2),
    });

    expect(trivia.kind).toBe(TriviaKind.IndentationWhitespace);
    expect(trivia.reconstruct()).toBe("\t\t");
  });

  test("stores block comment", () => {
    const trivia = new Trivia({
      kind: TriviaKind.BlockComment,
      lexeme: "/* block */",
      span: SourceSpan.from(5, 16),
    });

    expect(trivia.kind).toBe(TriviaKind.BlockComment);
    expect(trivia.span.start).toBe(5);
    expect(trivia.span.end).toBe(16);
    expect(trivia.span.length).toBe(11);
  });
});

import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../src/lexer/source-span";
import { Token } from "../../src/lexer/token";
import { TokenKind } from "../../src/lexer/token-kind";
import { TokenStream } from "../../src/lexer/token-stream";
import { Trivia } from "../../src/lexer/trivia";
import { TriviaKind } from "../../src/lexer/trivia-kind";

function makeToken(
  kind: TokenKind,
  lexeme: string,
  start: number,
  end: number,
  leadingTrivia: Trivia[] = [],
  trailingTrivia: Trivia[] = [],
): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia,
    trailingTrivia,
  });
}

describe("TokenStream", () => {
  test("requires exactly one EOF at the end", () => {
    const stream = TokenStream.from([
      makeToken(TokenKind.Identifier, "image", 0, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ]);

    expect(stream.eofCount()).toBe(1);
    expect(stream.kinds()).toEqual([TokenKind.Identifier, TokenKind.Eof]);
  });

  test("rejects zero Eof tokens", () => {
    expect(() => TokenStream.from([makeToken(TokenKind.Identifier, "image", 0, 5)])).toThrow(
      "exactly one Eof token",
    );
  });

  test("rejects multiple Eof tokens", () => {
    expect(() =>
      TokenStream.from([makeToken(TokenKind.Eof, "", 0, 0), makeToken(TokenKind.Eof, "", 0, 0)]),
    ).toThrow("exactly one Eof token");
  });

  test("rejects tokens after Eof", () => {
    expect(() =>
      TokenStream.from([
        makeToken(TokenKind.Eof, "", 0, 0),
        makeToken(TokenKind.Identifier, "image", 0, 5),
      ]),
    ).toThrow("Eof to be the last token");
  });

  test("reconstruct reproduces source text with trivia", () => {
    const leadingSpace = new Trivia({
      kind: TriviaKind.Whitespace,
      lexeme: "  ",
      span: SourceSpan.from(0, 2),
    });
    const trailingNewline = new Trivia({
      kind: TriviaKind.Newline,
      lexeme: "\n",
      span: SourceSpan.from(7, 8),
    });

    const stream = TokenStream.from([
      makeToken(TokenKind.Identifier, "image", 2, 7, [leadingSpace], [trailingNewline]),
      makeToken(TokenKind.Eof, "", 8, 8),
    ]);

    expect(stream.reconstruct()).toBe("  image\n");
  });

  test("at returns undefined for out-of-bounds", () => {
    const stream = TokenStream.from([
      makeToken(TokenKind.Identifier, "image", 0, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ]);

    expect(stream.at(-1)).toBeUndefined();
    expect(stream.at(2)).toBeUndefined();
    expect(stream.at(100)).toBeUndefined();
  });

  test("eof returns the EOF token", () => {
    const eofToken = makeToken(TokenKind.Eof, "", 5, 5);
    const stream = TokenStream.from([makeToken(TokenKind.Identifier, "image", 0, 5), eofToken]);

    expect(stream.eof()).toBe(eofToken);
    expect(stream.eof().kind).toBe(TokenKind.Eof);
  });

  test("items returns a read-only copy of the tokens array", () => {
    const tokens = [
      makeToken(TokenKind.Identifier, "image", 0, 5),
      makeToken(TokenKind.Eof, "", 5, 5),
    ];
    const stream = TokenStream.from(tokens);
    const items = stream.items;

    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe(TokenKind.Identifier);
    expect(items[1]!.kind).toBe(TokenKind.Eof);
  });
});

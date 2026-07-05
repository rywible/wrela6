import { describe, expect, test } from "bun:test";

import { SourceSpan } from "../../../src/frontend/lexer/source-span";
import { Token } from "../../../src/frontend/lexer/token";
import { TokenKind } from "../../../src/frontend/lexer/token-kind";
import { Trivia } from "../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../src/frontend/lexer/trivia-kind";
import { GreenToken } from "../../../src/frontend/syntax/green-token";

const span: SourceSpan = SourceSpan.from(0, 0);

function token(
  kind: TokenKind,
  lexeme: string,
  leadingTrivia: readonly Trivia[] = [],
  trailingTrivia: readonly Trivia[] = [],
): Token {
  return new Token({
    kind,
    lexeme,
    span,
    leadingTrivia,
    trailingTrivia,
  });
}

function whitespace(lexeme: string): Trivia {
  return new Trivia({
    kind: TriviaKind.Whitespace,
    lexeme,
    span,
  });
}

describe("W7-05a green token interning", () => {
  test("reuses fixed keyword and punctuation green tokens with empty trivia", () => {
    const keywordA = GreenToken.fromToken(token(TokenKind.Class, "class"));
    const keywordB = GreenToken.fromToken(token(TokenKind.Class, "class"));
    const punctuationA = GreenToken.fromToken(token(TokenKind.Colon, ":"));
    const punctuationB = GreenToken.fromToken(token(TokenKind.Colon, ":"));

    expect(keywordA).toBe(keywordB);
    expect(punctuationA).toBe(punctuationB);
  });

  test("does not intern identifiers or fixed tokens that carry trivia", () => {
    const identifierA = GreenToken.fromToken(token(TokenKind.Identifier, "Packet"));
    const identifierB = GreenToken.fromToken(token(TokenKind.Identifier, "Packet"));
    const keywordWithTriviaA = GreenToken.fromToken(
      token(TokenKind.Class, "class", [whitespace(" ")]),
    );
    const keywordWithTriviaB = GreenToken.fromToken(
      token(TokenKind.Class, "class", [whitespace(" ")]),
    );

    expect(identifierA).not.toBe(identifierB);
    expect(keywordWithTriviaA).not.toBe(keywordWithTriviaB);
    expect(keywordWithTriviaA.reconstruct()).toBe(" class");
  });
});

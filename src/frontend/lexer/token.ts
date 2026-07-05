import type { SourceSpan } from "./source-span";
import { TokenKind } from "./token-kind";
import { Trivia } from "./trivia";

export class Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
  readonly leadingTrivia: readonly Trivia[];
  readonly trailingTrivia: readonly Trivia[];
  readonly cookedValue: string | undefined;

  constructor(init: {
    kind: TokenKind;
    lexeme: string;
    span: SourceSpan;
    leadingTrivia: readonly Trivia[];
    trailingTrivia: readonly Trivia[];
    cookedValue?: string;
  }) {
    this.kind = init.kind;
    this.lexeme = init.lexeme;
    this.span = init.span;
    this.leadingTrivia = [...init.leadingTrivia];
    this.trailingTrivia = [...init.trailingTrivia];
    this.cookedValue = init.cookedValue;
  }

  reconstruct(): string {
    const leadingText = this.leadingTrivia.map((trivia) => trivia.reconstruct()).join("");
    const trailingText = this.trailingTrivia.map((trivia) => trivia.reconstruct()).join("");
    return leadingText + this.lexeme + trailingText;
  }
}

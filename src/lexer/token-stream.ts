import type { Token } from "./token";
import { TokenKind } from "./token-kind";

export class TokenStream {
  private readonly tokens: readonly Token[];

  private constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  static from(tokens: readonly Token[]): TokenStream {
    const eofCount = tokens.filter((token) => token.kind === TokenKind.Eof).length;

    if (eofCount === 0) {
      throw new Error("TokenStream requires exactly one Eof token, found zero.");
    }

    if (eofCount > 1) {
      throw new Error(`TokenStream required exactly one Eof token, found ${eofCount}.`);
    }

    if (tokens[tokens.length - 1]!.kind !== TokenKind.Eof) {
      throw new Error("TokenStream required Eof to be the last token.");
    }

    return new TokenStream(tokens);
  }

  get items(): readonly Token[] {
    return [...this.tokens];
  }

  // oxlint-disable-next-line id-length
  at(index: number): Token | undefined {
    return this.tokens[index];
  }

  eof(): Token {
    return this.tokens[this.tokens.length - 1]!;
  }

  eofCount(): number {
    return this.tokens.filter((token) => token.kind === TokenKind.Eof).length;
  }

  reconstruct(): string {
    return this.tokens.map((token) => token.reconstruct()).join("");
  }

  kinds(): TokenKind[] {
    return this.tokens.map((token) => token.kind);
  }
}

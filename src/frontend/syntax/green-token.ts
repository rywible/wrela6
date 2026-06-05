import type { Token } from "../lexer/token";
import { GreenTrivia } from "./green-trivia";
import { SyntaxKind } from "./syntax-kind";
import { syntaxKindFromTokenKind } from "./syntax-kind-map";

export class GreenToken {
  readonly kind: SyntaxKind;
  readonly lexeme: string;
  readonly width: number;
  readonly leadingTrivia: readonly GreenTrivia[];
  readonly trailingTrivia: readonly GreenTrivia[];
  readonly isMissing: boolean;

  constructor(
    kind: SyntaxKind,
    lexeme: string,
    leadingTrivia: GreenTrivia[],
    trailingTrivia: GreenTrivia[],
    isMissing: boolean,
  ) {
    this.kind = kind;
    this.lexeme = lexeme;
    let totalWidth = lexeme.length;
    for (const trivia of leadingTrivia) totalWidth += trivia.width;
    for (const trivia of trailingTrivia) totalWidth += trivia.width;
    this.width = totalWidth;
    this.leadingTrivia = [...leadingTrivia];
    this.trailingTrivia = [...trailingTrivia];
    this.isMissing = isMissing;
    Object.freeze(this);
  }

  static fromToken(token: Token): GreenToken {
    const kind = syntaxKindFromTokenKind(token.kind);
    const leadingTrivia = token.leadingTrivia.map(
      (trivia) => new GreenTrivia(trivia.kind, trivia.lexeme),
    );
    const trailingTrivia = token.trailingTrivia.map(
      (trivia) => new GreenTrivia(trivia.kind, trivia.lexeme),
    );
    return new GreenToken(kind, token.lexeme, leadingTrivia, trailingTrivia, false);
  }

  static missing(expectedKind: SyntaxKind): GreenToken {
    return new GreenToken(expectedKind, "", [], [], true);
  }

  reconstruct(): string {
    const leadingText = this.leadingTrivia.map((trivia) => trivia.reconstruct()).join("");
    const trailingText = this.trailingTrivia.map((trivia) => trivia.reconstruct()).join("");
    return leadingText + this.lexeme + trailingText;
  }
}

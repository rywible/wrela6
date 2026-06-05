import { TriviaKind } from "../lexer/trivia-kind";

export class GreenTrivia {
  readonly kind: TriviaKind;
  readonly lexeme: string;
  readonly width: number;

  constructor(kind: TriviaKind, lexeme: string) {
    this.kind = kind;
    this.lexeme = lexeme;
    this.width = lexeme.length;
    Object.freeze(this);
  }

  reconstruct(): string {
    return this.lexeme;
  }
}

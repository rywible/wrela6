import type { SourceSpan } from "./source-span";
import { TriviaKind } from "./trivia-kind";

export class Trivia {
  readonly kind: TriviaKind;
  readonly lexeme: string;
  readonly span: SourceSpan;

  constructor(init: { kind: TriviaKind; lexeme: string; span: SourceSpan }) {
    this.kind = init.kind;
    this.lexeme = init.lexeme;
    this.span = init.span;
  }

  reconstruct(): string {
    return this.lexeme;
  }
}

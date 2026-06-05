import { GreenTrivia } from "./green-trivia";
import type { SourceText } from "../lexer/source-text";
import { SourceSpan } from "../lexer/source-span";

export class RedTrivia {
  readonly green: GreenTrivia;
  readonly offset: number;
  readonly source: SourceText;

  constructor(green: GreenTrivia, offset: number, source: SourceText) {
    this.green = green;
    this.offset = offset;
    this.source = source;
  }

  get span(): SourceSpan {
    return SourceSpan.from(this.offset, this.offset + this.green.width);
  }

  get text(): string {
    return this.source.slice(this.span);
  }
}

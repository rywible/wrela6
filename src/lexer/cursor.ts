import type { SourceText } from "./source-text";
import { SourceSpan } from "./source-span";

export class Cursor {
  readonly #source: SourceText;
  #currentOffset: number;

  constructor(source: SourceText) {
    this.#source = source;
    this.#currentOffset = 0;
  }

  get offset(): number {
    return this.#currentOffset;
  }

  isAtEnd(): boolean {
    return this.#currentOffset >= this.#source.length;
  }

  peek(ahead: number = 0): string | undefined {
    return this.#source.charAt(this.#currentOffset + ahead);
  }

  advance(): string | undefined {
    const consumed = this.#source.charAt(this.#currentOffset);

    if (consumed !== undefined) {
      this.#currentOffset++;
    }

    return consumed;
  }

  advanceBy(count: number): void {
    if (count < 0) {
      throw new RangeError(`advanceBy count must be non-negative, got ${count}.`);
    }

    this.#currentOffset = Math.min(this.#currentOffset + count, this.#source.length);
  }

  spanFrom(start: number): SourceSpan {
    return this.#source.span(start, this.#currentOffset);
  }
}

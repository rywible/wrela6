export class SourceSpan {
  readonly start: number;
  readonly end: number;

  private constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  static from(start: number, end: number): SourceSpan {
    if (start < 0) {
      throw new RangeError(`SourceSpan start must be non-negative, got ${start}.`);
    }

    if (end < start) {
      throw new RangeError(
        `SourceSpan end (${end}) must be greater than or equal to start (${start}).`,
      );
    }

    return new SourceSpan(start, end);
  }

  get length(): number {
    return this.end - this.start;
  }
}

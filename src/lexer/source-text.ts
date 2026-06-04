import { SourceSpan } from "./source-span";

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export class SourceText {
  readonly name: string;
  readonly text: string;
  readonly length: number;
  readonly #lineStarts: readonly number[];

  private constructor(name: string, text: string, lineStarts: readonly number[]) {
    this.name = name;
    this.text = text;
    this.length = text.length;
    this.#lineStarts = lineStarts;
  }

  static from(name: string, text: string): SourceText {
    const lineStarts = computeLineStarts(text);
    return new SourceText(name, text, lineStarts);
  }

  charAt(offset: number): string | undefined {
    if (offset < 0 || offset >= this.length) {
      return undefined;
    }

    return this.text[offset];
  }

  slice(span: SourceSpan): string {
    return this.text.slice(span.start, span.end);
  }

  span(start: number, end: number): SourceSpan {
    return SourceSpan.from(start, end);
  }

  positionAt(offset: number): SourcePosition {
    const lineStarts = this.#lineStarts;
    let low = 0;
    let high = lineStarts.length - 1;

    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      const lineStart = lineStarts[mid]!;

      if (lineStart <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const lineIndex = low;
    const column = offset - lineStarts[lineIndex]! + 1;

    return {
      offset,
      line: lineIndex + 1,
      column,
    };
  }
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];

  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    } else if (text[index] === "\r") {
      if (index + 1 < text.length && text[index + 1] === "\n") {
        starts.push(index + 2);
        index++;
      } else {
        starts.push(index + 1);
      }
    }
  }

  return starts;
}

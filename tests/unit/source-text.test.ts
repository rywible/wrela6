import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../src/lexer/source-span";
import { SourceText } from "../../src/lexer/source-text";

describe("SourceSpan", () => {
  test("creates a half-open range", () => {
    const span = SourceSpan.from(2, 5);

    expect(span.start).toBe(2);
    expect(span.end).toBe(5);
    expect(span.length).toBe(3);
  });

  test("allows zero-length spans", () => {
    const span = SourceSpan.from(3, 3);

    expect(span.length).toBe(0);
  });

  test("rejects negative start", () => {
    expect(() => SourceSpan.from(-1, 0)).toThrow();
  });

  test("rejects end before start", () => {
    expect(() => SourceSpan.from(5, 3)).toThrow();
  });
});

describe("SourceText", () => {
  test("reads characters and slices spans", () => {
    const source = SourceText.from("app/main.wr", "one\ntwo");
    const span = SourceSpan.from(4, 7);

    expect(source.name).toBe("app/main.wr");
    expect(source.length).toBe(7);
    expect(source.charAt(4)).toBe("t");
    expect(source.slice(span)).toBe("two");
  });

  test("returns undefined for out-of-bounds charAt", () => {
    const source = SourceText.from("main.wr", "ab");

    expect(source.charAt(-1)).toBeUndefined();
    expect(source.charAt(2)).toBeUndefined();
  });

  test("reports 1-based line and column", () => {
    const source = SourceText.from("app/main.wr", "one\r\ntwo\nthree");

    expect(source.positionAt(0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(source.positionAt(5)).toEqual({ offset: 5, line: 2, column: 1 });
    expect(source.positionAt(source.length)).toEqual({
      offset: source.length,
      line: 3,
      column: 6,
    });
  });

  test("handles trailing newline", () => {
    const source = SourceText.from("main.wr", "a\nb\n");

    expect(source.positionAt(0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(source.positionAt(2)).toEqual({ offset: 2, line: 2, column: 1 });
    expect(source.positionAt(4)).toEqual({ offset: 4, line: 3, column: 1 });
  });

  test("creates spans via source.span", () => {
    const source = SourceText.from("main.wr", "hello");
    const span = source.span(1, 4);

    expect(source.slice(span)).toBe("ell");
  });
});

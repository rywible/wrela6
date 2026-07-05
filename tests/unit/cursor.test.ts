import { describe, expect, test } from "bun:test";
import { Cursor } from "../../src/frontend/lexer/cursor";
import { SourceText } from "../../src/frontend/lexer/source-text";

describe("Cursor", () => {
  test("peeks and advances through source", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "abc"));

    expect(cursor.offset).toBe(0);
    expect(cursor.peek()).toBe("a");
    expect(cursor.peek(2)).toBe("c");
    expect(cursor.advance()).toBe("a");
    expect(cursor.offset).toBe(1);
  });

  test("clamps at end", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "a"));

    cursor.advanceBy(99);

    expect(cursor.offset).toBe(1);
    expect(cursor.isAtEnd()).toBe(true);
  });

  test("spanFrom returns half-open span from start to current offset", () => {
    const source = SourceText.from("main.wr", "hello");
    const cursor = new Cursor(source);

    cursor.advanceBy(3);
    const span = cursor.spanFrom(1);

    expect(span.start).toBe(1);
    expect(span.end).toBe(3);
    expect(span.length).toBe(2);
    expect(source.slice(span)).toBe("el");
  });

  test("isAtEnd returns true on empty source", () => {
    const cursor = new Cursor(SourceText.from("main.wr", ""));

    expect(cursor.isAtEnd()).toBe(true);
    expect(cursor.offset).toBe(0);
  });

  test("peek at end returns undefined", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "a"));

    cursor.advance();

    expect(cursor.isAtEnd()).toBe(true);
    expect(cursor.peek()).toBeUndefined();
  });

  test("advanceBy with negative count throws", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "abc"));

    expect(() => cursor.advanceBy(-1)).toThrow(RangeError);
  });

  test("peek with offset beyond end returns undefined", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "ab"));

    expect(cursor.peek(99)).toBeUndefined();
  });

  test("advance at end returns undefined and does not move", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "a"));

    cursor.advance();
    expect(cursor.advance()).toBeUndefined();
    expect(cursor.offset).toBe(1);
  });

  test("advanceBy with zero is a no-op", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "abc"));

    cursor.advanceBy(0);
    expect(cursor.offset).toBe(0);
  });

  test("cursor never moves backward", () => {
    const source = SourceText.from("main.wr", "abcdef");
    const cursor = new Cursor(source);

    cursor.advanceBy(3);
    expect(cursor.offset).toBe(3);

    cursor.advance();
    expect(cursor.offset).toBe(4);

    cursor.advanceBy(0);
    expect(cursor.offset).toBe(4);
  });
});

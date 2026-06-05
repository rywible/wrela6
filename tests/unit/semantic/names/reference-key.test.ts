import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend";
import { moduleId } from "../../../../src/semantic/ids";
import { ReferenceKeyBuilder } from "../../../../src/semantic/names/reference-key";

describe("ReferenceKeyBuilder", () => {
  test("generates ordinal 0 on first call for a given key", () => {
    const builder = new ReferenceKeyBuilder();
    const key = builder.next({
      moduleId: moduleId(0),
      span: SourceSpan.from(0, 4),
      kind: "typeName" as const,
    });
    expect(key.ordinal).toBe(0);
    expect(key.moduleId).toBe(moduleId(0));
    expect(key.span).toEqual(SourceSpan.from(0, 4));
    expect(key.kind).toBe("typeName");
  });

  test("generates ordinal 1 on second call for same input", () => {
    const builder = new ReferenceKeyBuilder();
    const input = {
      moduleId: moduleId(0),
      span: SourceSpan.from(2, 8),
      kind: "functionName" as const,
    };
    const first = builder.next(input);
    const second = builder.next(input);
    expect(first.ordinal).toBe(0);
    expect(second.ordinal).toBe(1);
  });

  test("increments ordinals independently for different inputs", () => {
    const builder = new ReferenceKeyBuilder();
    const inputA = {
      moduleId: moduleId(0),
      span: SourceSpan.from(0, 4),
      kind: "typeName" as const,
    };
    const inputB = {
      moduleId: moduleId(1),
      span: SourceSpan.from(5, 9),
      kind: "functionName" as const,
    };
    const resultA1 = builder.next(inputA);
    const resultB1 = builder.next(inputB);
    const resultA2 = builder.next(inputA);
    expect(resultA1.ordinal).toBe(0);
    expect(resultB1.ordinal).toBe(0);
    expect(resultA2.ordinal).toBe(1);
  });
});

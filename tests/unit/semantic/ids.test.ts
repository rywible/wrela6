import { describe, expect, test } from "bun:test";
import {
  functionId,
  imageId,
  intrinsicId,
  itemId,
  moduleId,
  parameterId,
  typeId,
  fieldId,
} from "../../../src/semantic/ids";

describe("semantic IDs", () => {
  test("numeric IDs preserve dense values", () => {
    expect(moduleId(0)).toBe(moduleId(0));
    expect(itemId(2)).toBe(itemId(2));
    expect(typeId(5)).toBe(typeId(5));
    expect(functionId(10)).toBe(functionId(10));
    expect(imageId(3)).toBe(imageId(3));
    expect(fieldId(1)).toBe(fieldId(1));
    expect(parameterId(7)).toBe(parameterId(7));
  });

  test("numeric IDs reject invalid values", () => {
    expect(() => moduleId(-1)).toThrow("non-negative integer");
    expect(() => itemId(1.5)).toThrow("non-negative integer");
    expect(() => typeId(NaN)).toThrow("non-negative integer");
    expect(() => functionId(Infinity)).toThrow("non-negative integer");
  });

  test("IntrinsicId rejects empty or padded strings", () => {
    expect(intrinsicId("intrinsics.memory.load")).toBe(intrinsicId("intrinsics.memory.load"));
    expect(() => intrinsicId("")).toThrow("must not be empty");
    expect(() => intrinsicId(" intrinsics.memory.load")).toThrow("whitespace");
    expect(() => intrinsicId("intrinsics.memory.load ")).toThrow("whitespace");
  });
});

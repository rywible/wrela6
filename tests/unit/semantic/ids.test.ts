import { describe, expect, test } from "bun:test";
import {
  coreTypeId,
  fieldId,
  functionId,
  imageId,
  itemId,
  moduleId,
  parameterId,
  platformPrimitiveId,
  typeId,
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

  test("CoreTypeId preserves valid IDs", () => {
    expect(coreTypeId("u32")).toBe(coreTypeId("u32"));
    expect(coreTypeId("bool")).toBe(coreTypeId("bool"));
  });

  test("CoreTypeId rejects empty or padded strings", () => {
    expect(() => coreTypeId("")).toThrow("CoreTypeId must not be empty.");
    expect(() => coreTypeId(" foo")).toThrow(
      "CoreTypeId must not have leading or trailing whitespace.",
    );
    expect(() => coreTypeId("foo ")).toThrow(
      "CoreTypeId must not have leading or trailing whitespace.",
    );
  });

  test("PlatformPrimitiveId preserves valid IDs", () => {
    expect(platformPrimitiveId("volatile_load_u32")).toBe(platformPrimitiveId("volatile_load_u32"));
    expect(platformPrimitiveId("aarch64_dmb_ish")).toBe(platformPrimitiveId("aarch64_dmb_ish"));
  });

  test("PlatformPrimitiveId rejects empty or padded strings", () => {
    expect(() => platformPrimitiveId("")).toThrow("PlatformPrimitiveId must not be empty.");
    expect(() => platformPrimitiveId(" foo")).toThrow(
      "PlatformPrimitiveId must not have leading or trailing whitespace.",
    );
    expect(() => platformPrimitiveId("foo ")).toThrow(
      "PlatformPrimitiveId must not have leading or trailing whitespace.",
    );
  });
});

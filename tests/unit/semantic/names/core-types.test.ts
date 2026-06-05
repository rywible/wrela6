import { describe, expect, test } from "bun:test";
import { CoreTypeCatalog, type CoreTypeSpec } from "../../../../src/semantic/names/core-types";
import { coreTypeId } from "../../../../src/semantic/ids";

describe("CoreTypeCatalog", () => {
  test("default catalog has all 7 types", () => {
    const catalog = CoreTypeCatalog.default();
    expect(catalog.types).toHaveLength(7);
  });

  test("byName returns correct types", () => {
    const catalog = CoreTypeCatalog.default();

    expect(catalog.byName("u32")?.id).toBe(coreTypeId("u32"));
    expect(catalog.byName("bool")?.id).toBe(coreTypeId("bool"));
    expect(catalog.byName("Never")?.id).toBe(coreTypeId("Never"));
    expect(catalog.byName("u8")?.id).toBe(coreTypeId("u8"));
    expect(catalog.byName("u16")?.id).toBe(coreTypeId("u16"));
    expect(catalog.byName("u64")?.id).toBe(coreTypeId("u64"));
    expect(catalog.byName("usize")?.id).toBe(coreTypeId("usize"));
  });

  test("byName returns undefined for unknown names", () => {
    const catalog = CoreTypeCatalog.default();

    expect(catalog.byName("Address")).toBeUndefined();
    expect(catalog.byName("")).toBeUndefined();
    expect(catalog.byName("int")).toBeUndefined();
  });

  test("types returns sorted by name alphabetically", () => {
    const catalog = CoreTypeCatalog.default();

    expect(catalog.types.map((type) => type.name)).toEqual([
      "Never",
      "bool",
      "u16",
      "u32",
      "u64",
      "u8",
      "usize",
    ]);
  });

  test("types returns defensive copy", () => {
    const catalog = CoreTypeCatalog.default();
    const types = catalog.types;
    const originalLength = types.length;

    (types as CoreTypeSpec[]).push({ id: coreTypeId("extra"), name: "extra" });
    expect(catalog.types).toHaveLength(originalLength);
  });

  test("Duplicate name throws", () => {
    const types: CoreTypeSpec[] = [
      { id: coreTypeId("u32"), name: "u32" },
      { id: coreTypeId("other"), name: "u32" },
    ];

    expect(() => CoreTypeCatalog.from(types)).toThrow("Duplicate core type name 'u32'.");
  });

  test("Duplicate id throws", () => {
    const types: CoreTypeSpec[] = [
      { id: coreTypeId("u32"), name: "u32" },
      { id: coreTypeId("u32"), name: "other" },
    ];

    expect(() => CoreTypeCatalog.from(types)).toThrow("Duplicate core type id 'u32'.");
  });

  test("Custom catalog with custom types works", () => {
    const catalog = CoreTypeCatalog.from([
      { id: coreTypeId("MyType"), name: "MyType" },
      { id: coreTypeId("Another"), name: "Another" },
    ]);

    expect(catalog.types).toHaveLength(2);
    expect(catalog.byName("MyType")?.id).toBe(coreTypeId("MyType"));
    expect(catalog.byName("Another")?.id).toBe(coreTypeId("Another"));
    expect(catalog.byName("u32")).toBeUndefined();
  });
});

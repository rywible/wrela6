import { describe, expect, test } from "bun:test";
import { platformPrimitiveId } from "../../../../src/semantic/ids";
import { platformPrimitiveNameCatalog } from "../../../../src/semantic/names/platform-primitives";
import type { PlatformPrimitiveNameSpec } from "../../../../src/semantic/names/platform-primitives";
import { platformPrimitiveNameCatalogFake } from "../../../support/semantic/name-resolution-fakes";

describe("platformPrimitiveNameCatalog", () => {
  test("creates a catalog and looks up by name", () => {
    const catalog = platformPrimitiveNameCatalog([
      {
        primitiveId: platformPrimitiveId("volatile_load_u32"),
        name: "volatile_load_u32",
      },
    ]);

    expect(catalog.byName("volatile_load_u32")?.primitiveId).toBe(
      platformPrimitiveId("volatile_load_u32"),
    );
  });

  test("returns undefined for unknown name", () => {
    const catalog = platformPrimitiveNameCatalog([]);
    expect(catalog.byName("nonexistent")).toBeUndefined();
  });

  test("invalid dotted name throws", () => {
    expect(() =>
      platformPrimitiveNameCatalog([
        { primitiveId: platformPrimitiveId("bad"), name: "memory.volatile_load.u32" },
      ]),
    ).toThrow("Platform primitive names must be simple identifiers: 'memory.volatile_load.u32'.");
  });

  test("invalid name with leading digit throws", () => {
    expect(() =>
      platformPrimitiveNameCatalog([{ primitiveId: platformPrimitiveId("bad"), name: "2bad" }]),
    ).toThrow("Platform primitive names must be simple identifiers: '2bad'.");
  });

  test("invalid name with special characters throws", () => {
    expect(() =>
      platformPrimitiveNameCatalog([{ primitiveId: platformPrimitiveId("bad"), name: "foo-bar" }]),
    ).toThrow("Platform primitive names must be simple identifiers: 'foo-bar'.");
  });

  test("duplicate names throw", () => {
    expect(() =>
      platformPrimitiveNameCatalog([
        { primitiveId: platformPrimitiveId("load_a"), name: "volatile_load_u32" },
        { primitiveId: platformPrimitiveId("load_b"), name: "volatile_load_u32" },
      ]),
    ).toThrow("Duplicate platform primitive name 'volatile_load_u32'.");
  });

  test("duplicate primitive IDs throw", () => {
    expect(() =>
      platformPrimitiveNameCatalog([
        { primitiveId: platformPrimitiveId("dup"), name: "load_a" },
        { primitiveId: platformPrimitiveId("dup"), name: "load_b" },
      ]),
    ).toThrow("Duplicate platform primitive id 'dup'.");
  });

  test("primitives are sorted by name", () => {
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("z"), name: "beta" },
      { primitiveId: platformPrimitiveId("a"), name: "alpha" },
    ]);

    expect(
      catalog.primitives.map((primitive) => `${primitive.name}:${primitive.primitiveId}`),
    ).toEqual(["alpha:a", "beta:z"]);
  });

  test("primitives returns a defensive copy", () => {
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("x"), name: "foo" },
    ]);

    const primitives = catalog.primitives;
    expect(primitives.length).toBe(1);

    // Modify the returned array (should not affect catalog)
    (primitives as PlatformPrimitiveNameSpec[]).pop();
    expect(catalog.primitives.length).toBe(1);
  });

  test("byName lookup works with fake catalog", () => {
    const catalog = platformPrimitiveNameCatalogFake(["load_u32", "store_u32"]);

    expect(catalog.byName("load_u32")?.primitiveId).toBe(platformPrimitiveId("load_u32"));
    expect(catalog.byName("store_u32")?.primitiveId).toBe(platformPrimitiveId("store_u32"));
    expect(catalog.byName("nonexistent")).toBeUndefined();
  });
});

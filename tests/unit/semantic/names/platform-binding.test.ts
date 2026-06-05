import { describe, expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { bindPlatformFunctions } from "../../../../src/semantic/names/platform-binding";
import { platformPrimitiveNameCatalog } from "../../../../src/semantic/names/platform-primitives";
import { platformPrimitiveId, functionId, itemId } from "../../../../src/semantic/ids";
import { sortNameResolutionDiagnostics } from "../../../../src/semantic/names/diagnostics";

describe("bindPlatformFunctions", () => {
  test("binds a known platform function to its primitive", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "platform fn print()\n"]]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("print"), name: "print" },
    ]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.diagnostics).toEqual([]);
    const bindings = result.bindings.entries();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.primitiveId).toBe(platformPrimitiveId("print"));
    expect(bindings[0]!.functionId).toBe(functionId(0));
    expect(bindings[0]!.itemId).toBe(itemId(0));
  });

  test("emits diagnostic for unknown platform primitive", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "platform fn unknownFunc()\n"]]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.bindings.entries()).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_UNKNOWN_PLATFORM_PRIMITIVE");
    expect(result.diagnostics[0]!.message).toContain("unknownFunc");
  });

  test("emits diagnostic for non-freestanding platform function", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "class Foo:\n    platform fn bar()\n"]]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("bar"), name: "bar" },
    ]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.bindings.entries()).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_PLATFORM_FN_NOT_FREESTANDING");
    expect(result.diagnostics[0]!.message).toContain("bar");
  });

  test("multiple freestanding platform functions across modules each get bindings", () => {
    const graph = parseModuleGraphForTest([
      ["mod_a/main.wr", "platform fn print()\n"],
      ["mod_b/main.wr", "platform fn print()\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("print"), name: "print" },
    ]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.diagnostics).toEqual([]);
    const bindings = result.bindings.entries();
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.primitiveId).toBe(platformPrimitiveId("print"));
    expect(bindings[1]!.primitiveId).toBe(platformPrimitiveId("print"));
    expect(bindings[0]!.functionId).toBe(functionId(0));
    expect(bindings[1]!.functionId).toBe(functionId(1));
  });

  test("non-platform items are ignored", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn regular()\nplatform fn print()\n"]]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("print"), name: "print" },
    ]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.diagnostics).toEqual([]);
    const bindings = result.bindings.entries();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.primitiveId).toBe(platformPrimitiveId("print"));
  });

  test("platform binding is name-only and does not inspect signatures", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "platform fn write(data: U8, len: U32): U32\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("write"), name: "write" },
    ]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });

    expect(result.diagnostics).toEqual([]);
    const bindings = result.bindings.entries();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.primitiveId).toBe(platformPrimitiveId("write"));
    expect(bindings[0]!.functionId).toBe(functionId(0));
  });

  test("sortNameResolutionDiagnostics handles platformBinding kind", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "platform fn unknownFunc()\n"]]);
    const { index } = buildItemIndex({ graph });
    const catalog = platformPrimitiveNameCatalog([]);

    const result = bindPlatformFunctions({ index, platformPrimitiveNames: catalog });
    const sorted = sortNameResolutionDiagnostics([...result.diagnostics]);

    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.order.kind).toBe("platformBinding");
  });
});

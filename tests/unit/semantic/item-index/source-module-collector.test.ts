import { describe, expect, test } from "bun:test";
import { collectSourceModulesAndTopLevelItems } from "../../../../src/semantic/item-index/source-module-collector";
import { parsedModuleForTest } from "../../../support/frontend/module-graph-test-support";

describe("source module collector", () => {
  test("sorts modules and creates top-level item records", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("b.wr", "fn b()\n"),
      parsedModuleForTest("a.wr", "private class A:\n    field: U8\n"),
    ]);

    expect(result.modules.map((mod) => mod.pathKey)).toEqual(["a.wr", "b.wr"]);
    expect(result.items.map((item) => item.name)).toEqual(["A", "b"]);
    expect(result.items[0]!.modifiers).toEqual(["private"]);
  });

  test("unnamed declarations are skipped", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("main.wr", "class :\n"),
    ]);

    expect(result.items).toHaveLength(0);
  });

  test("type-like declarations receive type IDs", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest(
        "main.wr",
        "enum Color:\n    Red\ndataclass Box:\n    field: U8\nclass A:\n    field: U8\nedge class B:\n    field: U8\ninterface C:\n    field: U8\nstream D:\n    field: U8\nvalidated buffer P:\n    params:\n        size: U8\n",
      ),
    ]);

    const typeLikes = result.items.filter((item) => item.typeId !== undefined);
    expect(typeLikes.length).toBeGreaterThanOrEqual(6);
  });

  test("function declarations receive function IDs", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("main.wr", "fn run()\nfn parse()\n"),
    ]);

    expect(result.items.map((item) => item.name)).toEqual(["run", "parse"]);
    expect(result.items[0]!.functionId).toBeDefined();
    expect(result.items[1]!.functionId).toBeDefined();
    expect(result.functions).toHaveLength(2);
  });

  test("image declarations receive image IDs", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("main.wr", "uefi image Boot:\n    top: ImageField\n"),
    ]);

    expect(result.items[0]!.imageId).toBeDefined();
    expect(result.images).toHaveLength(1);
  });

  test("sorts module paths by code unit ordering", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("zeta.wr", "fn z()\n"),
      parsedModuleForTest("Alpha.wr", "fn a()\n"),
    ]);

    expect(result.modules.map((mod) => mod.pathKey)).toEqual(["Alpha.wr", "zeta.wr"]);
  });

  test("sorts module source text by code unit ordering when path equal", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("main.wr", "fn b()\n"),
      parsedModuleForTest("main.wr", "fn B()\n"),
    ]);

    expect(result.items.map((item) => item.name)).toEqual(["B", "b"]);
  });
});

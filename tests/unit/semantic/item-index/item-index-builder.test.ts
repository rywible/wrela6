import { describe, expect, test } from "bun:test";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import {
  parseSingleModuleGraphForTest,
  parsedModuleForTest,
} from "../../../support/frontend/module-graph-test-support";

describe("buildItemIndex", () => {
  test("builds source-only index from parsed graph", () => {
    const graph = parseSingleModuleGraphForTest("main.wr", "fn main()\n");
    const result = buildItemIndex({ graph });

    expect(result.diagnostics).toEqual([]);
    expect(result.index.items()).toHaveLength(1);
    expect(result.index.modules()).toHaveLength(1);
  });

  test("returns valid index even when diagnostics present", () => {
    const graph = {
      entry: parsedModuleForTest("dup.wr", "").path,
      modules: [
        parsedModuleForTest("dup.wr", "fn foo()\n"),
        parsedModuleForTest("dup.wr", "fn bar()\n"),
      ],
      diagnostics: [],
    } as const;

    const result = buildItemIndex({ graph: graph as any });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.index.modules()).toHaveLength(2);
    expect(result.index.items()).toHaveLength(2);
    expect(result.index).toBeDefined();
  });

  test("parser diagnostics are not copied into BuildItemIndexResult.diagnostics", () => {
    const graph = parseSingleModuleGraphForTest("broken.wr", "fn (\n");
    const result = buildItemIndex({ graph });

    expect(result.diagnostics).toEqual([]);
  });

  test("IDs are dense for source-only graph", () => {
    const graph = parseSingleModuleGraphForTest(
      "main.wr",
      "class A:\n    field: U8\nfn f(a: U8)\n",
    );
    const result = buildItemIndex({ graph });

    expect(result.index.types()).toHaveLength(1);
    expect(result.index.functions()).toHaveLength(1);
    expect(result.index.fields()).toHaveLength(1);
    expect(result.index.parameters()).toHaveLength(1);
  });
});

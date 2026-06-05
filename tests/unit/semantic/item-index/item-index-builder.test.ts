import { describe, expect, test } from "bun:test";
import { intrinsicId } from "../../../../src/semantic/ids";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import type { IntrinsicCatalog } from "../../../../src/semantic/item-index/intrinsic-catalog";
import {
  parseSingleModuleGraphForTest,
  parsedModuleForTest,
} from "../../../support/frontend/module-graph-test-support";
import { intrinsicFunctionFake } from "../../../support/semantic/intrinsic-fakes";

describe("buildItemIndex", () => {
  test("builds source and intrinsic records in one item space", () => {
    const graph = parseSingleModuleGraphForTest(
      "main.wr",
      "class Packet:\nfn parse(packet: Packet)\n",
    );
    const intrinsics: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
          declarations: [intrinsicFunctionFake("load", intrinsicId("intrinsics.test.load"))],
        },
      ],
    };

    const result = buildItemIndex({ graph, intrinsics });

    expect(result.diagnostics).toEqual([]);
    expect(result.index.modules().map((mod) => mod.origin)).toEqual(["source", "intrinsic"]);
    expect(result.index.items().map((item) => item.origin)).toEqual([
      "source",
      "source",
      "intrinsic",
    ]);
    expect(result.index.functions()).toHaveLength(2);
  });

  test("builds source-only index without intrinsics", () => {
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

  test("source module IDs are assigned before intrinsic module IDs", () => {
    const graph = parseSingleModuleGraphForTest("a.wr", "fn a()\n");
    const intrinsics: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
          declarations: [intrinsicFunctionFake("load")],
        },
      ],
    };

    const result = buildItemIndex({ graph, intrinsics });
    const modules = result.index.modules();

    expect(modules[0]!.origin).toBe("source");
    expect(modules[1]!.origin).toBe("intrinsic");
  });

  test("source item IDs are assigned before intrinsic item IDs", () => {
    const graph = parseSingleModuleGraphForTest("main.wr", "fn a()\nfn b()\n");
    const intrinsics: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
          declarations: [intrinsicFunctionFake("load")],
        },
      ],
    };

    const result = buildItemIndex({ graph, intrinsics });
    const items = result.index.items();

    expect(items[0]!.origin).toBe("source");
    expect(items[1]!.origin).toBe("source");
    expect(items[2]!.origin).toBe("intrinsic");
  });

  test("IDs remain dense across source and intrinsic records", () => {
    const graph = parseSingleModuleGraphForTest(
      "main.wr",
      "class A:\n    field: U8\nfn f(a: U8)\n",
    );
    const intrinsics: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
          declarations: [intrinsicFunctionFake("load")],
        },
      ],
    };

    const result = buildItemIndex({ graph, intrinsics });

    expect(result.index.types()).toHaveLength(1);
    expect(result.index.functions()).toHaveLength(2);
    expect(result.index.fields()).toHaveLength(1);
    expect(result.index.parameters()).toHaveLength(2);
  });
});

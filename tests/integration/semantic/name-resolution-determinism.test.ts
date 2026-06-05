import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import { CoreTypeCatalog } from "../../../src/semantic/names/core-types";
import { platformPrimitiveNameCatalog } from "../../../src/semantic/names/platform-primitives";
import { platformPrimitiveId } from "../../../src/semantic/ids";
import { resolveNames } from "../../../src/semantic/names/name-resolver";
import type { ResolveNamesResult } from "../../../src/semantic/names/name-resolver";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

function summarize(result: ResolveNamesResult): unknown {
  return {
    references: result.references.entries(),
    deferredMembers: result.references.deferredMembers(),
    platformBindings: result.platformBindings.entries(),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      source: diagnostic.source.name,
      span: diagnostic.span,
      message: diagnostic.message,
    })),
  };
}

test("name resolution is deterministic across shuffled module order", () => {
  const modules = [
    ["a/main.wr", "class A:\n    x: u32\n"],
    ["b/lib.wr", "fn helper(v: u32) -> u32: return v\n"],
  ] as const;

  const graph1 = parseModuleGraphForTest(modules);
  const graph2 = parseModuleGraphForTest([...modules].reverse());

  const index1 = buildItemIndex({ graph: graph1 });
  const index2 = buildItemIndex({ graph: graph2 });

  const catalog = platformPrimitiveNameCatalog([]);

  const result1 = resolveNames({
    graph: graph1,
    index: index1.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: catalog,
  });

  const result2 = resolveNames({
    graph: graph2,
    index: index2.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: catalog,
  });

  expect(JSON.stringify(summarize(result1))).toBe(JSON.stringify(summarize(result2)));
});

test("name resolution is deterministic across shuffled platform primitive catalog", () => {
  const graph = parseModuleGraphForTest([
    ["main.wr", "platform fn prim_a() -> u32\nplatform fn prim_b() -> u32\n"],
  ] as const);

  const index = buildItemIndex({ graph });

  const prims1 = platformPrimitiveNameCatalog([
    { primitiveId: platformPrimitiveId("prim_a"), name: "prim_a" },
    { primitiveId: platformPrimitiveId("prim_b"), name: "prim_b" },
  ]);

  const prims2 = platformPrimitiveNameCatalog([
    { primitiveId: platformPrimitiveId("prim_b"), name: "prim_b" },
    { primitiveId: platformPrimitiveId("prim_a"), name: "prim_a" },
  ]);

  const result1 = resolveNames({
    graph,
    index: index.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: prims1,
  });

  const result2 = resolveNames({
    graph,
    index: index.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: prims2,
  });

  expect(JSON.stringify(summarize(result1))).toBe(JSON.stringify(summarize(result2)));
});

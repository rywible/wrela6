import { expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { CoreTypeCatalog } from "../../../../src/semantic/names/core-types";
import { platformPrimitiveNameCatalog } from "../../../../src/semantic/names/platform-primitives";
import { platformPrimitiveId } from "../../../../src/semantic/ids";
import { resolveNames } from "../../../../src/semantic/names/name-resolver";

test("resolveNames resolves imports, types, and expressions", () => {
  const graph = parseModuleGraphForTest([
    ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
    ["std/io.wr", "class Writer:\n"],
  ]);
  const itemIndexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: itemIndexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("test_prim"), name: "test_prim" },
    ]),
  });

  expect(nameResult.diagnostics).toEqual([]);
  expect(nameResult.references.entries().length).toBeGreaterThan(0);
});

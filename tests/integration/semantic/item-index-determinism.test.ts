import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import {
  parseModuleGraphForTest,
  parseSingleModuleGraphForTest,
} from "../../support/frontend/module-graph-test-support";
import { intrinsicCatalogFake } from "../../support/semantic/intrinsic-fakes";

test("source module input order does not change item names or IDs", () => {
  const resultA = buildItemIndex({
    graph: parseModuleGraphForTest([
      ["b.wr", "fn b()\n"],
      ["a.wr", "fn a()\n"],
    ]),
  });
  const resultB = buildItemIndex({
    graph: parseModuleGraphForTest([
      ["a.wr", "fn a()\n"],
      ["b.wr", "fn b()\n"],
    ]),
  });

  expect(resultA.index.modules().map((mod) => mod.pathKey)).toEqual(
    resultB.index.modules().map((mod) => mod.pathKey),
  );
  expect(resultA.index.items().map((item) => [item.id, item.name])).toEqual(
    resultB.index.items().map((item) => [item.id, item.name]),
  );
});

test("intrinsic declaration input order does not change item order", () => {
  const resultA = buildItemIndex({
    graph: parseSingleModuleGraphForTest("main.wr", "fn main()\n"),
    intrinsics: intrinsicCatalogFake(["zeta", "alpha"]),
  });
  const resultB = buildItemIndex({
    graph: parseSingleModuleGraphForTest("main.wr", "fn main()\n"),
    intrinsics: intrinsicCatalogFake(["alpha", "zeta"]),
  });

  expect(resultA.index.items().map((item) => item.name)).toEqual(
    resultB.index.items().map((item) => item.name),
  );
});

test("duplicate diagnostic determinism", () => {
  const graph = parseModuleGraphForTest([
    ["main.wr", "class Box:\nclass Box:\n"],
    ["main.wr", "fn run()\n"],
  ]);

  const result = buildItemIndex({ graph });

  const duplicateModuleDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "ITEM_DUPLICATE_MODULE",
  );
  expect(duplicateModuleDiagnostics.length).toBeGreaterThan(0);
});

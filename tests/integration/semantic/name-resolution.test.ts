import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import { CoreTypeCatalog } from "../../../src/semantic/names/core-types";
import { platformPrimitiveNameCatalog } from "../../../src/semantic/names/platform-primitives";
import { platformPrimitiveId } from "../../../src/semantic/ids";
import { resolveNames } from "../../../src/semantic/names/name-resolver";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("project module importing another project module", () => {
  const graph = parseModuleGraphForTest([
    ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
    ["std/io.wr", "class Writer:\n"],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  expect(nameResult.diagnostics).toEqual([]);
  expect(nameResult.references.entries().length).toBeGreaterThanOrEqual(2);
});

test("platform fn binds to target primitive", () => {
  const graph = parseModuleGraphForTest([
    [
      "main.wr",
      "private platform fn volatile_load_u32(address: u32) -> u32\nfn use_it(): volatile_load_u32(1)\n",
    ],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([
      { primitiveId: platformPrimitiveId("volatile_load_u32"), name: "volatile_load_u32" },
    ]),
  });
  expect(nameResult.platformBindings.entries()).toHaveLength(1);
  expect(nameResult.platformBindings.entries()[0]!.primitiveId).toBe(
    platformPrimitiveId("volatile_load_u32"),
  );
});

test("core builtin types resolve", () => {
  const graph = parseModuleGraphForTest([["main.wr", "fn parse() -> u32\n"]]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  const builtinRefs = nameResult.references
    .entries()
    .filter((entry) => entry.reference.kind === "builtinType");
  expect(builtinRefs.length).toBeGreaterThanOrEqual(1);
});

test("unresolved module produces diagnostic", () => {
  const graph = parseModuleGraphForTest([["main.wr", "use Writer from std.io\n"]]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  expect(nameResult.diagnostics.length).toBeGreaterThan(0);
  expect(nameResult.diagnostics[0]!.code).toBe("NAME_UNRESOLVED_MODULE");
});

test("std modules are ordinary source", () => {
  const graph = parseModuleGraphForTest([
    ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
    ["std/io.wr", "class Writer:\n"],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  expect(nameResult.diagnostics).toEqual([]);
  const moduleRefs = nameResult.references
    .entries()
    .filter((entry) => entry.reference.kind === "module");
  expect(moduleRefs.length).toBeGreaterThanOrEqual(1);
});

test("unknown function call produces diagnostic", () => {
  const graph = parseModuleGraphForTest([["main.wr", "fn run():\n    unknown_fn()\n"]]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  expect(nameResult.diagnostics.length).toBeGreaterThan(0);
  expect(
    nameResult.diagnostics.some((diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME"),
  ).toBe(true);
});

test("name resolution walks ensure expressions", () => {
  const graph = parseModuleGraphForTest([["main.wr", "fn run():\n    ensure missing_fn()\n"]]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  expect(nameResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "NAME_UNRESOLVED_NAME",
  );
});

test("let locals do not produce unresolved diagnostics", () => {
  const graph = parseModuleGraphForTest([
    ["main.wr", "fn run() -> u32:\n    let x = 42\n    return x\n"],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });
  const unresolvedNames = nameResult.diagnostics.filter(
    (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
  );
  expect(unresolvedNames).toEqual([]);
});

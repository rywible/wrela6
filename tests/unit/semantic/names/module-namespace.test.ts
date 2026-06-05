import { describe, expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../../tests/support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import {
  buildModuleNamespace,
  dottedModuleNameToPathKey,
} from "../../../../src/semantic/names/module-namespace";
import { moduleId } from "../../../../src/semantic/ids";

describe("dottedModuleNameToPathKey", () => {
  test("replaces dots with slashes and appends .wr", () => {
    expect(dottedModuleNameToPathKey("std.io")).toBe("std/io.wr");
  });

  test("handles single segment", () => {
    expect(dottedModuleNameToPathKey("main")).toBe("main.wr");
  });

  test("handles deep nesting", () => {
    expect(dottedModuleNameToPathKey("a.b.c.d")).toBe("a/b/c/d.wr");
  });

  test("handles empty string", () => {
    expect(dottedModuleNameToPathKey("")).toBe(".wr");
  });
});

describe("buildModuleNamespace", () => {
  test("resolveDottedModule resolves an existing module", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn main()\n"],
      ["std/io.wr", "class Writer:\n"],
      ["std/io/buffer.wr", "class Reader:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveDottedModule("std.io")).toEqual({
      kind: "resolved",
      moduleId: moduleId(1),
      pathKey: "std/io.wr",
      moduleSegments: ["std", "io"],
    });
  });

  test("resolveDottedModule returns unresolved for missing module", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn main()\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveDottedModule("nonexistent")).toEqual({
      kind: "unresolved",
      moduleName: "nonexistent",
      pathKey: "nonexistent.wr",
    });
  });

  test("resolveQualifiedPrefix finds longest module prefix", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn main()\n"],
      ["std/io.wr", "class Writer:\n"],
      ["std/io/buffer.wr", "class Reader:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveQualifiedPrefix(["std", "io", "Writer", "default"])).toEqual({
      kind: "resolved",
      moduleId: moduleId(1),
      pathKey: "std/io.wr",
      moduleSegments: ["std", "io"],
      itemSegment: "Writer",
      memberSegments: ["default"],
    });
  });

  test("longest prefix wins over shorter", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn main()\n"],
      ["std/io.wr", "class Writer:\n"],
      ["std/io/buffer.wr", "class Reader:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveQualifiedPrefix(["std", "io", "buffer", "Reader"])).toEqual({
      kind: "resolved",
      moduleId: moduleId(2),
      pathKey: "std/io/buffer.wr",
      moduleSegments: ["std", "io", "buffer"],
      itemSegment: "Reader",
      memberSegments: [],
    });
  });

  test("prefixConsumesAllSegments when all segments match module", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn main()\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveQualifiedPrefix(["std", "io"])).toEqual({
      kind: "prefixConsumesAllSegments",
      moduleId: moduleId(1),
      pathKey: "std/io.wr",
      moduleSegments: ["std", "io"],
    });
  });

  test("noModulePrefix when no module matches", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn main()\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveQualifiedPrefix(["missing", "Writer"])).toEqual({
      kind: "noModulePrefix",
      segments: ["missing", "Writer"],
    });
  });

  test("noModulePrefix for empty segments", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn main()\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);

    expect(moduleNamespace.resolveQualifiedPrefix([])).toEqual({
      kind: "noModulePrefix",
      segments: [],
    });
  });
});

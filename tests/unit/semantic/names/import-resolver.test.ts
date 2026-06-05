import { describe, expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { buildModuleNamespace } from "../../../../src/semantic/names/module-namespace";
import { ReferenceKeyBuilder } from "../../../../src/semantic/names/reference-key";
import { resolveImports } from "../../../../src/semantic/names/import-resolver";
import { moduleId } from "../../../../src/semantic/ids";

describe("resolveImports", () => {
  test("resolves basic import module and type reference", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    const kinds = result.references.entries().map((entry) => entry.reference.kind);
    expect(kinds).toContain("module");
    expect(kinds).toContain("type");
    expect(result.diagnostics).toEqual([]);
  });

  test("emits NAME_UNRESOLVED_MODULE when target module not found", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Writer from missing.module\nfn main()\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_UNRESOLVED_MODULE");
    expect(result.references.entries()).toHaveLength(0);
  });

  test("emits NAME_UNRESOLVED_IMPORT when imported name not found in target module", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Missing from std.io\nfn main()\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_UNRESOLVED_IMPORT");
    expect(
      result.references.entries().filter((entry) => entry.reference.kind === "module"),
    ).toHaveLength(1);
  });

  test("emits NAME_PRIVATE_IMPORT when importing private item from another module", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Helper from lib\nfn main()\n"],
      ["lib.wr", "private class Helper:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_PRIVATE_IMPORT");
  });

  test("allows private import when importing from own module", () => {
    const graph = parseModuleGraphForTest([
      ["app.wr", "use Helper from app\nfn main()\nprivate class Helper:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toEqual([]);
    const itemRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind !== "module");
    expect(itemRefs).toHaveLength(1);
  });

  test("emits NAME_AMBIGUOUS_IMPORT when multiple items with same name exist", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Value from lib\nfn main()\n"],
      ["lib.wr", "class Value:\nfn Value()\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_AMBIGUOUS_IMPORT");
  });

  test("skips unresolved module import and does not process its names", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use X from missing\nuse Writer from std.io\nfn main(writer: Writer)\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("NAME_UNRESOLVED_MODULE");
    const itemRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind !== "module");
    expect(itemRefs).toHaveLength(1);
  });

  test("builds imported scopes with candidates", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Writer from std.io\nuse Reader from std.io\nfn main()\n"],
      ["std/io.wr", "class Writer:\nclass Reader:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.importedScopes).toHaveLength(2);
    const mainScope = result.importedScopes.find((scope) => scope.moduleId === moduleId(0));
    expect(mainScope).toBeDefined();
    expect(mainScope!.candidates).toHaveLength(2);
    const writerCandidate = mainScope!.candidates.find((candidate) => candidate.name === "Writer");
    expect(writerCandidate).toBeDefined();
    expect(writerCandidate!.namespace).toBe("type");
  });

  test("returns empty imported scopes for modules without imports", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn main()\n"]]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    expect(result.importedScopes).toHaveLength(1);
    expect(result.importedScopes[0]!.candidates).toEqual([]);
  });

  test("resolves function import", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use run from std.lib\nfn main()\n"],
      ["std/lib.wr", "fn run()\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    const functionRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "function");
    expect(functionRefs).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  test("imports from multiple modules", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use A from mod1\nuse B from mod2\nfn main()\n"],
      ["mod1.wr", "class A:\n"],
      ["mod2.wr", "class B:\n"],
    ]);
    const itemIndexResult = buildItemIndex({ graph });
    const result = resolveImports({
      graph,
      index: itemIndexResult.index,
      moduleNamespace: buildModuleNamespace(itemIndexResult.index),
      referenceKeys: new ReferenceKeyBuilder(),
    });

    const moduleRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "module");
    expect(moduleRefs).toHaveLength(2);
    const typeRefs = result.references.entries().filter((entry) => entry.reference.kind === "type");
    expect(typeRefs).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });
});

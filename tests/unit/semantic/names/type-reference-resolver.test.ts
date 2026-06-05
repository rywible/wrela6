import { describe, expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { buildModuleNamespace } from "../../../../src/semantic/names/module-namespace";
import { buildMemberNamespace } from "../../../../src/semantic/names/member-namespace";
import { ReferenceKeyBuilder } from "../../../../src/semantic/names/reference-key";
import { CoreTypeCatalog } from "../../../../src/semantic/names/core-types";
import { resolveImports } from "../../../../src/semantic/names/import-resolver";
import { resolveTypeReferences } from "../../../../src/semantic/names/type-reference-resolver";
import type { ModuleResolutionContext } from "../../../../src/semantic/names/type-reference-resolver";
import {
  scopeBuilder,
  typeCandidate,
  functionCandidate,
  itemCandidate,
  resolvedReferenceForItem,
} from "../../../../src/semantic/names/scope";
import type { ScopeCandidate } from "../../../../src/semantic/names/scope";
import { SourceText } from "../../../../src/frontend";
import type { ItemIndex } from "../../../../src/semantic/item-index";

function buildModuleContexts(
  index: ItemIndex,
  importedScopes: readonly { moduleId: number; candidates: readonly ScopeCandidate[] }[],
): ModuleResolutionContext[] {
  const moduleByPathKey = new Map<string, string>();
  for (const mod of index.modules()) {
    moduleByPathKey.set(mod.pathKey, mod.pathKey);
  }

  return index.modules().map((modRecord) => {
    const importedScope = importedScopes.find((scope) => scope.moduleId === modRecord.id);

    const moduleItems = index
      .itemsInModule(modRecord.id)
      .filter((item) => item.parentItemId === undefined);

    const moduleCandidates: ScopeCandidate[] = [];
    for (const item of moduleItems) {
      const ref = resolvedReferenceForItem(index, item);
      if (ref.kind === "type") {
        moduleCandidates.push(
          typeCandidate(item.name, item.id, ref.typeId, {
            modulePath: modRecord.pathKey,
            itemKind: item.kind,
            name: item.name,
            denseId: item.id as number,
          }),
        );
      } else if (ref.kind === "function") {
        moduleCandidates.push(
          functionCandidate(item.name, item.id, ref.functionId, {
            modulePath: modRecord.pathKey,
            itemKind: item.kind,
            name: item.name,
            denseId: item.id as number,
          }),
        );
      } else if (ref.kind === "image") {
        moduleCandidates.push({
          namespace: "value",
          name: item.name,
          reference: { kind: "image", itemId: item.id, imageId: item.imageId! },
          display: {
            modulePath: modRecord.pathKey,
            itemKind: item.kind,
            name: item.name,
            denseId: item.id as number,
          },
        });
      } else {
        const nameSpace: "type" | "value" = item.typeId !== undefined ? "type" : "value";
        moduleCandidates.push(
          itemCandidate(nameSpace, item.name, item.id, {
            modulePath: modRecord.pathKey,
            itemKind: item.kind,
            name: item.name,
            denseId: item.id as number,
          }),
        );
      }
    }

    const scope = scopeBuilder()
      .addTier("moduleItems", moduleCandidates)
      .addTier("importedItems", [...(importedScope?.candidates ?? [])])
      .build();

    const source = SourceText.from(modRecord.pathKey, "");

    return {
      moduleId: modRecord.id,
      source,
      scope,
    };
  });
}

describe("resolveTypeReferences", () => {
  test("resolves builtin type simple name", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn read() -> u32\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics).toEqual([]);
    const builtinRef = result.references
      .entries()
      .find((entry) => entry.reference.kind === "builtinType");
    expect(builtinRef).toBeDefined();
    expect(builtinRef!.reference).toEqual({
      kind: "builtinType",
      coreTypeId: "u32" as any,
    });
  });

  test("resolves type parameter in type position", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "fn parse[T: ReadableBuffer](buffer: T, extra: u32)\nclass ReadableBuffer:\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const refs = result.references.entries();
    const builtinRefs = refs.filter((entry) => entry.reference.kind === "builtinType");
    const tpRefs = refs.filter((entry) => entry.reference.kind === "typeParameter");

    expect(builtinRefs.length).toBe(1);
    expect(tpRefs.length).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves module-qualified type name", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn useWriter(w: std.io.Writer)\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const moduleQualifiedRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "type");
    expect(moduleQualifiedRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("emits NAME_UNRESOLVED_MODULE for completely unknown module prefix", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test(x: missing.io.Writer)\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "NAME_UNRESOLVED_MODULE"),
    ).toBe(true);
  });

  test("emits NAME_UNRESOLVED_NAME when module prefix consumes all segments", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test(x: std.io)\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unresolvedNameDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedNameDiag).toBeDefined();
    expect(unresolvedNameDiag!.message).toContain("std.io");
    expect(unresolvedNameDiag!.message).toContain("resolves to a module");
  });

  test("emits NAME_UNRESOLVED_NAME when item segment not found in target module", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test(x: std.io.Missing)\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unresolvedNameDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedNameDiag).toBeDefined();
    expect(unresolvedNameDiag!.message).toContain("Missing");
  });

  test("emits NAME_QUALIFIER_NOT_MODULE when first segment resolves as type item", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "class LocalType:\nfn test(x: LocalType.io.Writer)\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const notModuleDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_QUALIFIER_NOT_MODULE",
    );
    expect(notModuleDiag).toBeDefined();
    expect(notModuleDiag!.message).toContain("LocalType");
  });

  test("emits NAME_UNRESOLVED_NAME for unknown simple type", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test(x: UnknownType)\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unresolvedNameDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedNameDiag).toBeDefined();
    expect(unresolvedNameDiag!.message).toContain("UnknownType");
  });

  test("emits NAME_BUILTIN_TYPE_SHADOWED when source type shadows builtin", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "class u32:\nfn test(x: u32)\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const shadowDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_BUILTIN_TYPE_SHADOWED",
    );
    expect(shadowDiag).toBeDefined();
    expect(shadowDiag!.message).toContain("u32");

    const builtinRef = result.references
      .entries()
      .find((entry) => entry.reference.kind === "builtinType");
    expect(builtinRef).toBeDefined();
  });

  test("resolves field types on class", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "class Box:\n    value: u32\n    data: u8\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "builtinType");
    expect(builtinRefs.length).toBe(2);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves function parameter and return types", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn add(a: u32, b: u32) -> u32\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "builtinType");
    expect(builtinRefs.length).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves type parameter bounds", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn parse[T: u32](val: T)\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "builtinType");
    expect(builtinRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves type arguments recursively", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "class Box[T]:\n    item: T\nfn process(val: Box[u32])\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "builtinType");
    expect(builtinRefs.length).toBeGreaterThan(0);
  });

  test("resolves Never builtin type", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn fail() -> Never\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRef = result.references
      .entries()
      .find(
        (entry) =>
          entry.reference.kind === "builtinType" && (entry.reference as any).coreTypeId === "Never",
      );
    expect(builtinRef).toBeDefined();
    expect(result.diagnostics).toEqual([]);
  });

  test("emits NAME_QUALIFIER_NOT_OWNER for member on non-owner type", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "class Packet:\nfn test(x: Packet.value)\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const notOwnerDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_QUALIFIER_NOT_OWNER",
    );
    expect(notOwnerDiag).toBeDefined();
    expect(notOwnerDiag!.message).toContain("Packet");
  });

  test("handles patterns - qualified pattern resolves enum case member", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "enum PacketKind:\n    ping\n    pong\n\nfn handle(kind: PacketKind):\n    match kind:\n        case PacketKind.ping:\n            handle_ping()\n        case PacketKind.pong:\n            handle_pong()\n        case unknown:\n            skip()\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics).toEqual([]);
  });

  test("resolves member function parameter and return types", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "class Calculator:\n    fn add(a: u32, b: u32) -> u32\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "builtinType");
    expect(builtinRefs.length).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  test("skips bare simple patterns without diagnostic", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "fn test():\n    match 1:\n        case x:\n            2\n        case _:\n            3\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const result = resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics).toEqual([]);
  });
});

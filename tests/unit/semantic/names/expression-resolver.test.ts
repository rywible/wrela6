import { describe, expect, test } from "bun:test";
import { parseModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { buildModuleNamespace } from "../../../../src/semantic/names/module-namespace";
import { buildMemberNamespace } from "../../../../src/semantic/names/member-namespace";
import { ReferenceKeyBuilder } from "../../../../src/semantic/names/reference-key";
import { resolveImports } from "../../../../src/semantic/names/import-resolver";
import { resolveTypeReferences } from "../../../../src/semantic/names/type-reference-resolver";
import { resolveExpressions } from "../../../../src/semantic/names/expression-resolver";
import type { ModuleResolutionContext } from "../../../../src/semantic/names/type-reference-resolver";
import {
  scopeBuilder,
  typeCandidate,
  functionCandidate,
  itemCandidate,
  resolvedReferenceForItem,
} from "../../../../src/semantic/names/scope";
import type { ScopeCandidate } from "../../../../src/semantic/names/scope";
import type { ResolvedReferenceEntry } from "../../../../src/semantic/names";
import { SourceText } from "../../../../src/frontend";
import type { ItemIndex } from "../../../../src/semantic/item-index";
import { CoreTypeCatalog } from "../../../../src/semantic/names/core-types";

function buildModuleContexts(
  index: ItemIndex,
  importedScopes: readonly { moduleId: number; candidates: readonly ScopeCandidate[] }[],
): ModuleResolutionContext[] {
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

describe("resolveExpressions", () => {
  test("resolves function call to functionName reference", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn helper() -> u32\n\nfn test():\n    helper()\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const fnRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "function");

    expect(fnRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves explicit call type arguments as type references", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn identity[T](value: T) -> T\n\nfn test():\n    identity[u32](1)\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const coreTypes = CoreTypeCatalog.default();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes,
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes,
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const builtinTypeRefs = result.references
      .entries()
      .filter(
        (
          entry,
        ): entry is ResolvedReferenceEntry & {
          readonly reference: Extract<ResolvedReferenceEntry["reference"], { kind: "builtinType" }>;
        } => entry.reference.kind === "builtinType",
      )
      .map((entry) => String(entry.reference.coreTypeId));

    expect(builtinTypeRefs).toContain("u32");
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves function type parameters after parameter scope is added", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "fn identity[T](value: T) -> T\n\nfn test[T](value: T):\n    identity[T](value)\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const coreTypes = CoreTypeCatalog.default();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes,
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes,
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const functionTypeParameterRefs = result.references
      .entries()
      .filter(
        (entry) =>
          entry.reference.kind === "typeParameter" && entry.reference.owner.kind === "function",
      );

    expect(functionTypeParameterRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("emits NAME_UNRESOLVED_NAME for unknown function callee", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test():\n    unknownFunc()\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const unresolvedDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedDiag).toBeDefined();
    expect(unresolvedDiag!.message).toContain("unknownFunc");
  });

  test("non-callee unresolved name emits NAME_UNRESOLVED_NAME", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test():\n    someLocal\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const unresolvedDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedDiag).toBeDefined();
    expect(unresolvedDiag!.message).toContain("someLocal");
  });

  test("resolves parameter reference inside function body", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test(x: u32) -> u32:\n    x\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const paramRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "parameter");

    expect(paramRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("resolves member on type owner (owner-explicit)", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "enum PacketKind:\n    ping\n    pong\n\nfn test(kind: PacketKind):\n    PacketKind.ping\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const enumRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "item" || entry.reference.kind === "function");

    expect(enumRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("emits NAME_UNRESOLVED_MEMBER when member not found on owner", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "enum PacketKind:\n    ping\n    pong\n\nfn test(kind: PacketKind):\n    PacketKind.missing\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const unresolvedMemberDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_MEMBER",
    );
    expect(unresolvedMemberDiag).toBeDefined();
    expect(unresolvedMemberDiag!.message).toContain("missing");
  });

  test("emits NAME_QUALIFIER_NOT_OWNER when qualifier is a function", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn helper() -> u32\n\nfn test():\n    helper.value\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
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
    expect(notOwnerDiag!.message).toContain("helper");
  });

  test("emits NAME_UNRESOLVED_NAME for unknown owner in member chain", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test():\n    UnknownOwner.value\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const unresolvedNameDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedNameDiag).toBeDefined();
    expect(unresolvedNameDiag!.message).toContain("UnknownOwner");
  });

  test("creates deferred member reference for parameter member access", () => {
    const graph = parseModuleGraphForTest([["app/main.wr", "fn test(x: u32):\n    x.valid\n"]]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.references.deferredMembers().length).toBeGreaterThan(0);
    const deferred = result.references.deferredMembers();
    expect(deferred.some((entry) => entry.memberName === "valid")).toBe(true);
  });

  test("member access on match pattern local does not report payload as unresolved owner", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "fn test(result: u32):\n    match result:\n        case Ok(packet):\n            packet.kind\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "NAME_UNRESOLVED_NAME" && diagnostic.message.includes("'packet'"),
      ),
    ).toBe(false);
  });

  test("resolves direct match scrutinee expression references", () => {
    const graph = parseModuleGraphForTest([
      [
        "app/main.wr",
        "fn make() -> u32:\n    1\nfn test():\n    match make():\n        case Ok(value):\n            value\n",
      ],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(
      result.references
        .entries()
        .some((entry) => entry.key.kind === "functionName" && entry.reference.kind === "function"),
    ).toBe(true);
  });

  test("resolves module-qualified member chain", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test():\n    std.io.Writer.default\n"],
      ["std/io.wr", "class Writer:\n    default: u32\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const moduleQualified = result.references
      .entries()
      .filter((entry) => entry.key.kind === "moduleQualifiedItem");
    expect(moduleQualified.length).toBeGreaterThan(0);
  });

  test("emits NAME_UNRESOLVED_NAME for known module prefix with missing item", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test():\n    std.io.Missing.default\n"],
      ["std/io.wr", "class Writer:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const unresolvedNameDiag = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "NAME_UNRESOLVED_NAME",
    );
    expect(unresolvedNameDiag).toBeDefined();
    expect(unresolvedNameDiag!.message).toContain("Missing");
  });

  test("emits NAME_AMBIGUOUS_NAME for ambiguous module-qualified member chain item", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn test():\n    std.io.Writer.default\n"],
      ["std/io.wr", "class Writer:\ndataclass Writer:\n    value: u32\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "NAME_AMBIGUOUS_NAME",
    );
    expect(
      result.references
        .entries()
        .some(
          (entry) => entry.key.kind === "moduleQualifiedItem" && entry.reference.kind === "type",
        ),
    ).toBe(false);
  });

  test("emits NAME_AMBIGUOUS_NAME for ambiguous imported value name", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "use Value from lib\nfn test():\n    Value()\n"],
      ["lib.wr", "fn Value()\nuefi image Value:\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(importResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "NAME_AMBIGUOUS_IMPORT",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "NAME_AMBIGUOUS_NAME",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "NAME_UNRESOLVED_NAME",
    );
  });

  test("resolves expression in let statement initializer", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "fn helper() -> u32\n\nfn test():\n    let x = helper()\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const fnRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "function");
    expect(fnRefs.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("handles member access where owner and member both resolve", () => {
    const graph = parseModuleGraphForTest([
      ["app/main.wr", "enum PacketKind:\n    ping\n    pong\n\nfn test():\n    PacketKind.ping\n"],
    ]);
    const { index } = buildItemIndex({ graph });
    const moduleNamespace = buildModuleNamespace(index);
    const memberNamespace = buildMemberNamespace(index);
    const referenceKeys = new ReferenceKeyBuilder();
    const importResult = resolveImports({ graph, index, moduleNamespace, referenceKeys });
    const moduleContexts = buildModuleContexts(index, importResult.importedScopes);

    const packetKind = index.items().find((item) => item.name === "PacketKind");
    expect(packetKind).toBeDefined();
    const memberResult = memberNamespace.resolveMember({
      ownerItemId: packetKind!.id,
      name: "ping",
    });
    expect(memberResult.kind).toBe("resolved");

    resolveTypeReferences({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    const result = resolveExpressions({
      graph,
      index,
      coreTypes: CoreTypeCatalog.default(),
      moduleNamespace,
      memberNamespace,
      moduleContexts,
      referenceKeys,
    });

    expect(result.diagnostics).toEqual([]);
    const enumRefs = result.references
      .entries()
      .filter((entry) => entry.reference.kind === "item" || entry.reference.kind === "function");
    expect(enumRefs.length).toBeGreaterThan(0);
  });
});

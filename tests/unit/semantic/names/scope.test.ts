import { describe, expect, test } from "bun:test";
import { itemId, functionId, typeId, parameterId } from "../../../../src/semantic/ids";
import type { TypeParameterOwner } from "../../../../src/semantic/item-index/item-records";
import {
  scopeBuilder,
  typeCandidate,
  functionCandidate,
  itemCandidate,
  typeParameterCandidate,
  parameterCandidate,
} from "../../../../src/semantic/names/scope";
import type { ScopeCandidate } from "../../../../src/semantic/names/scope";

describe("ScopeBuilder", () => {
  test("lookup resolves a single candidate", () => {
    const scope = scopeBuilder()
      .addTier("moduleImports", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookup("type", "T")).toEqual({
      kind: "resolved",
      reference: { kind: "type", itemId: itemId(1), typeId: typeId(1) },
    });
  });

  test("lookup returns unresolved for missing name", () => {
    const scope = scopeBuilder()
      .addTier("moduleImports", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookup("type", "X")).toEqual({ kind: "unresolved" });
  });

  test("lookup returns unresolved for wrong namespace", () => {
    const scope = scopeBuilder()
      .addTier("moduleImports", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookup("value", "T")).toEqual({ kind: "unresolved" });
  });

  test("lookup returns ambiguous when multiple candidates match in same tier", () => {
    const candidates: ScopeCandidate[] = [
      typeCandidate("T", itemId(1), typeId(1)),
      typeCandidate("T", itemId(2), typeId(2)),
    ];
    const scope = scopeBuilder().addTier("duplicates", candidates).build();

    const result = scope.lookup("type", "T");
    expect(result).toEqual({
      kind: "ambiguous",
      candidates: [
        {
          namespace: "type",
          name: "T",
          reference: { kind: "type", itemId: itemId(1), typeId: typeId(1) },
          display: { modulePath: "", itemKind: "", name: "T", denseId: 1 },
        },
        {
          namespace: "type",
          name: "T",
          reference: { kind: "type", itemId: itemId(2), typeId: typeId(2) },
          display: { modulePath: "", itemKind: "", name: "T", denseId: 2 },
        },
      ],
    });
  });

  test("higher tier shadows lower tier", () => {
    const scope = scopeBuilder()
      .addTier("inner", [typeCandidate("T", itemId(0), typeId(0))])
      .addTier("outer", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    const result = scope.lookup("type", "T");
    expect(result).toEqual({
      kind: "resolved",
      reference: { kind: "type", itemId: itemId(0), typeId: typeId(0) },
    });
  });

  test("lookupType delegates to lookup with type namespace", () => {
    const scope = scopeBuilder()
      .addTier("imports", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookupType("T")).toEqual({
      kind: "resolved",
      reference: { kind: "type", itemId: itemId(1), typeId: typeId(1) },
    });

    expect(scope.lookupType("X")).toEqual({ kind: "unresolved" });
  });

  test("lookupValue delegates to lookup with value namespace", () => {
    const scope = scopeBuilder()
      .addTier("imports", [functionCandidate("f", itemId(1), functionId(1))])
      .build();

    expect(scope.lookupValue("f")).toEqual({
      kind: "resolved",
      reference: { kind: "function", itemId: itemId(1), functionId: functionId(1) },
    });

    expect(scope.lookupValue("X")).toEqual({ kind: "unresolved" });
  });

  test("type parameter shadows module type import (higher tier wins)", () => {
    const tpOwner: TypeParameterOwner = {
      kind: "function",
      itemId: itemId(0),
      functionId: functionId(0),
    };

    const scope = scopeBuilder()
      .addTier("functionTypeParameters", [typeParameterCandidate("T", tpOwner, 0)])
      .addTier("moduleImports", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookupType("T")).toEqual({
      kind: "resolved",
      reference: {
        kind: "typeParameter",
        owner: tpOwner,
        index: 0,
      },
    });
  });

  test("addTier returns this for chaining", () => {
    const builder = scopeBuilder();
    const result = builder.addTier("test", []);
    expect(result).toBe(builder);
  });

  test("typeCandidate produces correct candidate", () => {
    const candidate = typeCandidate("Foo", itemId(5), typeId(10));
    expect(candidate).toEqual({
      namespace: "type",
      name: "Foo",
      reference: { kind: "type", itemId: itemId(5), typeId: typeId(10) },
      display: { modulePath: "", itemKind: "", name: "Foo", denseId: 5 },
    });
  });

  test("functionCandidate produces correct candidate", () => {
    const candidate = functionCandidate("bar", itemId(3), functionId(7));
    expect(candidate).toEqual({
      namespace: "value",
      name: "bar",
      reference: { kind: "function", itemId: itemId(3), functionId: functionId(7) },
      display: { modulePath: "", itemKind: "", name: "bar", denseId: 3 },
    });
  });

  test("itemCandidate produces correct candidate", () => {
    const candidate = itemCandidate("value", "baz", itemId(9));
    expect(candidate).toEqual({
      namespace: "value",
      name: "baz",
      reference: { kind: "item", itemId: itemId(9) },
      display: { modulePath: "", itemKind: "", name: "baz", denseId: 9 },
    });
  });

  test("typeParameterCandidate produces correct candidate", () => {
    const owner: TypeParameterOwner = {
      kind: "item",
      itemId: itemId(2),
    };
    const candidate = typeParameterCandidate("TP", owner, 1);
    expect(candidate).toEqual({
      namespace: "type",
      name: "TP",
      reference: { kind: "typeParameter", owner, index: 1 },
      display: { modulePath: "", itemKind: "", name: "TP", denseId: 1 },
    });
  });

  test("parameterCandidate produces correct candidate", () => {
    const candidate = parameterCandidate("p", parameterId(4));
    expect(candidate).toEqual({
      namespace: "value",
      name: "p",
      reference: { kind: "parameter", parameterId: parameterId(4) },
      display: { modulePath: "", itemKind: "", name: "p", denseId: 4 },
    });
  });

  test("candidate helpers accept custom display", () => {
    const customDisplay = {
      modulePath: "std",
      itemKind: "function",
      name: "custom",
      denseId: 42,
    };
    const candidate = functionCandidate("f", itemId(1), functionId(1), customDisplay);
    expect(candidate.display).toBe(customDisplay);
  });

  test("no match in any tier returns unresolved", () => {
    const scope = scopeBuilder()
      .addTier("a", [typeCandidate("A", itemId(1), typeId(1))])
      .addTier("b", [functionCandidate("B", itemId(2), functionId(2))])
      .build();

    expect(scope.lookup("type", "B")).toEqual({ kind: "unresolved" });
    expect(scope.lookup("value", "A")).toEqual({ kind: "unresolved" });
  });

  test("matching name in lower tier is shadowed by non-matching higher tier", () => {
    const scope = scopeBuilder()
      .addTier("higher", [functionCandidate("f", itemId(0), functionId(0))])
      .addTier("lower", [typeCandidate("T", itemId(1), typeId(1))])
      .build();

    expect(scope.lookup("value", "f")).toEqual({
      kind: "resolved",
      reference: { kind: "function", itemId: itemId(0), functionId: functionId(0) },
    });
    expect(scope.lookup("type", "T")).toEqual({
      kind: "resolved",
      reference: { kind: "type", itemId: itemId(1), typeId: typeId(1) },
    });
  });
});

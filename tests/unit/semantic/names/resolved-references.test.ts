import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend";
import {
  moduleId,
  itemId,
  functionId,
  coreTypeId,
  platformPrimitiveId,
} from "../../../../src/semantic/ids";
import {
  ResolvedReferencesBuilder,
  ResolvedPlatformBindingsBuilder,
} from "../../../../src/semantic/names/resolution-result";
import type {
  SyntaxReferenceKey,
  ResolvedReference,
  DeferredMemberReference,
  PlatformPrimitiveBinding,
} from "../../../../src/semantic/names/reference";

function makeKey(overrides: Partial<SyntaxReferenceKey> = {}): SyntaxReferenceKey {
  return {
    moduleId: moduleId(0),
    span: SourceSpan.from(0, 4),
    kind: "typeName",
    ordinal: 0,
    ...overrides,
  };
}

describe("ResolvedReferencesBuilder", () => {
  test("add and get a reference", () => {
    const builder = new ResolvedReferencesBuilder();
    const key = makeKey();
    const ref: ResolvedReference = { kind: "builtinType", coreTypeId: coreTypeId("u32") };
    builder.add(key, ref);
    const result = builder.build();
    expect(result.get(key)).toEqual(ref);
  });

  test("get returns undefined for missing key", () => {
    const builder = new ResolvedReferencesBuilder();
    const result = builder.build();
    expect(result.get(makeKey())).toBeUndefined();
  });

  test("get uses structural equality (same values, different objects)", () => {
    const builder = new ResolvedReferencesBuilder();
    const key = makeKey();
    const ref: ResolvedReference = { kind: "builtinType", coreTypeId: coreTypeId("u32") };
    builder.add(key, ref);
    const result = builder.build();
    const lookupKey = makeKey();
    expect(lookupKey).not.toBe(key);
    expect(result.get(lookupKey)).toEqual(ref);
  });

  test("entries are sorted by key order", () => {
    const builder = new ResolvedReferencesBuilder();
    const keyB = makeKey({ span: SourceSpan.from(5, 9), kind: "functionName" });
    const keyA = makeKey({ span: SourceSpan.from(0, 4), kind: "typeName" });
    builder.add(keyB, { kind: "builtinType", coreTypeId: coreTypeId("u32") });
    builder.add(keyA, { kind: "builtinType", coreTypeId: coreTypeId("i32") });
    const result = builder.build();
    const entries = result.entries();
    expect(entries.map((entry) => entry.key)).toEqual([keyA, keyB]);
  });

  test("deferred members are returned in key order", () => {
    const builder = new ResolvedReferencesBuilder();
    const dmB: DeferredMemberReference = {
      key: makeKey({ span: SourceSpan.from(5, 9), kind: "memberName", ordinal: 0 }),
      receiverExpressionKey: undefined,
      memberName: "y",
      memberSpan: SourceSpan.from(8, 9),
      allowedNamespaces: ["field"],
    };
    const dmA: DeferredMemberReference = {
      key: makeKey({ span: SourceSpan.from(0, 4), kind: "memberName", ordinal: 0 }),
      receiverExpressionKey: undefined,
      memberName: "x",
      memberSpan: SourceSpan.from(3, 4),
      allowedNamespaces: ["field"],
    };
    builder.addDeferredMember(dmB);
    builder.addDeferredMember(dmA);
    const result = builder.build();
    expect(result.deferredMembers().map((deferredMember) => deferredMember.memberName)).toEqual([
      "x",
      "y",
    ]);
  });

  test("merge combines entries and deferred members", () => {
    const keyA = makeKey({ kind: "typeName" });
    const keyB = makeKey({ kind: "functionName" });
    const refA: ResolvedReference = { kind: "builtinType", coreTypeId: coreTypeId("u32") };
    const refB: ResolvedReference = { kind: "builtinType", coreTypeId: coreTypeId("i32") };

    const builder1 = new ResolvedReferencesBuilder();
    builder1.add(keyA, refA);
    const result1 = builder1.build();

    const builder2 = new ResolvedReferencesBuilder();
    builder2.add(keyB, refB);
    const merged = new ResolvedReferencesBuilder();
    merged.merge(result1);
    merged.merge(builder2.build());
    const finalResult = merged.build();

    expect(finalResult.get(keyA)).toEqual(refA);
    expect(finalResult.get(keyB)).toEqual(refB);
  });

  test("entries() returns readonly sorted entries", () => {
    const builder = new ResolvedReferencesBuilder();
    const key = makeKey();
    const ref: ResolvedReference = { kind: "builtinType", coreTypeId: coreTypeId("u32") };
    builder.add(key, ref);
    const result = builder.build();
    const entries = result.entries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.key).toBe(key);
    expect(entries[0]!.reference).toBe(ref);
  });
});

describe("ResolvedPlatformBindingsBuilder", () => {
  test("entries sort by functionId, itemId, platformPrimitiveId", () => {
    const builder = new ResolvedPlatformBindingsBuilder();
    const bindingA: PlatformPrimitiveBinding = {
      functionId: functionId(2),
      itemId: itemId(1),
      primitiveId: platformPrimitiveId("atomic_load"),
    };
    const bindingB: PlatformPrimitiveBinding = {
      functionId: functionId(1),
      itemId: itemId(0),
      primitiveId: platformPrimitiveId("volatile_store"),
    };
    builder.add(bindingA);
    builder.add(bindingB);
    const result = builder.build();
    const entries = result.entries();
    expect(entries.map((entry) => entry.functionId)).toEqual([functionId(1), functionId(2)]);
  });

  test("get returns binding by functionId", () => {
    const builder = new ResolvedPlatformBindingsBuilder();
    const binding: PlatformPrimitiveBinding = {
      functionId: functionId(5),
      itemId: itemId(3),
      primitiveId: platformPrimitiveId("memory_barrier"),
    };
    builder.add(binding);
    const result = builder.build();
    expect(result.get(functionId(5))).toEqual(binding);
  });

  test("get returns undefined for unknown functionId", () => {
    const builder = new ResolvedPlatformBindingsBuilder();
    const result = builder.build();
    expect(result.get(functionId(99))).toBeUndefined();
  });

  test("merge combines bindings", () => {
    const builder1 = new ResolvedPlatformBindingsBuilder();
    builder1.add({
      functionId: functionId(1),
      itemId: itemId(1),
      primitiveId: platformPrimitiveId("load"),
    });
    const result1 = builder1.build();

    const builder2 = new ResolvedPlatformBindingsBuilder();
    builder2.add({
      functionId: functionId(2),
      itemId: itemId(2),
      primitiveId: platformPrimitiveId("store"),
    });

    const merged = new ResolvedPlatformBindingsBuilder();
    merged.merge(result1);
    merged.merge(builder2.build());
    const result2 = merged.build();

    expect(result2.get(functionId(1))?.primitiveId).toBe(platformPrimitiveId("load"));
    expect(result2.get(functionId(2))?.primitiveId).toBe(platformPrimitiveId("store"));
  });

  test("resolved platform bindings sort primitive ids by code unit", () => {
    const builder = new ResolvedPlatformBindingsBuilder();
    builder.add({
      itemId: itemId(0),
      functionId: functionId(2),
      primitiveId: platformPrimitiveId("z"),
    });
    builder.add({
      itemId: itemId(0),
      functionId: functionId(2),
      primitiveId: platformPrimitiveId("A"),
    });

    expect(
      builder
        .build()
        .entries()
        .map((binding) => binding.primitiveId),
    ).toEqual([platformPrimitiveId("A"), platformPrimitiveId("z")]);
  });
});

describe("ResolvedReferencesBuilder kind ordering", () => {
  test("entries sort kind by code unit comparison", () => {
    const builder = new ResolvedReferencesBuilder();
    builder.add(makeKey({ kind: "functionName", ordinal: 1 }), {
      kind: "builtinType",
      coreTypeId: coreTypeId("u32"),
    });
    builder.add(makeKey({ kind: "typeName", ordinal: 0 }), {
      kind: "builtinType",
      coreTypeId: coreTypeId("i32"),
    });
    const entries = builder.build().entries();
    expect(entries.map((entry) => entry.key.kind)).toEqual(["functionName", "typeName"]);
  });
});

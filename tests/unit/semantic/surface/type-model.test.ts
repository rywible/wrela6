import { expect, test } from "bun:test";
import { coreTypeId, itemId, targetTypeId, typeId } from "../../../../src/semantic/ids";
import {
  appliedType,
  checkedTypeFingerprint,
  checkedTypesEqual,
  coreCheckedType,
  errorCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
  targetCheckedType,
} from "../../../../src/semantic/surface/type-model";
import { concreteKind, derivedKind } from "../../../../src/semantic/surface/resource-kind";

test("checked type fingerprints are deterministic", () => {
  const optionU8 = appliedType({
    constructor: { kind: "source", typeId: typeId(10) },
    arguments: [coreCheckedType(coreTypeId("u8"))],
    resourceKind: concreteKind("Copy"),
  });

  expect(checkedTypeFingerprint(optionU8)).toBe("applied:source:10:concrete:Copy<core:u8>");
});

test("checked type fingerprints preserve nested applied type strings", () => {
  const nested = appliedType({
    constructor: { kind: "source", typeId: typeId(20) },
    arguments: [
      appliedType({
        constructor: { kind: "source", typeId: typeId(10) },
        arguments: [coreCheckedType(coreTypeId("u8")), coreCheckedType(coreTypeId("bool"))],
        resourceKind: concreteKind("Copy"),
      }),
      sourceCheckedType({ itemId: itemId(4), typeId: typeId(2) }),
    ],
    resourceKind: derivedKind("join", [concreteKind("Copy"), concreteKind("Linear")]),
  });

  expect(checkedTypeFingerprint(nested)).toBe(
    "applied:source:20:derived:join:concrete:Copy,concrete:Linear<applied:source:10:concrete:Copy<core:u8,core:bool>,source:4:2>",
  );
});

test("source type stores item and type ids", () => {
  expect(sourceCheckedType({ itemId: itemId(4), typeId: typeId(2) })).toEqual({
    kind: "source",
    itemId: itemId(4),
    typeId: typeId(2),
  });
});

test("target type uses target type id", () => {
  expect(targetCheckedType(targetTypeId("FirmwareHandle"))).toEqual({
    kind: "target",
    targetTypeId: targetTypeId("FirmwareHandle"),
  });
});

test("core checked type stores coreTypeId", () => {
  expect(coreCheckedType(coreTypeId("u32"))).toEqual({
    kind: "core",
    coreTypeId: coreTypeId("u32"),
  });
});

test("generic parameter checked type stores parameter", () => {
  const param = { owner: { kind: "item", itemId: itemId(1) }, index: 0 } as const;
  expect(genericParameterCheckedType(param)).toEqual({
    kind: "genericParameter",
    parameter: param,
  });
});

test("error checked type is stable", () => {
  const err1 = errorCheckedType();
  const err2 = errorCheckedType();
  expect(err1).toEqual(err2);
});

test("applied type stores constructor and arguments", () => {
  const applied = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("u32") },
    arguments: [],
    resourceKind: concreteKind("Copy"),
  });
  if (applied.kind !== "applied") throw new Error("expected applied type");
  expect(applied.constructor).toEqual({ kind: "core", coreTypeId: coreTypeId("u32") });
  expect(applied.arguments).toEqual([]);
  expect(applied.resourceKind).toEqual(concreteKind("Copy"));
});

test("checkedTypesEqual compares by fingerprint", () => {
  const u32a = coreCheckedType(coreTypeId("u32"));
  const u32b = coreCheckedType(coreTypeId("u32"));
  const bool_ = coreCheckedType(coreTypeId("bool"));
  expect(checkedTypesEqual(u32a, u32b)).toBe(true);
  expect(checkedTypesEqual(u32a, bool_)).toBe(false);
});

test("applied fingerprints include full non-concrete resource kind fingerprint", () => {
  const copyApplied = appliedType({
    constructor: { kind: "source", typeId: typeId(10) },
    arguments: [coreCheckedType(coreTypeId("u8"))],
    resourceKind: derivedKind("join", [concreteKind("Copy")]),
  });
  const linearApplied = appliedType({
    constructor: { kind: "source", typeId: typeId(10) },
    arguments: [coreCheckedType(coreTypeId("u8"))],
    resourceKind: derivedKind("join", [concreteKind("Linear")]),
  });

  expect(checkedTypesEqual(copyApplied, linearApplied)).toBe(false);
});

test("fingerprint of error type is stable", () => {
  expect(checkedTypeFingerprint(errorCheckedType())).toBe("error");
});

test("fingerprint of target type", () => {
  expect(checkedTypeFingerprint(targetCheckedType(targetTypeId("FirmwareHandle")))).toBe(
    "target:FirmwareHandle",
  );
});

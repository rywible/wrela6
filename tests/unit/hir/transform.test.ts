import { expect, test } from "bun:test";
import {
  transformCheckedType,
  transformCheckedResourceKind,
} from "../../../src/hir/checked-type-transform";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import { concreteKind, parametricKind } from "../../../src/semantic/surface/resource-kind";
import {
  appliedType,
  coreCheckedType,
  genericParameterCheckedType,
} from "../../../src/semantic/surface/type-model";

const copyKind = concreteKind("Copy");
const u16Type = coreCheckedType(coreTypeId("u16"));

test("transformCheckedType and transformCheckedResourceKind preserve unchanged nested nodes", () => {
  const parameter = {
    owner: { kind: "function" as const, itemId: 0 as any, functionId: functionId(1) },
    index: 0,
  };
  const genericType = genericParameterCheckedType(parameter);
  const type = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("Box") },
    arguments: [genericType],
    resourceKind: parametricKind(parameter),
  });
  if (type.kind !== "applied") throw new Error("expected applied type");

  const sameType = transformCheckedType(type, {});
  const sameKind = transformCheckedResourceKind(type.resourceKind, {});
  const changedType = transformCheckedType(type, {
    checkedType: (source) => (source === genericType ? u16Type : source),
    resourceKind: (source) => (source.kind === "parametric" ? copyKind : source),
  });

  expect(sameType).toBe(type);
  expect(sameKind).toBe(type.resourceKind);
  expect(changedType).not.toBe(type);
  expect(changedType.kind === "applied" ? changedType.arguments[0] : undefined).toBe(u16Type);
  expect(changedType.kind === "applied" ? changedType.resourceKind : undefined).toBe(copyKind);
});

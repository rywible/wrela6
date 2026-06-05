import { expect, test } from "bun:test";
import { coreTypeId, itemId, typeId, targetTypeId } from "../../../../src/semantic/ids";
import {
  coreCheckedType,
  sourceCheckedType,
  targetCheckedType,
  errorCheckedType,
  appliedType,
  genericParameterCheckedType,
} from "../../../../src/semantic/surface/type-model";
import {
  resourceKindForType,
  emptyKindContext,
} from "../../../../src/semantic/surface/resource-kind-checker";
import {
  concreteKind,
  parametricKind,
  errorKind,
} from "../../../../src/semantic/surface/resource-kind";
import { CoreTypeCatalog } from "../../../../src/semantic/names";

const defaultContext = emptyKindContext(CoreTypeCatalog.default());

test("core u32 is copy", () => {
  expect(
    resourceKindForType({ type: coreCheckedType(coreTypeId("u32")), context: defaultContext }),
  ).toEqual(concreteKind("Copy"));
});

test("core Never is Never", () => {
  expect(
    resourceKindForType({ type: coreCheckedType(coreTypeId("Never")), context: defaultContext }),
  ).toEqual(concreteKind("Never"));
});

test("generic parameter produces parametric kind", () => {
  expect(
    resourceKindForType({
      type: genericParameterCheckedType({
        owner: { kind: "item", itemId: itemId(1) },
        index: 0,
      }),
      context: defaultContext,
    }),
  ).toEqual(parametricKind({ owner: { kind: "item", itemId: itemId(1) }, index: 0 }));
});

test("error type produces error kind without throwing", () => {
  expect(resourceKindForType({ type: errorCheckedType(), context: defaultContext })).toEqual(
    errorKind(),
  );
});

test("applied type uses its stored resource kind", () => {
  const type = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("u32") },
    arguments: [],
    resourceKind: concreteKind("Linear"),
  });

  expect(resourceKindForType({ type, context: defaultContext })).toEqual(concreteKind("Linear"));
});

test("source type returns copy by default", () => {
  expect(
    resourceKindForType({
      type: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
      context: defaultContext,
    }),
  ).toEqual(concreteKind("Copy"));
});

test("target type returns copy by default", () => {
  expect(
    resourceKindForType({
      type: targetCheckedType(targetTypeId("FirmwareHandle")),
      context: defaultContext,
    }),
  ).toEqual(concreteKind("Copy"));
});

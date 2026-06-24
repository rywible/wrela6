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
import { ItemIndex } from "../../../../src/semantic/item-index";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";

const defaultContext = emptyKindContext(
  CoreTypeCatalog.default(),
  new ItemIndex({
    modules: [],
    items: [],
    types: [],
    functions: [],
    images: [],
    fields: [],
    typeParameters: [],
    parameters: [],
  }),
);

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

test("applied type with core constructor and no args derives Copy", () => {
  const type = appliedType({
    constructor: { kind: "core", coreTypeId: coreTypeId("u32") },
    arguments: [],
    resourceKind: concreteKind("Copy"),
  });

  expect(resourceKindForType({ type, context: defaultContext })).toEqual(concreteKind("Copy"));
});

test("applied type derives resource kind from arguments using the provided context", () => {
  const type = appliedType({
    constructor: { kind: "source", typeId: typeId(10) },
    arguments: [sourceCheckedType({ itemId: itemId(5), typeId: typeId(5) })],
    resourceKind: concreteKind("Copy"),
  });
  const context = {
    ...defaultContext,
    sourceTypeKinds: new Map([[typeId(5), concreteKind("Stream")]]),
  };

  expect(resourceKindForType({ type, context })).toEqual(concreteKind("Linear"));
});

test("source type returns copy by default", () => {
  expect(
    resourceKindForType({
      type: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
      context: defaultContext,
    }),
  ).toEqual(concreteKind("Copy"));
});

test("unique edge class source type is a unique edge root", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "unique edge class NetworkDevice:\n"],
  ]);
  const type = fixture.index.types()[0]!;

  expect(
    resourceKindForType({
      type: sourceCheckedType({ itemId: type.itemId, typeId: type.id }),
      context: emptyKindContext(fixture.coreTypes, fixture.index),
    }),
  ).toEqual(concreteKind("UniqueEdgeRoot"));
});

test("private class source type is private state", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "private class RxBatchBuilder:\n"]]);
  const type = fixture.index.types()[0]!;

  expect(
    resourceKindForType({
      type: sourceCheckedType({ itemId: type.itemId, typeId: type.id }),
      context: emptyKindContext(fixture.coreTypes, fixture.index),
    }),
  ).toEqual(concreteKind("PrivateState"));
});

test("target type returns copy by default", () => {
  expect(
    resourceKindForType({
      type: targetCheckedType(targetTypeId("FirmwareHandle")),
      context: defaultContext,
    }),
  ).toEqual(concreteKind("Copy"));
});

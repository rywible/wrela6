import { describe, expect, test } from "bun:test";
import { HirResourcePlaceInterner } from "../../../src/hir/place";
import { hirOriginId } from "../../../src/hir/ids";
import { coreTypeId, fieldId, functionId, parameterId } from "../../../src/semantic/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";

const owner = { kind: "function" as const, functionId: functionId(1) };
const type = coreCheckedType(coreTypeId("u32"));
const copyKind = concreteKind("Copy");
const streamKind = concreteKind("Stream");

describe("HirResourcePlaceInterner", () => {
  test("reuses canonical receiver field places", () => {
    const interner = new HirResourcePlaceInterner(owner);
    const input = {
      root: { kind: "receiver" as const, parameterId: parameterId(0) },
      projection: [{ kind: "field" as const, fieldId: fieldId(2) }],
      type,
      resourceKind: streamKind,
      sourceOrigin: hirOriginId(1),
    };

    const first = interner.placeForProjection(input);
    const second = interner.placeForProjection(input);

    expect(first.placeId).toEqual(second.placeId);
    expect(first.canonicalKey).toBe(second.canonicalKey);
    expect(first.canonicalKey).toBe(
      "function:1/root:receiver:0/projection:field:2/type:core:u32/kind:concrete:Stream",
    );
  });

  test("separates disjoint receiver fields", () => {
    const interner = new HirResourcePlaceInterner(owner);
    const receivePlace = interner.placeForProjection({
      root: { kind: "receiver", parameterId: parameterId(0) },
      projection: [{ kind: "field", fieldId: fieldId(1) }],
      type,
      resourceKind: streamKind,
      sourceOrigin: hirOriginId(1),
    });
    const transmitPlace = interner.placeForProjection({
      root: { kind: "receiver", parameterId: parameterId(0) },
      projection: [{ kind: "field", fieldId: fieldId(2) }],
      type,
      resourceKind: streamKind,
      sourceOrigin: hirOriginId(2),
    });

    expect(receivePlace.placeId).not.toEqual(transmitPlace.placeId);
  });

  test("does not allocate copy-only temporaries unless proof relevant", () => {
    const interner = new HirResourcePlaceInterner(owner);

    expect(
      interner.temporaryForExpression({
        type,
        resourceKind: copyKind,
        sourceOrigin: hirOriginId(1),
        proofRelevant: false,
      }),
    ).toBeUndefined();

    const temporary = interner.temporaryForExpression({
      type,
      resourceKind: copyKind,
      sourceOrigin: hirOriginId(2),
      proofRelevant: true,
    });

    expect(temporary?.root).toEqual({ kind: "temporary", ordinal: 0 });
    expect(temporary?.canonicalKey).toContain("root:temporary:0");
  });

  test("allocates proof-relevant temporaries for proof-relevant resource kinds", () => {
    const interner = new HirResourcePlaceInterner(owner);
    const temporary = interner.temporaryForExpression({
      type,
      resourceKind: streamKind,
      sourceOrigin: hirOriginId(1),
      proofRelevant: false,
    });

    expect(temporary?.root).toEqual({ kind: "temporary", ordinal: 0 });
  });
});

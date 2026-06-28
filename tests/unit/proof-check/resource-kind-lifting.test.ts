import { describe, expect, test } from "bun:test";
import {
  buildProofCheckStructuredPlace,
  compareProofCheckPlaces,
  liftProofCheckResourceKind,
  liftProofCheckResourceKindResult,
  parseProofCheckStructuredPlacePath,
  proofCheckConcreteResourceKinds,
  type ProofCheckConcreteResourceKind,
  type ProofCheckLiftType,
} from "../../../src/proof-check/domains/ownership";
import { proofCheckPlaceForTest } from "../../support/proof-check/state-fixtures";

export function checkedTypeForTest(
  typeName: string,
  resourceKind: ProofCheckConcreteResourceKind,
): ProofCheckLiftType {
  return {
    kind: "named",
    typeName,
    resourceKind,
  };
}

export function optionTypeForTest(input: {
  readonly element: ProofCheckLiftType;
}): ProofCheckLiftType {
  return {
    kind: "option",
    element: input.element,
  };
}

function resultTypeForTest(input: {
  readonly okType: ProofCheckLiftType;
  readonly errorType: ProofCheckLiftType;
}): ProofCheckLiftType {
  return {
    kind: "result",
    okType: input.okType,
    errorType: input.errorType,
  };
}

function tupleTypeForTest(elements: readonly ProofCheckLiftType[]): ProofCheckLiftType {
  return {
    kind: "tuple",
    elements,
  };
}

function listTypeForTest(element: ProofCheckLiftType): ProofCheckLiftType {
  return {
    kind: "list",
    element,
  };
}

function mapTypeForTest(input: {
  readonly key: ProofCheckLiftType;
  readonly value: ProofCheckLiftType;
}): ProofCheckLiftType {
  return {
    kind: "map",
    key: input.key,
    value: input.value,
  };
}

function aggregateTypeForTest(input: {
  readonly typeName: string;
  readonly fields: readonly { readonly name: string; readonly type: ProofCheckLiftType }[];
  readonly checkedOwner?: boolean;
}): ProofCheckLiftType {
  return {
    kind: "aggregate",
    typeName: input.typeName,
    fields: input.fields,
    checkedOwner: input.checkedOwner ?? false,
  };
}

describe("ProofCheckConcreteResourceKind", () => {
  test("ProofCheckConcreteResourceKind is exactly the closed concrete kind lattice", () => {
    expect(proofCheckConcreteResourceKinds()).toEqual([
      "Copy",
      "Affine",
      "Linear",
      "UniqueEdgeRoot",
      "EdgePath",
      "Stream",
      "ValidatedBuffer",
      "PrivateState",
      "SealedPlatformToken",
      "Never",
    ]);
  });
});

describe("liftProofCheckResourceKind", () => {
  test("option of writable buffer lifts to affine or linear resource", () => {
    const lifted = liftProofCheckResourceKind(
      optionTypeForTest({ element: checkedTypeForTest("WritableBuffer", "Linear") }),
    );

    expect(lifted).toBe("Linear");
  });

  test("option of copy scalar stays copy", () => {
    const lifted = liftProofCheckResourceKind(
      optionTypeForTest({ element: checkedTypeForTest("u32", "Copy") }),
    );

    expect(lifted).toBe("Copy");
  });

  test("result lifts the strongest contained resource kind", () => {
    const lifted = liftProofCheckResourceKind(
      resultTypeForTest({
        okType: checkedTypeForTest("TransferOk", "Copy"),
        errorType: checkedTypeForTest("PacketReject", "Affine"),
      }),
    );

    expect(lifted).toBe("Affine");
  });

  test("tuple lifts the strongest contained resource kind", () => {
    const lifted = liftProofCheckResourceKind(
      tupleTypeForTest([
        checkedTypeForTest("u32", "Copy"),
        checkedTypeForTest("ReadableBuffer", "Affine"),
      ]),
    );

    expect(lifted).toBe("Affine");
  });

  test("list lifts its element resource kind", () => {
    const lifted = liftProofCheckResourceKind(
      listTypeForTest(checkedTypeForTest("ReadableBuffer", "Linear")),
    );

    expect(lifted).toBe("Linear");
  });

  test("map lifts its value resource kind and ignores copy keys", () => {
    const lifted = liftProofCheckResourceKind(
      mapTypeForTest({
        key: checkedTypeForTest("PacketKind", "Copy"),
        value: checkedTypeForTest("ReadableBuffer", "Affine"),
      }),
    );

    expect(lifted).toBe("Affine");
  });

  test("checked owner aggregate lifts contained proof-relevant fields", () => {
    const lifted = liftProofCheckResourceKind(
      aggregateTypeForTest({
        typeName: "MoveRingSlot",
        checkedOwner: true,
        fields: [
          { name: "item", type: checkedTypeForTest("ReadableBuffer", "Linear") },
          { name: "brand", type: checkedTypeForTest("EdgeBrand", "Copy") },
        ],
      }),
    );

    expect(lifted).toBe("Linear");
  });

  test("ordinary dataclass rejects hidden linear fields without checked owner semantics", () => {
    const result = liftProofCheckResourceKindResult(
      aggregateTypeForTest({
        typeName: "PacketView",
        fields: [{ name: "buffer", type: checkedTypeForTest("WritableBuffer", "Linear") }],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reason).toBe("hiddenResourceField");
  });

  test("ordinary value aggregate stays copy when all fields are copy", () => {
    const lifted = liftProofCheckResourceKind(
      aggregateTypeForTest({
        typeName: "PacketLimits",
        fields: [{ name: "max_frame_bytes", type: checkedTypeForTest("usize", "Copy") }],
      }),
    );

    expect(lifted).toBe("Copy");
  });

  test("Never contained values are ignored in joins", () => {
    const lifted = liftProofCheckResourceKind(
      tupleTypeForTest([checkedTypeForTest("Never", "Never"), checkedTypeForTest("u32", "Copy")]),
    );

    expect(lifted).toBe("Copy");
  });
});

describe("compareProofCheckPlaces", () => {
  test("disjoint fields are not the same place relation", () => {
    const left = proofCheckPlaceForTest("buffer.header");
    const right = proofCheckPlaceForTest("buffer.payload");

    expect(compareProofCheckPlaces(left, right).kind).toBe("disjointField");
  });

  test("identical structured places are the same relation", () => {
    const left = proofCheckPlaceForTest("buffer.header");
    const right = proofCheckPlaceForTest("buffer.header");

    expect(compareProofCheckPlaces(left, right).kind).toBe("same");
  });

  test("parent place is an ancestor of its field projection", () => {
    const left = proofCheckPlaceForTest("buffer");
    const right = proofCheckPlaceForTest("buffer.header");

    expect(compareProofCheckPlaces(left, right).kind).toBe("ancestor");
    expect(compareProofCheckPlaces(right, left).kind).toBe("descendant");
  });

  test("different roots are unrelated", () => {
    const left = proofCheckPlaceForTest("buffer.header");
    const right = proofCheckPlaceForTest("packet.header");

    expect(compareProofCheckPlaces(left, right).kind).toBe("unrelatedRoot");
  });

  test("list element and map value projections are overlapping siblings", () => {
    const left = buildProofCheckStructuredPlace({
      rootKey: "table",
      projections: [{ kind: "listElement" }],
    });
    const right = buildProofCheckStructuredPlace({
      rootKey: "table",
      projections: [{ kind: "mapValue" }],
    });

    expect(compareProofCheckPlaces(left, right).kind).toBe("overlappingSibling");
  });

  test("result ok and err arms are disjoint fields", () => {
    const left = buildProofCheckStructuredPlace({
      rootKey: "attempt",
      projections: [{ kind: "resultOk" }],
    });
    const right = buildProofCheckStructuredPlace({
      rootKey: "attempt",
      projections: [{ kind: "resultErr" }],
    });

    expect(compareProofCheckPlaces(left, right).kind).toBe("disjointField");
  });
});

describe("structured place projections", () => {
  test("wrapper variants, tuple fields, list elements, and map values parse as structured projections", () => {
    expect(parseProofCheckStructuredPlacePath(proofCheckPlaceForTest("packet.some"))).toEqual({
      rootKey: "packet",
      projections: [{ kind: "optionSome" }],
    });
    expect(parseProofCheckStructuredPlacePath(proofCheckPlaceForTest("attempt.ok"))).toEqual({
      rootKey: "attempt",
      projections: [{ kind: "resultOk" }],
    });
    expect(parseProofCheckStructuredPlacePath(proofCheckPlaceForTest("pair.1"))).toEqual({
      rootKey: "pair",
      projections: [{ kind: "tupleIndex", index: 1 }],
    });
    expect(parseProofCheckStructuredPlacePath(proofCheckPlaceForTest("items.elem"))).toEqual({
      rootKey: "items",
      projections: [{ kind: "listElement" }],
    });
    expect(parseProofCheckStructuredPlacePath(proofCheckPlaceForTest("table.value"))).toEqual({
      rootKey: "table",
      projections: [{ kind: "mapValue" }],
    });
  });

  test("buildProofCheckStructuredPlace round-trips projection segments", () => {
    const place = buildProofCheckStructuredPlace({
      rootKey: "packet",
      projections: [
        { kind: "field", fieldName: "payload" },
        { kind: "optionSome" },
        { kind: "listElement" },
      ],
    });

    expect(place.placeKey).toBe("packet.payload.some.elem");
    expect(parseProofCheckStructuredPlacePath(place)).toEqual({
      rootKey: "packet",
      projections: [
        { kind: "field", fieldName: "payload" },
        { kind: "optionSome" },
        { kind: "listElement" },
      ],
    });
  });
});

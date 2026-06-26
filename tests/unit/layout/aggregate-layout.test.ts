import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { computeSourceAggregateLayout } from "../../../src/layout/aggregate-layout";
import { monoInstanceId } from "../../../src/mono/ids";
import { coreTypeId, typeId, itemId } from "../../../src/semantic/ids";
import {
  coreCheckedType,
  sourceCheckedType,
  checkedTypeFingerprint,
} from "../../../src/semantic/surface/type-model";
import {
  aggregateLayoutFixture,
  aggregateOffsetOracle,
  fieldOffsetProjection,
  layoutDataModelFake,
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  primitiveFieldListArbitrary,
} from "../../support/layout/layout-fixtures";

describe("computeSourceAggregateLayout", () => {
  test("aggregate layout preserves source field order and padding", () => {
    const input = aggregateLayoutFixture({
      fields: [
        { name: "tag", type: coreCheckedType(coreTypeId("u8")) },
        { name: "size", type: coreCheckedType(coreTypeId("u32")) },
      ],
    });
    const result = computeSourceAggregateLayout(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.fieldFacts.map((field) => [field.fieldName, field.offsetBytes])).toEqual([
      ["tag", 0n],
      ["size", 4n],
    ]);
    expect(result.value.typeFact.aggregateStorage?.paddingRanges).toEqual([
      { offsetBytes: 1n, sizeBytes: 3n, kind: "interField" },
    ]);
  });

  test("aggregate layout records trailing padding after final field", () => {
    const input = aggregateLayoutFixture({
      fields: [
        { name: "a", type: coreCheckedType(coreTypeId("u8")) },
        { name: "b", type: coreCheckedType(coreTypeId("u8")) },
      ],
    });
    const result = computeSourceAggregateLayout(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.typeFact.sizeBytes).toBe(2n);
    expect(result.value.typeFact.strideBytes).toBe(2n);
    expect(result.value.typeFact.aggregateStorage?.paddingRanges).toEqual([]);
    expect(result.value.typeFact.aggregateStorage?.trailingPaddingBytes).toBe(0n);
  });

  test("empty edge class produces zero-sized capability representation", () => {
    const input = aggregateLayoutFixture({
      fields: [],
    });
    const result = computeSourceAggregateLayout({
      ...input,
      sourceKind: "edgeClass",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.typeFact.representation).toEqual({
      kind: "zeroSized",
      reason: "capabilityToken",
    });
    expect(result.value.typeFact.sizeBytes).toBe(0n);
    expect(result.value.typeFact.strideBytes).toBe(0n);
    expect(result.value.fieldFacts).toHaveLength(0);
  });

  test("empty class produces zero-sized empty aggregate representation", () => {
    const input = aggregateLayoutFixture({ fields: [] });
    const result = computeSourceAggregateLayout(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.typeFact.representation).toEqual({
      kind: "zeroSized",
      reason: "emptyAggregate",
    });
  });

  test("stored Never field is rejected", () => {
    const input = aggregateLayoutFixture({
      fields: [{ name: "dead", type: coreCheckedType(coreTypeId("Never")) }],
    });
    const result = computeSourceAggregateLayout(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_FORBIDDEN_NEVER_STORAGE",
    );
  });

  test("unsupported interface source kind is rejected", () => {
    const input = aggregateLayoutFixture({ fields: [] });
    const result = computeSourceAggregateLayout({
      ...input,
      sourceKind: "interface",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_UNSUPPORTED_INTERFACE_VALUE",
    );
  });

  test("validated-buffer source kind is rejected from aggregate layout", () => {
    const input = aggregateLayoutFixture({ fields: [] });
    const result = computeSourceAggregateLayout({
      ...input,
      sourceKind: "validatedBuffer",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
    );
  });

  test("recursive by-value source types are rejected", () => {
    const typeA = monoInstanceId("type:A");
    const typeB = monoInstanceId("type:B");
    const typeARef = sourceCheckedType({ typeId: typeId(1), itemId: itemId(1) });
    const typeBRef = sourceCheckedType({ typeId: typeId(2), itemId: itemId(2) });
    const target = layoutTargetSurfaceFake();
    const input = aggregateLayoutFixture({
      fields: [{ name: "b", type: typeBRef }],
      target,
    });

    const result = computeSourceAggregateLayout({
      ...input,
      owner: { kind: "source", instanceId: typeA },
      nestedSourceTypes: [
        {
          instanceId: typeB,
          sourceKind: "class",
          fields: [{ name: "a", type: typeARef }],
        },
      ],
      sourceTypeKeys: new Map([
        [checkedTypeFingerprint(typeBRef), { kind: "source", instanceId: typeB }],
        [checkedTypeFingerprint(typeARef), { kind: "source", instanceId: typeA }],
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_RECURSIVE_TYPE_LAYOUT",
    );
  });

  test("non-recursive nested by-value source types are accepted", () => {
    const typeA = monoInstanceId("type:A");
    const typeB = monoInstanceId("type:B");
    const typeBRef = sourceCheckedType({ typeId: typeId(2), itemId: itemId(2) });
    const target = layoutTargetSurfaceFake();
    const input = aggregateLayoutFixture({
      fields: [{ name: "b", type: typeBRef }],
      target,
    });

    const result = computeSourceAggregateLayout({
      ...input,
      owner: { kind: "source", instanceId: typeA },
      nestedSourceTypes: [
        {
          instanceId: typeB,
          sourceKind: "class",
          fields: [{ name: "x", type: coreCheckedType(coreTypeId("u32")) }],
        },
      ],
      sourceTypeKeys: new Map([
        [checkedTypeFingerprint(typeBRef), { kind: "source", instanceId: typeB }],
      ]),
    });

    expect(result.kind).toBe("ok");
  });

  test("aggregate size overflow is rejected", () => {
    const target = layoutTargetSurfaceFake({
      dataModel: layoutDataModelFake({ maximumObjectSizeBytes: 4n }),
    });
    const input = aggregateLayoutFixture({
      fields: [
        { name: "a", type: coreCheckedType(coreTypeId("u32")) },
        { name: "b", type: coreCheckedType(coreTypeId("u32")) },
      ],
      target,
      targetFacts: normalizeTargetFactsForTest(target),
    });
    const result = computeSourceAggregateLayout(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
    );
  });

  test("aggregate offsets match independent oracle for generated primitive fields", () => {
    fastCheck.assert(
      fastCheck.property(primitiveFieldListArbitrary(), (fields) => {
        const result = computeSourceAggregateLayout(aggregateLayoutFixture({ fields }));
        fastCheck.pre(result.kind === "ok");
        if (result.kind !== "ok") return true;
        expect(result.value.fieldFacts.map(fieldOffsetProjection)).toEqual([
          ...aggregateOffsetOracle(fields),
        ]);
      }),
      { numRuns: 100 },
    );
  });
});

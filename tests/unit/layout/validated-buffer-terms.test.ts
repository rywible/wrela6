import { describe, expect, test } from "bun:test";
import {
  compareLayoutTermOrder,
  normalizeAffineLayoutTerm,
  translateLayoutTerm,
} from "../../../src/layout/validated-buffer-terms";
import type { MonoLayoutExpression } from "../../../src/mono/mono-hir";
import { coreTypeId, fieldId } from "../../../src/semantic/ids";
import {
  constantLayoutTerm,
  coreMonoType,
  monoIntegerLiteral,
  monoSourceLength,
  monoSubtract,
  sourceLengthLayoutTermForTest,
  termTranslationFixture,
} from "../../support/layout/layout-fixtures";

describe("translateLayoutTerm", () => {
  test("source length minus constant emits range constraint", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: monoSubtract(monoSourceLength(), monoIntegerLiteral(14n)),
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term.kind).toBe("subtract");
    expect(result.value.requirements).toContainEqual({
      kind: "rangeConstraint",
      left: constantLayoutTerm(14n, "byteLength"),
      relation: "<=",
      right: sourceLengthLayoutTermForTest(),
      width: { kind: "core", coreTypeId: coreTypeId("usize") },
    });
  });

  test("parameter minus parameter emits range constraint when non-negativity is not static", () => {
    const leftParam: MonoLayoutExpression = {
      kind: "fieldValue",
      fieldId: fieldId(1),
      fieldKind: "parameter",
      type: coreMonoType("u32"),
      sourceOrigin: "layout-fixture:0:0",
    };
    const rightParam: MonoLayoutExpression = {
      kind: "fieldValue",
      fieldId: fieldId(2),
      fieldKind: "parameter",
      type: coreMonoType("u32"),
      sourceOrigin: "layout-fixture:0:0",
    };

    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: monoSubtract(leftParam, rightParam),
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.value.requirements.some(
        (requirement) => requirement.kind === "rangeConstraint" && requirement.relation === "<=",
      ),
    ).toBe(true);
  });

  test("integer literal translates with exact constant range", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: monoIntegerLiteral(3n),
        unit: "byteOffset",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term).toEqual({
      kind: "constant",
      value: 3n,
      unit: "byteOffset",
      range: { minimum: 3n, maximum: 3n, provenance: "constant" },
    });
    expect(result.value.requirements).toHaveLength(0);
  });

  test("source length uses target size type and bounded range", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: monoSourceLength(),
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term.kind).toBe("sourceLength");
    if (result.value.term.kind !== "sourceLength") return;
    expect(result.value.term.type).toEqual({ kind: "core", coreTypeId: coreTypeId("usize") });
    expect(result.value.term.range.minimum).toBe(0n);
    expect(result.value.term.range.maximum).toBe(1_073_741_824n);
    expect(result.value.term.range.provenance).toBe("sourceLength");
  });

  test("multiplication accepts non-negative constant factor", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: {
          kind: "multiply",
          left: monoIntegerLiteral(4n),
          right: monoSourceLength(),
          width: { kind: "targetSize" },
          sourceOrigin: "layout-fixture:0:0",
        },
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term.kind).toBe("multiply");
  });

  test("variable multiplication is rejected", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: {
          kind: "multiply",
          left: monoSourceLength(),
          right: monoSourceLength(),
          width: { kind: "targetSize" },
          sourceOrigin: "layout-fixture:0:0",
        },
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "LAYOUT_INVALID_LAYOUT_TERM",
    );
  });

  test("addition that can overflow emits noUnsignedOverflow requirement", () => {
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression: {
          kind: "add",
          left: monoSourceLength(),
          right: monoSourceLength(),
          width: { kind: "targetSize" },
          sourceOrigin: "layout-fixture:0:0",
        },
        unit: "byteLength",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.value.requirements.some((requirement) => requirement.kind === "noUnsignedOverflow"),
    ).toBe(true);
  });

  test("parameter field value translates with checked range", () => {
    const expression: MonoLayoutExpression = {
      kind: "fieldValue",
      fieldId: fieldId(1),
      fieldKind: "parameter",
      type: coreMonoType("u16"),
      sourceOrigin: "layout-fixture:0:0",
    };
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression,
        unit: "elementCount",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term.kind).toBe("fieldValue");
    if (result.value.term.kind !== "fieldValue") return;
    expect(result.value.term.source).toBe("parameter");
    expect(result.value.term.unit).toBe("elementCount");
    expect(result.value.term.range).toEqual({
      minimum: 0n,
      maximum: 65_535n,
      provenance: "checkedType",
    });
  });

  test("derived field with invalid precomputed range fails in derived fact construction", () => {
    const expression: MonoLayoutExpression = {
      kind: "fieldValue",
      fieldId: fieldId(2),
      fieldKind: "derived",
      type: coreMonoType("u32"),
      sourceOrigin: "layout-fixture:0:0",
    };
    const result = translateLayoutTerm(
      termTranslationFixture({
        expression,
        unit: "scalarValue",
        derivedFieldRangeByFieldId: new Map([
          [fieldId(2), { minimum: 0n, maximum: -1n, provenance: "derivedCases" }],
        ]),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.term.kind).toBe("derivedValue");
    if (result.value.term.kind !== "derivedValue") return;
    expect(result.value.term.range.maximum).toBeLessThan(result.value.term.range.minimum);
  });
});

describe("normalizeAffineLayoutTerm", () => {
  test("normalizes constant plus scaled source length", () => {
    const term = {
      kind: "add" as const,
      left: constantLayoutTerm(3n, "byteOffset"),
      right: {
        kind: "multiply" as const,
        left: constantLayoutTerm(2n, "byteOffset"),
        right: sourceLengthLayoutTermForTest(),
        unit: "byteOffset" as const,
        range: { minimum: 0n, maximum: 2_147_483_648n, provenance: "arithmetic" as const },
      },
      unit: "byteOffset" as const,
      range: { minimum: 3n, maximum: 2_147_483_651n, provenance: "arithmetic" as const },
    };

    const result = normalizeAffineLayoutTerm(term);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.constant).toBe(3n);
    expect(result.value.coefficients.get("sourceLength")).toBe(2n);
  });

  test("rejects non-affine multiplication", () => {
    const term = {
      kind: "multiply" as const,
      left: sourceLengthLayoutTermForTest(),
      right: sourceLengthLayoutTermForTest(),
      unit: "byteLength" as const,
      range: { minimum: 0n, maximum: 1n, provenance: "arithmetic" as const },
    };

    const result = normalizeAffineLayoutTerm(term);

    expect(result.kind).toBe("error");
  });
});

describe("compareLayoutTermOrder", () => {
  test("constant offset is before source-length-dependent offset", () => {
    const left = constantLayoutTerm(3n, "byteOffset");
    const right = {
      kind: "add" as const,
      left: constantLayoutTerm(3n, "byteOffset"),
      right: sourceLengthLayoutTermForTest(),
      unit: "byteOffset" as const,
      range: { minimum: 3n, maximum: 1_073_741_827n, provenance: "arithmetic" as const },
    };

    const comparison = compareLayoutTermOrder(left, right);

    expect(comparison.kind).toBe("ordered");
    if (comparison.kind !== "ordered") return;
    expect(comparison.order).toBe("before");
  });

  test("identical constants compare equal", () => {
    const comparison = compareLayoutTermOrder(
      constantLayoutTerm(14n, "byteOffset"),
      constantLayoutTerm(14n, "byteOffset"),
    );

    expect(comparison.kind).toBe("ordered");
    if (comparison.kind !== "ordered") return;
    expect(comparison.order).toBe("equal");
  });

  test("incomparable affine forms are ambiguous", () => {
    const parameterTerm = {
      kind: "fieldValue" as const,
      fieldId: fieldId(1),
      source: "parameter" as const,
      type: { kind: "core" as const, coreTypeId: coreTypeId("u16") },
      unit: "byteLength" as const,
      range: { minimum: 0n, maximum: 65_535n, provenance: "checkedType" as const },
    };

    const comparison = compareLayoutTermOrder(parameterTerm, sourceLengthLayoutTermForTest());

    expect(comparison.kind).toBe("ambiguous");
  });
});

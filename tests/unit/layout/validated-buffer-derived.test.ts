import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { computeDerivedFieldFacts } from "../../../src/layout/validated-buffer-derived";
import { layoutDiagnosticCode, type LayoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { coreTypeId, fieldId } from "../../../src/semantic/ids";
import {
  derivedFieldFixture,
  derivedFieldLayoutSourceExpression,
  DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID,
  LAYOUT_FIXTURE_SOURCE_ORIGIN,
  monoIntegerLiteral,
  type DerivedFieldFixtureCase,
} from "../../support/layout/layout-fixtures";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";
import type { LayoutIntegerRange } from "../../../src/layout/layout-program";
import type { MonoLayoutExpression } from "../../../src/mono/mono-hir";

function layoutFieldSourceExpression(): MonoLayoutExpression {
  return derivedFieldLayoutSourceExpression();
}

function narrowLayoutFieldSource(
  sourceMaximum: bigint,
): Pick<
  import("../../../src/layout/validated-buffer-derived").ComputeDerivedFieldFactsInput,
  "source" | "layoutFieldWireByFieldId"
> {
  let bitWidth = 1;
  while ((1n << BigInt(bitWidth)) - 1n < sourceMaximum) {
    bitWidth += 1;
  }
  return {
    source: layoutFieldSourceExpression(),
    layoutFieldWireByFieldId: new Map([
      [
        DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID,
        {
          wireEncoding: {
            kind: "integer",
            endian: "little",
            signedness: "unsigned",
            bitWidth,
          },
          layoutWireEndian: "little",
        },
      ],
    ]),
  };
}

function derivedFieldValueExpression(
  derivedFieldId: ReturnType<typeof fieldId>,
): MonoLayoutExpression {
  return {
    kind: "fieldValue",
    fieldId: derivedFieldId,
    fieldKind: "derived",
    type: monoCoreType("u32"),
    sourceOrigin: LAYOUT_FIXTURE_SOURCE_ORIGIN,
  };
}

const LEN1_FIELD_ID = fieldId(1);
const LEN2_FIELD_ID = fieldId(2);
const LEN3_FIELD_ID = fieldId(3);

type DerivedCaseCondition = MonoLayoutExpression | { readonly kind: "otherwise" };

interface DerivedCaseOracleInput {
  readonly sourceMinimum: bigint;
  readonly sourceMaximum: bigint;
  readonly cases: readonly {
    readonly condition: DerivedCaseCondition;
    readonly result: MonoLayoutExpression;
  }[];
}

type Interval = readonly [minimum: bigint, maximum: bigint];

type DerivedCaseOracleResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly codes: readonly LayoutDiagnosticCode[] };

function derivedCaseInputArbitrary(): fastCheck.Arbitrary<DerivedCaseOracleInput> {
  return fastCheck
    .record({
      bitWidth: fastCheck.integer({ min: 1, max: 8 }),
      equalityValues: fastCheck.uniqueArray(fastCheck.bigInt({ min: 0n, max: 20n }), {
        minLength: 0,
        maxLength: 8,
      }),
      includeOtherwise: fastCheck.boolean(),
      duplicateIndex: fastCheck.option(fastCheck.integer({ min: 0, max: 7 }), { nil: undefined }),
      otherwiseNotLast: fastCheck.boolean(),
    })
    .map(({ bitWidth, equalityValues, includeOtherwise, duplicateIndex, otherwiseNotLast }) => {
      const sourceMinimum = 0n;
      const sourceMaximum = (1n << BigInt(bitWidth)) - 1n;
      const values =
        duplicateIndex !== undefined && equalityValues.length > 1
          ? withDuplicateValue(equalityValues, duplicateIndex)
          : equalityValues;

      const equalityCases = values.map((value) => ({
        condition: monoIntegerLiteral(value),
        result: monoIntegerLiteral(value + 100n),
      }));

      const cases: DerivedCaseOracleInput["cases"] = includeOtherwise
        ? otherwiseNotLast && equalityCases.length > 0
          ? [
              { condition: { kind: "otherwise" }, result: monoIntegerLiteral(999n) },
              ...equalityCases,
            ]
          : [
              ...equalityCases,
              { condition: { kind: "otherwise" }, result: monoIntegerLiteral(999n) },
            ]
        : equalityCases;

      return {
        sourceMinimum,
        sourceMaximum,
        cases,
      };
    });
}

function withDuplicateValue(values: readonly bigint[], duplicateIndex: number): readonly bigint[] {
  if (values.length === 0) {
    return values;
  }
  const copy = [...values];
  const sourceIndex = duplicateIndex % copy.length;
  copy[(sourceIndex + 1) % copy.length] = copy[sourceIndex]!;
  return copy;
}

function derivedCaseIntervalOracle(input: DerivedCaseOracleInput): DerivedCaseOracleResult {
  const otherwiseValidation = validateOtherwisePlacementOracle(input.cases);
  if (otherwiseValidation.kind === "error") {
    return otherwiseValidation;
  }

  const codes = new Set<LayoutDiagnosticCode>();
  const sourceRange: Interval = [input.sourceMinimum, input.sourceMaximum];
  const seenEqualityValues = new Set<string>();
  let remainingCoverage: Interval[] = [sourceRange];
  let hasOtherwise = false;

  for (const caseRecord of input.cases) {
    if (caseRecord.condition.kind === "otherwise") {
      hasOtherwise = true;
      continue;
    }

    const equalityValue = integerLiteralValue(caseRecord.condition);
    if (equalityValue === undefined) {
      continue;
    }

    if (equalityValue < sourceRange[0] || equalityValue > sourceRange[1]) {
      codes.add(layoutDiagnosticCode("LAYOUT_DERIVED_CASE_OUT_OF_RANGE"));
      continue;
    }

    const equalityKey = equalityValue.toString();
    if (seenEqualityValues.has(equalityKey)) {
      codes.add(layoutDiagnosticCode("LAYOUT_DERIVED_DUPLICATE_CASE"));
      continue;
    }
    seenEqualityValues.add(equalityKey);
    remainingCoverage = subtractPointFromIntervals(remainingCoverage, equalityValue);
  }

  if (!hasOtherwise && remainingCoverage.length > 0) {
    codes.add(layoutDiagnosticCode("LAYOUT_DERIVED_CASE_NOT_TOTAL"));
  }

  if (codes.size > 0) {
    return { kind: "error", codes: [...codes] };
  }
  return { kind: "ok" };
}

function validateOtherwisePlacementOracle(
  cases: DerivedCaseOracleInput["cases"],
): DerivedCaseOracleResult {
  const codes = new Set<LayoutDiagnosticCode>();
  let otherwiseCount = 0;

  for (let index = 0; index < cases.length; index += 1) {
    const caseRecord = cases[index]!;
    if (caseRecord.condition.kind !== "otherwise") {
      continue;
    }
    otherwiseCount += 1;
    if (index !== cases.length - 1) {
      codes.add(layoutDiagnosticCode("LAYOUT_DERIVED_OTHERWISE_NOT_LAST"));
    }
  }

  if (otherwiseCount > 1) {
    codes.add(layoutDiagnosticCode("LAYOUT_DERIVED_OTHERWISE_NOT_LAST"));
  }

  if (codes.size > 0) {
    return { kind: "error", codes: [...codes] };
  }
  return { kind: "ok" };
}

function integerLiteralValue(expression: MonoLayoutExpression): bigint | undefined {
  if (expression.kind !== "integerLiteral") {
    return undefined;
  }
  return expression.value;
}

function subtractPointFromIntervals(intervals: Interval[], value: bigint): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals) {
    const [minimum, maximum] = interval;
    if (value < minimum || value > maximum) {
      result.push(interval);
      continue;
    }
    if (minimum < value) {
      result.push([minimum, value - 1n]);
    }
    if (value < maximum) {
      result.push([value + 1n, maximum]);
    }
  }
  return result;
}

describe("computeDerivedFieldFacts", () => {
  test("derived cases require otherwise to be last", () => {
    const result = computeDerivedFieldFacts(
      derivedFieldFixture({
        cases: [
          { condition: { kind: "otherwise" }, result: monoIntegerLiteral(0n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(1n) },
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_DERIVED_OTHERWISE_NOT_LAST"),
    );
  });

  test("duplicate equality case values are rejected", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(10n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(11n) },
        ],
      }),
      ...narrowLayoutFieldSource(2n),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_DERIVED_DUPLICATE_CASE"),
    );
  });

  test("equality values outside the source range are rejected", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [{ condition: monoIntegerLiteral(5n), result: monoIntegerLiteral(0n) }],
      }),
      ...narrowLayoutFieldSource(2n),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_DERIVED_CASE_OUT_OF_RANGE"),
    );
  });

  test("finite coverage without otherwise must be complete", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [
          { condition: monoIntegerLiteral(0n), result: monoIntegerLiteral(0n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(1n) },
        ],
      }),
      ...narrowLayoutFieldSource(2n),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_DERIVED_CASE_NOT_TOTAL"),
    );
  });

  test("total derived cases produce a finite union result range", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [
          { condition: monoIntegerLiteral(0n), result: monoIntegerLiteral(10n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(20n) },
          { condition: { kind: "otherwise" }, result: monoIntegerLiteral(30n) },
        ],
      }),
      ...narrowLayoutFieldSource(2n),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.fact.cases).toHaveLength(3);
    expect(result.value.resultRange).toEqual({
      minimum: 10n,
      maximum: 30n,
      provenance: "derivedCases",
    });
    expect(result.value.fact.type).toEqual({ kind: "core", coreTypeId: coreTypeId("u32") });
  });

  test("derived source expression translates to a layout term", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [{ condition: { kind: "otherwise" }, result: monoIntegerLiteral(0n) }],
      }),
      source: layoutFieldSourceExpression(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.fact.source.kind).toBe("fieldValue");
    if (result.value.fact.source.kind !== "fieldValue") return;
    expect(result.value.fact.source.fieldId).toBe(DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID);
    expect(result.value.fact.source.unit).toBe("scalarValue");
  });

  test("derived diagnostics use validated-buffer owner and root cause keys", () => {
    const instanceId = "validated-buffer:Packet" as import("../../../src/mono/ids").MonoInstanceId;
    const derivedFieldId = fieldId(42);
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [{ condition: monoIntegerLiteral(9n), result: monoIntegerLiteral(0n) }],
      }),
      instanceId,
      fieldId: derivedFieldId,
      ...narrowLayoutFieldSource(1n),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === "LAYOUT_DERIVED_CASE_OUT_OF_RANGE",
    );
    expect(diagnostic?.ownerKey).toBe(
      `validated-buffer:${String(instanceId)}:derived:${String(derivedFieldId)}`,
    );
    expect(diagnostic?.rootCauseKey).toBe(`validated-buffer:${String(instanceId)}`);
  });

  test("transitive derived field ranges use earlier derived ranges in declaration order", () => {
    const len1Result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        fieldId: LEN1_FIELD_ID,
        cases: [
          { condition: monoIntegerLiteral(0n), result: monoIntegerLiteral(10n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(20n) },
          { condition: { kind: "otherwise" }, result: monoIntegerLiteral(30n) },
        ],
      }),
      ...narrowLayoutFieldSource(2n),
    });
    expect(len1Result.kind).toBe("ok");
    if (len1Result.kind !== "ok") return;

    const derivedFieldRangeByFieldId = new Map<ReturnType<typeof fieldId>, LayoutIntegerRange>([
      [LEN1_FIELD_ID, len1Result.value.resultRange],
    ]);

    const len2Result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        fieldId: LEN2_FIELD_ID,
        cases: [
          { condition: monoIntegerLiteral(10n), result: monoIntegerLiteral(100n) },
          { condition: monoIntegerLiteral(20n), result: monoIntegerLiteral(200n) },
          { condition: { kind: "otherwise" }, result: monoIntegerLiteral(300n) },
        ],
      }),
      source: derivedFieldValueExpression(LEN1_FIELD_ID),
      derivedFieldRangeByFieldId,
      dependencyContext: {
        parameterFieldIds: new Set<string>(),
        availableLayoutFieldIds: new Set([String(DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID)]),
        availableDerivedFieldIds: new Set([String(LEN1_FIELD_ID)]),
      },
    });
    expect(len2Result.kind).toBe("ok");
    if (len2Result.kind !== "ok") return;

    derivedFieldRangeByFieldId.set(LEN2_FIELD_ID, len2Result.value.resultRange);

    const len3Result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        fieldId: LEN3_FIELD_ID,
        cases: [
          { condition: monoIntegerLiteral(100n), result: monoIntegerLiteral(1000n) },
          { condition: monoIntegerLiteral(200n), result: monoIntegerLiteral(2000n) },
          { condition: { kind: "otherwise" }, result: monoIntegerLiteral(3000n) },
        ],
      }),
      source: derivedFieldValueExpression(LEN2_FIELD_ID),
      derivedFieldRangeByFieldId,
      dependencyContext: {
        parameterFieldIds: new Set<string>(),
        availableLayoutFieldIds: new Set([String(DERIVED_FIELD_FIXTURE_SOURCE_FIELD_ID)]),
        availableDerivedFieldIds: new Set([String(LEN1_FIELD_ID), String(LEN2_FIELD_ID)]),
      },
    });

    expect(len3Result.kind).toBe("ok");
  });

  test("complete explicit equality coverage succeeds without otherwise", () => {
    const result = computeDerivedFieldFacts({
      ...derivedFieldFixture({
        cases: [
          { condition: monoIntegerLiteral(0n), result: monoIntegerLiteral(100n) },
          { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(200n) },
        ],
      }),
      ...narrowLayoutFieldSource(1n),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.value.fact.cases.every((caseFact) => caseFact.condition.kind !== "otherwise"),
    ).toBe(true);
    expect(result.value.resultRange).toEqual({
      minimum: 100n,
      maximum: 200n,
      provenance: "derivedCases",
    });
  });

  test("derived case coverage and duplicate rejection match independent interval-set oracle", () => {
    fastCheck.assert(
      fastCheck.property(derivedCaseInputArbitrary(), (input) => {
        const oracle = derivedCaseIntervalOracle(input);
        const result = computeDerivedFieldFacts({
          ...derivedFieldFixture({ cases: input.cases as readonly DerivedFieldFixtureCase[] }),
          ...narrowLayoutFieldSource(input.sourceMaximum),
        });

        if (oracle.kind === "error") {
          expect(result.kind).toBe("error");
          if (result.kind === "error") {
            for (const code of oracle.codes) {
              expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
            }
          }
          return;
        }

        expect(result.kind).toBe("ok");
      }),
      { numRuns: 100 },
    );
  });
});

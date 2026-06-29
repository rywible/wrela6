import { describe, expect, test } from "bun:test";
import {
  optIrMaskedVectorOperationTypeRule,
  optIrVectorType,
  vectorMaskType,
} from "../../../src/opt-ir/vector-types";
import { optIrSignedIntegerType, optIrTypesEqual } from "../../../src/opt-ir/types";

describe("OptIR vector types", () => {
  test("vector lane type and lane count are part of type identity", () => {
    expect(
      optIrTypesEqual(
        optIrVectorType(optIrSignedIntegerType(32), 4),
        optIrVectorType(optIrSignedIntegerType(32), 8),
      ),
    ).toBe(false);
    expect(
      optIrTypesEqual(
        optIrVectorType(optIrSignedIntegerType(32), 4),
        optIrVectorType(optIrSignedIntegerType(32), 4),
      ),
    ).toBe(true);
  });

  test("vector mask lane counts are part of type identity", () => {
    expect(optIrTypesEqual(vectorMaskType(4), vectorMaskType(8))).toBe(false);
    expect(optIrTypesEqual(vectorMaskType(4), vectorMaskType(4))).toBe(true);
  });

  test("lane counts must be positive whole lanes", () => {
    expect(() => optIrVectorType(optIrSignedIntegerType(32), 0)).toThrow("lane count");
    expect(() => vectorMaskType(1.5)).toThrow("lane count");
  });

  test("masked operation rules retain inactive-lane behavior", () => {
    const laneType = optIrSignedIntegerType(32);
    const mergeRule = optIrMaskedVectorOperationTypeRule({
      resultType: optIrVectorType(laneType, 4),
      maskType: vectorMaskType(4),
      inactiveLaneBehavior: "passthrough",
    });
    const zeroRule = optIrMaskedVectorOperationTypeRule({
      resultType: optIrVectorType(laneType, 4),
      maskType: vectorMaskType(4),
      inactiveLaneBehavior: "zero",
    });

    expect(mergeRule).not.toEqual(zeroRule);
    expect(mergeRule.requiresPassthroughValue).toBe(true);
    expect(zeroRule.requiresPassthroughValue).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

import {
  optIrIntegerBinaryOperation,
  type OptIrIntegerBinaryOperator,
  type OptIrOperation,
} from "../../../../src/opt-ir/operations";
import { optIrOperationId, optIrOriginId, optIrValueId } from "../../../../src/opt-ir/ids";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import { compareOptIrSlicesForTest } from "../../../support/opt-ir/opt-ir-differential";
import {
  constantOperationForTest,
  linearSliceForTest,
} from "../../../support/opt-ir/opt-ir-interpreter";

describe("generated arithmetic miscompile-confidence seed", () => {
  test("compares 50 deterministic straight-line unsigned arithmetic programs", () => {
    const results = Array.from({ length: 50 }, (_unused, index) =>
      compareOptIrSlicesForTest(generatedArithmeticCase(index + 1)),
    );

    expect(results).toEqual(Array.from({ length: 50 }, () => ({ kind: "equivalent" })));
  });
});

function generatedArithmeticCase(seed: number): Parameters<typeof compareOptIrSlicesForTest>[0] {
  const width = 32;
  const integerType = optIrUnsignedIntegerType(width);
  const addendValue = BigInt((seed * 17 + 11) >>> 0);
  const factorValue = BigInt((seed * 31 + 7) >>> 0);
  const scaleValue = BigInt((seed % 5) + 1);

  const beforeOperations: OptIrOperation[] = [
    constantOperationForTest(0, 0, integerType, addendValue),
    constantOperationForTest(1, 1, integerType, factorValue),
    constantOperationForTest(2, 2, integerType, scaleValue),
    arithmeticOperation(3, 3, 1, 2, "multiply"),
    arithmeticOperation(4, 4, 0, 3, "add"),
  ];
  const afterOperations: OptIrOperation[] = [
    constantOperationForTest(0, 0, integerType, addendValue),
    constantOperationForTest(1, 1, integerType, factorValue),
    constantOperationForTest(2, 2, integerType, scaleValue),
    constantOperationForTest(3, 3, integerType, factorValue * scaleValue),
    arithmeticOperation(4, 4, 0, 3, "add"),
  ];

  return {
    before: linearSliceForTest(beforeOperations, [optIrValueId(4)]),
    after: linearSliceForTest(afterOperations, [optIrValueId(4)]),
  };
}

function arithmeticOperation(
  operation: number,
  result: number,
  left: number,
  right: number,
  operator: OptIrIntegerBinaryOperator,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator,
    resultType: optIrUnsignedIntegerType(32),
    originId: optIrOriginId(0),
  });
}

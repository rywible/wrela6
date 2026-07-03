import { describe, expect, test } from "bun:test";

import { optIrOperationId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrIntegerBinaryOperation } from "../../../src/opt-ir/operations";
import { rewriteOptIrOperationValues } from "../../../src/opt-ir/passes/operation-value-rewrite";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR operation value rewrite", () => {
  test("rewrites canonical operands and operation-specific value fields together", () => {
    const operation = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(1),
      operator: "add",
      left: optIrValueId(10),
      right: optIrValueId(11),
      resultId: optIrValueId(12),
      resultType: optIrSignedIntegerType(32),
      originId: optIrOriginId(1),
    });

    const rewritten = rewriteOptIrOperationValues(operation, {
      valueFor(valueId) {
        return valueId === optIrValueId(10)
          ? optIrValueId(20)
          : valueId === optIrValueId(12)
            ? optIrValueId(22)
            : valueId;
      },
    });

    expect(rewritten.operandIds).toEqual([optIrValueId(20), optIrValueId(11)]);
    expect(rewritten.resultIds).toEqual([optIrValueId(22)]);
    expect(rewritten.kind).toBe("integerBinary");
    if (rewritten.kind !== "integerBinary") return;
    expect(rewritten.left).toBe(optIrValueId(20));
    expect(rewritten.right).toBe(optIrValueId(11));
    expect(rewritten.resultIds[0]).toBe(optIrValueId(22));
  });
});

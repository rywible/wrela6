import { describe, expect, test } from "bun:test";

import { optIrOperationId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import {
  optIrFpNumericOperation,
  optIrBooleanNotOperation,
  optIrSemanticChecksumOperation,
  optIrVectorSelectOperation,
} from "../../../src/opt-ir/operations";
import { rewriteOptIrSourceValueOperationOperands } from "../../../src/opt-ir/source-value-operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR source-value operation helpers", () => {
  test("rewrite keeps vector-select masks separate from source values", () => {
    const operation = optIrVectorSelectOperation({
      operationId: optIrOperationId(7),
      mask: optIrValueId(1),
      sourceValueIds: [optIrValueId(2), optIrValueId(3)],
      resultId: optIrValueId(4),
      resultType: optIrUnsignedIntegerType(32),
      originId: optIrOriginId(7),
    });

    const rewritten = rewriteOptIrSourceValueOperationOperands(operation, [
      optIrValueId(10),
      optIrValueId(11),
      optIrValueId(12),
    ]);

    expect(rewritten).toMatchObject({
      operandIds: [optIrValueId(10), optIrValueId(11), optIrValueId(12)],
      mask: optIrValueId(10),
      sourceValueIds: [optIrValueId(11), optIrValueId(12)],
    });
  });

  test("rewrite aligns semantic and fp source values to operands", () => {
    const resultType = optIrUnsignedIntegerType(32);
    const semantic = optIrSemanticChecksumOperation({
      operationId: optIrOperationId(8),
      operands: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(3)],
      resultTypes: [resultType],
      semanticContract: { algorithm: "crc32" },
      originId: optIrOriginId(8),
    });
    const numeric = optIrFpNumericOperation({
      operationId: optIrOperationId(9),
      operands: [optIrValueId(4), optIrValueId(5)],
      resultIds: [optIrValueId(6)],
      resultTypes: [resultType],
      numericContract: { family: "multiplyAdd" },
      originId: optIrOriginId(9),
    });

    expect(
      rewriteOptIrSourceValueOperationOperands(semantic, [optIrValueId(20), optIrValueId(21)]),
    ).toMatchObject({
      operandIds: [optIrValueId(20), optIrValueId(21)],
      sourceValueIds: [optIrValueId(20), optIrValueId(21)],
    });
    expect(
      rewriteOptIrSourceValueOperationOperands(numeric, [optIrValueId(22), optIrValueId(23)]),
    ).toMatchObject({
      operandIds: [optIrValueId(22), optIrValueId(23)],
      sourceValueIds: [optIrValueId(22), optIrValueId(23)],
    });
  });

  test("rewrite rejects operations that are not source-value operations", () => {
    expect(() =>
      rewriteOptIrSourceValueOperationOperands(
        optIrBooleanNotOperation({
          operationId: optIrOperationId(10),
          operand: optIrValueId(1),
          resultId: optIrValueId(2),
          originId: optIrOriginId(10),
        }),
        [optIrValueId(3)],
      ),
    ).toThrow("booleanNot is not an OptIR source-value operation.");
  });
});

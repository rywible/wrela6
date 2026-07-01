import { describe, expect, test } from "bun:test";
import { optIrOperationId, optIrOriginId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrFpNumericOperation } from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { fpNumericFactRecord } from "../../../src/opt-ir/facts/fp-numeric-facts";
import { createAArch64FactQuery } from "../../../src/target/aarch64/facts/aarch64-fact-adapter";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { optIrFactId } from "../../../src/opt-ir/ids";

describe("AArch64 FP and numeric facts", () => {
  test("FP numeric operations carry schema-derived metadata", () => {
    const operation = optIrFpNumericOperation({
      operationId: optIrOperationId(3),
      operands: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(3)],
      resultTypes: [optIrUnsignedIntegerType(32)],
      numericContract: { family: "dotProduct", laneWidth: 8, signedness: "unsigned" },
      originId: optIrOriginId(3),
    });

    expect(operation.kind).toBe("fpNumeric");
    expect(String(operation.semantics.interpreterRule)).toBe("fp-numeric");
  });

  test("FP contraction query requires explicit rounding authority", () => {
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        fpNumericFactRecord({
          factId: optIrFactId(8),
          operationId: optIrOperationId(12),
          contraction: "allowed",
          rounding: "nearestTiesToEven",
        }),
      ]),
    );

    expect(query.fpContractionForOperation?.(optIrOperationId(12))).toMatchObject({
      kind: "yes",
      contraction: "allowed",
      rounding: "nearestTiesToEven",
    });
  });

  test("FP numeric facts preserve lane, signedness, accumulation, and range metadata", () => {
    const record = fpNumericFactRecord({
      factId: optIrFactId(9),
      operationId: optIrOperationId(13),
      laneWidthBits: 8,
      signedness: "unsigned",
      accumulation: "widening",
      saturation: "none",
      errorBoundUlps: 0,
      numericRange: { min: 0, max: 255 },
    });

    expect(record.extensionPayload).toMatchObject({
      laneWidthBits: 8,
      signedness: "unsigned",
      accumulation: "widening",
      saturation: "none",
      errorBoundUlps: 0,
      numericRange: { min: 0, max: 255 },
    });
    expect(() =>
      fpNumericFactRecord({
        factId: optIrFactId(10),
        operationId: optIrOperationId(14),
        laneWidthBits: 0,
      }),
    ).toThrow("FP numeric lane width must be a positive integer.");
  });
});

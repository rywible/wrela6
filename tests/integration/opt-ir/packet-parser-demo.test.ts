import { describe, expect, test } from "bun:test";

import { buildOptimizedOptIr } from "../../../src/opt-ir/public-api";
import {
  canonicalPacketLoadsForTest,
  derivedFieldOperationKindsForTest,
  hasNoProofOrValidationWrappersForTest,
  packetParserDemoInputForTest,
  packetParserDemoOptimizerForTest,
} from "../../support/opt-ir/packet-parser-demo-fixtures";

describe("OptIR packet parser demonstration", () => {
  test("optimizes a validated packet parser to direct packet reads with explanations", () => {
    const result = buildOptimizedOptIr(packetParserDemoInputForTest(), {
      optimizer: packetParserDemoOptimizerForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected packet parser demo construction and optimization to succeed.");
    }

    expect(hasNoProofOrValidationWrappersForTest(result.operations)).toBe(true);
    expect(result.program.operations?.map((operation) => operation.operationId)).toEqual(
      result.operations.map((operation) => operation.operationId),
    );
    const blockOperationIds = new Set(
      result.program.functions
        .entries()
        .flatMap((function_) => function_.blocks.flatMap((block) => block.operations)),
    );
    expect(
      result.operations.every((operation) => blockOperationIds.has(operation.operationId)),
    ).toBe(true);
    expect(canonicalPacketLoadsForTest(result.operations)).toHaveLength(2);
    expect(derivedFieldOperationKindsForTest(result.operations)).toEqual(
      expect.arrayContaining([
        "memoryLoad",
        "layoutEndianDecode",
        "integerBinary",
        "integerCompare",
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageTemplate: "removed bounds check",
          stableDetail: expect.stringContaining("facts:validated-buffer:dominating-bounds"),
        }),
        expect.objectContaining({
          messageTemplate: "removed parser state",
          stableDetail: expect.stringContaining("terminal:cold-reject-unobservable"),
        }),
        expect.objectContaining({
          messageTemplate: "removed wrapper",
          stableDetail: expect.stringContaining("erasure:713"),
        }),
        expect.objectContaining({
          messageTemplate: "removed copy helper",
          stableDetail: expect.stringContaining("ownership:714"),
        }),
        expect.objectContaining({
          messageTemplate: "folded endian decode",
          stableDetail: expect.stringContaining("layout:endian:big"),
        }),
      ]),
    );
  });
});

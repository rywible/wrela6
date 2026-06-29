import { describe, expect, test } from "bun:test";

import { optIrOperationId, optIrOriginId } from "../../../src/opt-ir/ids";
import { buildOptimizedOptIr } from "../../../src/opt-ir/public-api";
import {
  canonicalPacketLoadsForTest,
  derivedFieldOperationKindsForTest,
  hasNoProofOrValidationWrappersForTest,
  optimizedPacketParserDemoSnapshotForTest,
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
          stableDetail: expect.stringContaining("facts:validated-buffer:packet:attested"),
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
          stableDetail: expect.stringContaining("layout:endian:network"),
        }),
      ]),
    );
  });

  test("keeps only semantically observable rejected parse paths", () => {
    const snapshot = optimizedPacketParserDemoSnapshotForTest();

    expect(snapshot.endianParser.removedParserStateOperationIds).toEqual([
      optIrOperationId(711),
      optIrOperationId(712),
    ]);
    expect(snapshot.endianParser.explanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnosticOrigins: [optIrOriginId(701)],
          coldRejectionOrigins: [optIrOriginId(702)],
        }),
      ]),
    );
    expect(snapshot.operations.map((operation) => operation.displayName)).toContain(
      "observable-reject",
    );
    expect(snapshot.operations.map((operation) => operation.displayName)).not.toContain(
      "parser-state",
    );
  });
});

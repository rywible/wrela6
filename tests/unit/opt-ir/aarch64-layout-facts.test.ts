import { describe, expect, test } from "bun:test";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import {
  createOptIrLayoutFactQuery,
  layoutByteRangeFactRecord,
} from "../../../src/opt-ir/facts/layout-facts";
import { optIrFactId } from "../../../src/opt-ir/ids";

describe("AArch64 layout byte-range facts", () => {
  test("record authenticated byte offsets and sizes by layout key", () => {
    const layoutKey = layoutFactKey("layout:packet.header.length");
    const record = layoutByteRangeFactRecord({
      factId: optIrFactId(1),
      layoutKey,
      offsetBytes: 24n,
      sizeBytes: 2n,
    });

    expect(record).toMatchObject({
      extensionKey: "layout-byte-range",
      extensionPayload: { offsetBytes: "24", sizeBytes: "2" },
      subjectKey: "layout:layout:packet.header.length",
    });
    expect(
      createOptIrLayoutFactQuery(optIrFactSetFromRecords([record])).byteRangeForLayout(layoutKey),
    ).toEqual({
      kind: "yes",
      value: { offsetBytes: 24n, sizeBytes: 2n },
      factsUsed: [optIrFactId(1)],
      explanation: ["Fact 1 proves layout byte range for layout:layout:packet.header.length."],
    });
  });

  test("reject malformed byte ranges before they enter lowering", () => {
    const layoutKey = layoutFactKey("layout:packet.header.kind");

    expect(() =>
      layoutByteRangeFactRecord({
        factId: optIrFactId(2),
        layoutKey,
        offsetBytes: -1n,
        sizeBytes: 1n,
      }),
    ).toThrow("layout byte-range offset must be non-negative");
    expect(() =>
      layoutByteRangeFactRecord({
        factId: optIrFactId(3),
        layoutKey,
        offsetBytes: 0n,
        sizeBytes: 0n,
      }),
    ).toThrow("layout byte-range size must be positive");
  });
});

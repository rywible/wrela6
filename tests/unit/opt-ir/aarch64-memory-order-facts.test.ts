import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrOperationId } from "../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import {
  barrierDomainFactRecord,
  memoryOrderFactRecord,
} from "../../../src/opt-ir/facts/memory-order-facts";
import { createAArch64FactQuery } from "../../../src/target/aarch64/facts/aarch64-fact-adapter";

describe("AArch64 memory-order facts", () => {
  test("record builder creates a deterministic extension fact", () => {
    const record = memoryOrderFactRecord({
      factId: optIrFactId(1),
      operationId: optIrOperationId(7),
      order: "release",
      accessKind: "store",
      publicationShape: "virtioAvailIndexPublication",
    });

    expect(record).toMatchObject({
      extensionKey: "memory-order",
      extensionPacketKind: "memory-order",
      subjectKey: "operation:7",
      extensionPayload: {
        accessKind: "store",
        order: "release",
        publicationShape: "virtioAvailIndexPublication",
      },
      extensionAuthority: "proof:memory-order",
    });
    expect(record.explanation.certificateExplanation).toBe(
      "extension-authority:proof:memory-order",
    );
  });

  test("AArch64 query exposes operation memory order with stable explanation", () => {
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        memoryOrderFactRecord({
          factId: optIrFactId(2),
          operationId: optIrOperationId(9),
          order: "acquireRelease",
          accessKind: "readModifyWrite",
          publicationShape: "ringDoorbellPublication",
        }),
      ]),
    );

    expect(query.memoryOrderForOperation(optIrOperationId(9))).toEqual({
      kind: "yes",
      accessKind: "readModifyWrite",
      order: "acquireRelease",
      publicationShape: "ringDoorbellPublication",
      factsUsed: [optIrFactId(2)],
      explanation: ["Fact 2 supplies memory-order for operation:9."],
    });
  });

  test("record builder rejects acquire-only stores deterministically", () => {
    expect(() =>
      memoryOrderFactRecord({
        factId: optIrFactId(3),
        operationId: optIrOperationId(10),
        order: "acquire",
        accessKind: "store",
      }),
    ).toThrow("memory-order acquire facts require a load or read-modify-write access.");
  });

  test("barrier-domain facts stay target-neutral", () => {
    const record = barrierDomainFactRecord({
      factId: optIrFactId(4),
      operationId: optIrOperationId(11),
      domain: "system",
    });

    expect(record.extensionPayload).toEqual({ domain: "system" });
  });
});

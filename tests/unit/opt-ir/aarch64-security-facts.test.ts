import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { securityFactRecord } from "../../../src/opt-ir/facts/security-facts";
import { createAArch64FactQuery } from "../../../src/target/aarch64/facts/aarch64-fact-adapter";

describe("AArch64 security facts", () => {
  test("record builder sorts labels for deterministic payloads", () => {
    const record = securityFactRecord({
      factId: optIrFactId(21),
      valueId: optIrValueId(8),
      labels: ["wipeOnSpill", "secret"],
      domain: "guest",
      constantTime: true,
    });

    expect(record).toMatchObject({
      extensionKey: "security",
      extensionPacketKind: "security",
      subjectKey: "value:8",
      extensionPayload: {
        constantTime: true,
        domain: "guest",
        labels: ["secret", "wipeOnSpill"],
      },
      extensionAuthority: "proof:security",
    });
  });

  test("AArch64 query maps labels into spill policy", () => {
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        securityFactRecord({
          factId: optIrFactId(22),
          valueId: optIrValueId(9),
          labels: ["secret", "wipeOnSpill"],
          domain: "host",
        }),
      ]),
    );

    expect(query.securityForValue(optIrValueId(9))).toEqual({
      kind: "yes",
      constantTime: undefined,
      domain: "host",
      secret: true,
      spillPolicy: "wipeOnSpill",
      factsUsed: [optIrFactId(22)],
      explanation: ["Fact 22 supplies security for value:9."],
    });
  });

  test("record builder rejects contradictory spill labels", () => {
    expect(() =>
      securityFactRecord({
        factId: optIrFactId(23),
        valueId: optIrValueId(10),
        labels: ["noSpill", "wipeOnSpill"],
      }),
    ).toThrow("security labels cannot require both noSpill and wipeOnSpill.");
  });

  test("record builder rejects unsupported frame object string subjects", () => {
    expect(() =>
      securityFactRecord({
        factId: optIrFactId(24),
        frameObjectKey: "spill.slot",
        labels: ["wipeOnSpill"],
      }),
    ).toThrow("security frame object facts require a first-class frame object subject.");
  });
});

import { describe, expect, test } from "bun:test";

import { aarch64FactSpendingFromFacts } from "../../../../../src/target/aarch64/backend/api/object-assembly";
import { createAArch64BackendFactIndex } from "../../../../../src/target/aarch64/backend/facts/backend-fact-query";

describe("AArch64 backend fact spending", () => {
  test("spends duplicate identical imported facts once", () => {
    const fact = {
      family: "memory-order-and-region-type",
      subject: { kind: "region" as const, regionKey: "region:2" },
      subjectKey: "region:2",
      payload: { order: "relaxed", region: "region:2", regionType: "normal" },
      lineageOptIrFactIds: [101],
      upstreamVerifierKey: "proof.memory-order",
      sourceStableKey:
        'region:2|extension:memory-order-and-region-type|payload:{"order":"relaxed","region":"region:2","regionType":"normal"}|lineage:101|target:target.memory-order|gate:optir.memoryLoad.aarch64-materialized',
    };

    const spending = aarch64FactSpendingFromFacts(createAArch64BackendFactIndex([fact, fact]));

    expect(spending).toEqual([
      expect.objectContaining({
        stableKey:
          'fact-spent:memory-order-and-region-type:region:2|extension:memory-order-and-region-type|payload:{"order":"relaxed","region":"region:2","regionType":"normal"}|lineage:101|target:target.memory-order|gate:optir.memoryLoad.aarch64-materialized',
        authority: "memory-order-and-region-type",
        payload: "region:2",
      }),
    ]);
  });
});

import { describe, expect, test } from "bun:test";

import { repairAllocationWithSpillsAndRemats } from "../../../../../src/target/aarch64/backend/allocation/spill-remat";

describe("AArch64 spill and rematerialization repair", () => {
  test("prefers legal rematerialization and records rewrite provenance", () => {
    const result = repairAllocationWithSpillsAndRemats({
      requests: [
        {
          requestKey: "repair:1",
          vreg: 1,
          kind: "rematerialize",
          useSiteKey: "use:1",
          widthBytes: 8,
        },
      ],
      rematerialization: [
        { vreg: 1, kind: "constant", legalAtUseSiteKeys: ["use:1"], constantValue: 7n },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected repair");
    expect(result.value.drafts.map((draft) => draft.kind)).toEqual(["remat"]);
    expect(result.value.drafts[0]?.rematerialization).toEqual({ kind: "constant", value: 7n });
    expect(result.value.provenance).toEqual(["rewrite:rematerialization:repair:1"]);
  });

  test("rejects relocation-pair remat and no-spill memory placement", () => {
    const result = repairAllocationWithSpillsAndRemats({
      requests: [
        {
          requestKey: "repair:no-spill",
          vreg: 2,
          kind: "spill",
          useSiteKey: "use:2",
          widthBytes: 8,
          noSpill: true,
        },
        {
          requestKey: "repair:pair",
          vreg: 3,
          kind: "rematerialize",
          useSiteKey: "use:3",
          widthBytes: 8,
        },
      ],
      rematerialization: [
        { vreg: 3, kind: "page-base", legalAtUseSiteKeys: ["use:3"], relocationPairKey: "page:g" },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected repair diagnostics");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "spill-remat:no-spill-memory-placement:vreg:2",
      "spill-remat:relocation-pair-remat-rejected:vreg:3:page:g",
    ]);
  });
});

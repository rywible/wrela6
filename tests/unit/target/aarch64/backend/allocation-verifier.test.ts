import { describe, expect, test } from "bun:test";

import { allocationResult } from "../../../../../src/target/aarch64/backend/allocation/allocation-result";
import { verifyAArch64Allocation } from "../../../../../src/target/aarch64/backend/verify/allocation-verifier";

describe("AArch64 allocation verifier", () => {
  test("rejects reserved x18, overlaps, and no-spill memory via security verifier", () => {
    const result = verifyAArch64Allocation({
      allocation: allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "x18",
            startOrder: 0,
            endOrder: 4,
            reason: "assigned",
          },
          {
            liveRangeKey: "live-range:vreg:2",
            vreg: 2,
            physical: "slot:0",
            startOrder: 0,
            endOrder: 4,
            reason: "spill",
          },
        ],
      }),
      noSpillVregs: [2],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected verifier error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "allocation-verifier:reserved-register-assigned:vreg:1:x18",
      "security:no-spill-memory-placement:vreg:2:spill-slot:slot:0",
    ]);
  });

  test("accepts intervals covered by segments or repair requests", () => {
    const result = verifyAArch64Allocation({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 4,
        },
        {
          liveRangeKey: "live-range:vreg:2",
          vreg: 2,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 4,
        },
      ],
      allocation: allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "x0",
            startOrder: 0,
            endOrder: 4,
            reason: "assigned",
          },
        ],
        repairRequests: [
          {
            liveRangeKey: "live-range:vreg:2",
            kind: "spill",
            stableDetail:
              "allocation:spill-required:vreg:2:range:0-4:class:gpr64:blockers:none-available",
          },
        ],
      }),
    });

    expect(result.kind).toBe("ok");
  });

  test("rejects uncovered intervals and overlapping physical register segments", () => {
    const result = verifyAArch64Allocation({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 4,
        },
        {
          liveRangeKey: "live-range:vreg:2",
          vreg: 2,
          registerClass: "gpr64",
          startOrder: 2,
          endOrder: 6,
        },
        {
          liveRangeKey: "live-range:vreg:3",
          vreg: 3,
          registerClass: "gpr64",
          startOrder: 6,
          endOrder: 8,
        },
      ],
      allocation: allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "x0",
            startOrder: 0,
            endOrder: 4,
            reason: "assigned",
          },
          {
            liveRangeKey: "live-range:vreg:2",
            vreg: 2,
            physical: "x0",
            startOrder: 2,
            endOrder: 6,
            reason: "assigned",
          },
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected verifier error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "allocation-verifier:physical-overlap:register:x0:left:live-range:vreg:1:0-4:right:live-range:vreg:2:2-6",
      "allocation-verifier:uncovered-interval:vreg:3:range:6-8:class:gpr64",
    ]);
  });

  test("rejects overlapping physical aliases", () => {
    const result = verifyAArch64Allocation({
      aliases: [{ left: "v0", right: "d0" }],
      allocation: allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "v0",
            startOrder: 0,
            endOrder: 4,
            reason: "assigned",
          },
          {
            liveRangeKey: "live-range:vreg:2",
            vreg: 2,
            physical: "d0",
            startOrder: 1,
            endOrder: 3,
            reason: "assigned",
          },
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected alias verifier error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "allocation-verifier:physical-alias-overlap:registers:d0,v0:left:live-range:vreg:2:1-3:right:live-range:vreg:1:0-4",
    ]);
  });
});

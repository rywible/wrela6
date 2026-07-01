import { describe, expect, test } from "bun:test";

import { allocateAArch64Registers } from "../../../../../src/target/aarch64/backend/allocation/allocator";

describe("AArch64 register allocator", () => {
  test("splits at call boundary before using spill repair", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:5",
          vreg: 5,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 10,
          cutPoints: [5],
        },
      ],
      availableGprs: ["x0"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected allocation");
    expect(result.allocation.segmentsFor(5).map((segment) => segment.reason)).toEqual([
      "pre-call",
      "post-call",
    ]);
  });

  test("no-spill unallocatable range fails deterministically", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:9",
          vreg: 9,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 2,
          noSpill: true,
        },
      ],
      availableGprs: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected allocation failure");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "allocation:no-spill-unallocatable:vreg:9:class:gpr64:blockers:none-available",
    ]);
  });

  test("spillable unallocatable range emits spill repair request", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:7",
          vreg: 7,
          registerClass: "gpr64",
          startOrder: 4,
          endOrder: 12,
        },
      ],
      availableGprs: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected repairable allocation");
    expect(result.allocation.segmentsFor(7)).toEqual([]);
    expect(result.allocation.repairRequests).toEqual([
      {
        liveRangeKey: "live-range:vreg:7",
        kind: "spill",
        stableDetail:
          "allocation:spill-required:vreg:7:range:4-12:class:gpr64:blockers:none-available",
      },
    ]);
    expect(result.allocation.progress.unresolvedRepairRequests).toBe(1);
  });

  test("aliasing physical registers cannot hold overlapping intervals", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "vector128",
          startOrder: 0,
          endOrder: 10,
        },
        {
          liveRangeKey: "live-range:vreg:2",
          vreg: 2,
          registerClass: "fp",
          startOrder: 2,
          endOrder: 8,
        },
      ],
      availableVectorRegisters: ["v0"],
      availableFpRegisters: ["d0", "d1"],
      aliases: [{ left: "v0", right: "d0" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected allocation");
    expect(result.allocation.segmentsFor(1).map((segment) => segment.physical)).toEqual(["v0"]);
    expect(result.allocation.segmentsFor(2).map((segment) => segment.physical)).toEqual(["d1"]);
  });

  test("interval-specific physical interferences do not shrink the whole register pool", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "vector128",
          startOrder: 0,
          endOrder: 2,
          physicalInterferences: ["v0"],
        },
        {
          liveRangeKey: "live-range:vreg:2",
          vreg: 2,
          registerClass: "vector128",
          startOrder: 2,
          endOrder: 4,
        },
      ],
      availableVectorRegisters: ["v0", "v1"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected allocation");
    expect(result.allocation.segmentsFor(1).map((segment) => segment.physical)).toEqual(["v1"]);
    expect(result.allocation.segmentsFor(2).map((segment) => segment.physical)).toEqual(["v0"]);
  });

  test("splits before spilling when pressure can be reduced at a cut point", () => {
    const result = allocateAArch64Registers({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 5,
          noSpill: true,
        },
        {
          liveRangeKey: "live-range:vreg:2",
          vreg: 2,
          registerClass: "gpr64",
          startOrder: 5,
          endOrder: 10,
          physicalInterferences: ["x0"],
        },
        {
          liveRangeKey: "live-range:vreg:3",
          vreg: 3,
          registerClass: "gpr64",
          startOrder: 0,
          endOrder: 10,
          cutPoints: [5],
        },
      ],
      availableGprs: ["x0", "x1"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected split allocation");
    expect(result.allocation.repairRequests).toEqual([]);
    expect(result.allocation.segmentsFor(3)).toEqual([
      {
        liveRangeKey: "live-range:vreg:3",
        vreg: 3,
        physical: "x1",
        startOrder: 0,
        endOrder: 5,
        reason: "assigned",
      },
      {
        liveRangeKey: "live-range:vreg:3",
        vreg: 3,
        physical: "x0",
        startOrder: 5,
        endOrder: 10,
        reason: "assigned",
      },
    ]);
    expect(result.allocation.progress).toEqual({
      unprocessedIntervals: 0,
      unsplitIntervals: 0,
      remainingCutPoints: 0,
      unresolvedRepairRequests: 0,
      frozenEpisodeCount: 1,
    });
  });
});

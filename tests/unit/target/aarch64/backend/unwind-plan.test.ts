import { describe, expect, test } from "bun:test";

import { planAArch64Unwind } from "../../../../../src/target/aarch64/backend/frame/unwind-plan";
import { fakeUnwindCatalog } from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";

describe("AArch64 unwind planning", () => {
  test("classifies frameless leaf and serializable frames", () => {
    const leaf = planAArch64Unwind({
      frame: {
        functionKey: "leaf",
        totalSizeBytes: 0,
        slots: [],
        wipeSlots: [],
        savedRegisters: [],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: false,
      },
      unwindCatalog: fakeUnwindCatalog(),
      finalization: {
        prologue: [],
        exitPlans: [{ exitKey: "return:leaf", ending: "return", instructions: [] }],
      },
    });
    const nonLeaf = planAArch64Unwind({
      frame: {
        functionKey: "main",
        totalSizeBytes: 48,
        slots: [],
        wipeSlots: [],
        savedRegisters: ["x19", "x20"],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: true,
      },
      unwindCatalog: fakeUnwindCatalog({
        templateForFrame: () => ({ frameShape: "frame-record", stableKey: "unwind:frame-record" }),
      }),
      finalization: {
        prologue: [{ role: "frame-record-setup", stableKey: "p:frame" }],
        exitPlans: [],
      },
    });

    expect(leaf.kind === "ok" && leaf.value.classification).toBe("frameless-leaf");
    expect(nonLeaf.kind === "ok" && nonLeaf.value.classification).toBe("serializable-unwind");
  });

  test("rejects missing catalog template", () => {
    const result = planAArch64Unwind({
      frame: {
        functionKey: "fixture.function",
        totalSizeBytes: 4096,
        slots: [],
        wipeSlots: [],
        savedRegisters: [],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: true,
      },
      unwindCatalog: fakeUnwindCatalog({ templates: [], templateForFrame: () => undefined }),
      finalization: { prologue: [], exitPlans: [] },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unwind error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "unwind:unrepresentable-frame:function:fixture.function:size:4096",
    ]);
  });
});

import { describe, expect, test } from "bun:test";

import { finalizeAArch64PrologueEpilogue } from "../../../../../src/target/aarch64/backend/frame/prologue-epilogue";

describe("AArch64 prologue and epilogue finalization", () => {
  test("emits deterministic prologue and ordinary return epilogue", () => {
    const result = finalizeAArch64PrologueEpilogue({
      frame: {
        functionKey: "main",
        totalSizeBytes: 32,
        slots: [],
        wipeSlots: [],
        savedRegisters: ["x19"],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: true,
      },
      exits: [{ exitKey: "return:main", kind: "return" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected finalization");
    expect(result.value.prologue.map((instruction) => instruction.role)).toEqual([
      "stack-adjust",
      "frame-record-setup",
      "save:x19",
      "unwind-marker",
    ]);
    expect(
      result.value.exitPlans[0]?.instructions.map((instruction) => instruction.role),
    ).toContain("return");
  });

  test("pending wipe turns tail call into ordinary call plus epilogue", () => {
    const result = finalizeAArch64PrologueEpilogue({
      frame: {
        functionKey: "main",
        totalSizeBytes: 16,
        slots: [],
        wipeSlots: [
          { slotKey: "secret", offsetBytes: -16, sizeBytes: 8, alignmentBytes: 8, role: "wipe" },
        ],
        savedRegisters: [],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: false,
      },
      exits: [{ exitKey: "tail:main:helper", kind: "tail-call", cleanupPending: true }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected finalization");
    expect(result.value.exitPlans[0]?.ending).toBe("ordinary-call-plus-epilogue");
    expect(
      result.value.exitPlans[0]?.instructions.map((instruction) => instruction.role),
    ).toContain("wipe-slot:secret");
  });
});

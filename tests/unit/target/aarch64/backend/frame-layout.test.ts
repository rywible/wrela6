import { describe, expect, test } from "bun:test";

import { layoutAArch64StackFrame } from "../../../../../src/target/aarch64/backend/frame/frame-layout";
import { verifyAArch64FrameLayout } from "../../../../../src/target/aarch64/backend/verify/frame-verifier";

describe("AArch64 frame layout", () => {
  test("keeps SP aligned and orders wipe slots before spills", () => {
    const result = layoutAArch64StackFrame({
      functionKey: "fixture.function",
      spillSlots: [
        { slotKey: "public", sizeBytes: 8, alignmentBytes: 8 },
        { slotKey: "secret", sizeBytes: 8, alignmentBytes: 8, wipeOnExit: true },
      ],
      outgoingArgBytes: 24,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected frame");
    expect(result.value.totalSizeBytes % 16).toBe(0);
    expect(result.value.wipeSlots.map((slot) => slot.slotKey)).toEqual(["secret"]);
    expect(result.value.outgoingArgSizeBytes).toBe(32);
  });

  test("verifier rejects incompatible security overlap", () => {
    const result = verifyAArch64FrameLayout({
      frame: {
        functionKey: "fixture.function",
        totalSizeBytes: 16,
        slots: [
          {
            slotKey: "secret",
            offsetBytes: -16,
            sizeBytes: 8,
            alignmentBytes: 8,
            securityLabel: "secret",
            role: "spill",
          },
          {
            slotKey: "public",
            offsetBytes: -16,
            sizeBytes: 8,
            alignmentBytes: 8,
            securityLabel: "public",
            role: "spill",
          },
        ],
        wipeSlots: [],
        savedRegisters: [],
        outgoingArgSizeBytes: 0,
        requiresFrameRecord: false,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected frame verifier error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "frame-verifier:incompatible-slot-overlap:secret:public",
    ]);
  });
});

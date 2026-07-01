import { describe, expect, test } from "bun:test";
import { lowerAArch64Call } from "../../../../src/target/aarch64/lower/call-lowering";
import { lowerAArch64MemoryOrder } from "../../../../src/target/aarch64/lower/memory-order-lowering";

describe("AArch64 platform-effect machine IR lowering", () => {
  test("platform effect calls remain indirect and do not create call relocations", () => {
    const result = lowerAArch64Call({ targetKind: "platform" });

    expect(result).toEqual({ kind: "ok", instructions: ["blr"], relocations: [], terminal: false });
  });

  test("device-ordered platform effects lower to the stronger synchronization barrier", () => {
    const result = lowerAArch64MemoryOrder({
      accessKind: "fence",
      order: "deviceOrdered",
      regionMemoryType: "deviceMmio",
    });

    expect(result).toEqual({ kind: "ok", instructions: ["dsb"] });
  });
});

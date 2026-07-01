import { describe, expect, test } from "bun:test";
import { lowerAArch64MemoryOrder } from "../../../../src/target/aarch64/lower/memory-order-lowering";

describe("AArch64 virtio memory ordering integration", () => {
  test("virtio release publication emits store-release before the required barrier", () => {
    const result = lowerAArch64MemoryOrder({
      accessKind: "store",
      order: "release",
      regionMemoryType: "deviceMmio",
      publicationShape: "virtio-avail-ring-publication",
    });

    expect(result).toEqual({ kind: "ok", instructions: ["stlr", "dmb"] });
  });

  test("virtio publication requires an explicit memory-order fact", () => {
    const result = lowerAArch64MemoryOrder({
      accessKind: "store",
      regionMemoryType: "normalCacheable",
      publicationShape: "virtio-avail-ring-publication",
    });

    expect(result).toEqual({ kind: "error", reason: "memory-order:missing-required-fact" });
  });
});

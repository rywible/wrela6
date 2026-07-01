import { describe, expect, test } from "bun:test";
import { lowerAArch64MemoryOrder } from "../../../../src/target/aarch64/lower/memory-order-lowering";

describe("AArch64 memory-model litmus lowering", () => {
  test("acquire load and release store lower to acquire-release primitives", () => {
    const acquireLoad = lowerAArch64MemoryOrder({
      accessKind: "load",
      order: "acquire",
      regionMemoryType: "normalCacheable",
    });
    const releaseStore = lowerAArch64MemoryOrder({
      accessKind: "store",
      order: "release",
      regionMemoryType: "normalCacheable",
    });

    expect(acquireLoad).toEqual({ kind: "ok", instructions: ["ldar"] });
    expect(releaseStore).toEqual({ kind: "ok", instructions: ["stlr"] });
  });

  test("sequentially consistent load keeps the barrier before the load", () => {
    const result = lowerAArch64MemoryOrder({
      accessKind: "load",
      order: "sequentiallyConsistent",
      regionMemoryType: "normalCacheable",
    });

    expect(result).toEqual({ kind: "ok", instructions: ["dmb", "ldar"] });
  });

  test("sequentially consistent store keeps the barrier after the store", () => {
    const result = lowerAArch64MemoryOrder({
      accessKind: "store",
      order: "sequentiallyConsistent",
      regionMemoryType: "normalCacheable",
    });

    expect(result).toEqual({ kind: "ok", instructions: ["stlr", "dmb"] });
  });
});

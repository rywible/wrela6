import { describe, expect, test } from "bun:test";

import { scheduleAArch64PostAllocation } from "../../../../../src/target/aarch64/backend/finalization/post-ra-scheduler";

describe("AArch64 post-allocation scheduler and peepholes", () => {
  test("moves a load ahead of an independent ALU instruction when latency hiding is enabled", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "alu", opcode: "add" },
        { id: 2, stableKey: "load", opcode: "ldr", memoryKey: "frame:8" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "load",
      "alu",
    ]);
  });

  test("barriers split dependency islands", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "before-alu", opcode: "add" },
        { id: 2, stableKey: "before-load", opcode: "ldr", memoryKey: "frame:8" },
        { id: 3, stableKey: "barrier", opcode: "dmb-ish", barrier: true },
        { id: 4, stableKey: "after-alu", opcode: "add" },
        { id: 5, stableKey: "after-load", opcode: "ldr", memoryKey: "frame:16" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "before-load",
      "before-alu",
      "barrier",
      "after-load",
      "after-alu",
    ]);
  });

  test("same memory keys preserve original order", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "store", opcode: "str", memoryKey: "frame:8" },
        { id: 2, stableKey: "load", opcode: "ldr", memoryKey: "frame:8" },
        { id: 3, stableKey: "independent-load", opcode: "ldr", memoryKey: "frame:16" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "independent-load",
      "store",
      "load",
    ]);
  });

  test("physical register dependencies block unsafe load latency motion", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        {
          id: 1,
          stableKey: "produce-address",
          opcode: "add",
          definedRegisters: ["x0"],
          usedRegisters: ["x1"],
        },
        {
          id: 2,
          stableKey: "dependent-load",
          opcode: "ldr",
          usedRegisters: ["x0"],
          memoryKey: "dynamic:x0",
        },
        {
          id: 3,
          stableKey: "overwrite-address",
          opcode: "add",
          definedRegisters: ["w0"],
          usedRegisters: ["x2"],
        },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "produce-address",
      "dependent-load",
      "overwrite-address",
    ]);
  });

  test("NZCV defs and uses preserve original order", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "cmp", opcode: "cmp", definesNzcv: true },
        { id: 2, stableKey: "load", opcode: "ldr", memoryKey: "frame:8" },
        { id: 3, stableKey: "branch", opcode: "b.cond", usesNzcv: true },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "load",
      "cmp",
      "branch",
    ]);
  });

  test("relocation pair instructions stay adjacent and in order", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "adrp", opcode: "adrp", relocationPairKey: "page:g" },
        { id: 2, stableKey: "add-pageoff", opcode: "add-pageoff", relocationPairKey: "page:g" },
        { id: 3, stableKey: "load", opcode: "ldr", memoryKey: "frame:8" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "load",
      "adrp",
      "add-pageoff",
    ]);
  });

  test("keeps barriers, NZCV chains, relocation pairs, and secret regions ordered", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "i1", opcode: "adrp", relocationPairKey: "page:g" },
        { id: 2, stableKey: "i2", opcode: "add-pageoff", relocationPairKey: "page:g" },
        { id: 3, stableKey: "i3", opcode: "cmp", definesNzcv: true },
        { id: 4, stableKey: "i4", opcode: "b.cond", usesNzcv: true },
        { id: 5, stableKey: "i5", opcode: "dmb-ish", barrier: true },
        { id: 6, stableKey: "i6", opcode: "ldr", secretRegionKey: "ct:1" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  test("call and device ordering boundaries prevent load-latency motion across them", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "call", opcode: "bl", callBoundary: true },
        { id: 2, stableKey: "after-load", opcode: "ldr", memoryKey: "frame:8" },
        {
          id: 3,
          stableKey: "mmio-load",
          opcode: "ldr",
          memoryKey: "mmio:status",
          memoryOrdering: "device",
        },
        { id: 4, stableKey: "after-alu", opcode: "add" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "call",
      "after-load",
      "mmio-load",
      "after-alu",
    ]);
  });

  test("FP status and vector-state dependencies preserve relative order", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        { id: 1, stableKey: "fpcr-write", opcode: "msr", definesFpcr: true },
        { id: 2, stableKey: "load", opcode: "ldr", memoryKey: "frame:8" },
        { id: 3, stableKey: "fpcr-read", opcode: "mrs", usesFpcr: true },
        { id: 4, stableKey: "vector-own", opcode: "fmla", vectorStateKey: "q0" },
        { id: 5, stableKey: "vector-use", opcode: "st1", vectorStateKey: "q0" },
      ],
      preferLoadLatencyHiding: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "load",
      "fpcr-write",
      "fpcr-read",
      "vector-own",
      "vector-use",
    ]);
  });

  test("peephole finalization preserves both load destination definitions", () => {
    const result = scheduleAArch64PostAllocation({
      instructions: [
        {
          id: 1,
          stableKey: "load:a",
          opcode: "ldr",
          memoryKey: "sp:0",
          definedRegisters: ["x0"],
          usedRegisters: ["sp"],
        },
        {
          id: 2,
          stableKey: "load:b",
          opcode: "ldr",
          memoryKey: "sp:8",
          definedRegisters: ["x1"],
          usedRegisters: ["sp"],
        },
      ],
      enablePeepholes: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected schedule");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "load:a",
      "load:b",
    ]);
    expect(
      result.value.instructions.flatMap((instruction) => instruction.definedRegisters ?? []),
    ).toEqual(["x0", "x1"]);
    expect(result.value.peepholes).toEqual([]);
  });
});

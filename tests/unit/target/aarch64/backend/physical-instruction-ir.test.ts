import { describe, expect, test } from "bun:test";

import { buildAArch64PhysicalInstructionIr } from "../../../../../src/target/aarch64/backend/finalization/physical-instruction-ir";
import { expandAArch64BackendPseudos } from "../../../../../src/target/aarch64/backend/finalization/pseudo-expansion";

describe("AArch64 physical instruction IR and pseudo expansion", () => {
  test("rejects unresolved virtual registers", () => {
    const result = buildAArch64PhysicalInstructionIr({
      instructions: [{ stableKey: "i0", opcode: "add", operands: [{ kind: "vreg", vreg: 3 }] }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected physical IR error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "physical-ir:unresolved-virtual-register:instruction:i0:vreg:3",
    ]);
  });

  test("preserves input instruction order instead of sorting stable keys", () => {
    const result = buildAArch64PhysicalInstructionIr({
      instructions: [
        { stableKey: "insn:f:10", opcode: "nop", operands: [] },
        { stableKey: "insn:f:2", opcode: "nop", operands: [] },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected physical IR");
    expect(result.value.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "insn:f:10",
      "insn:f:2",
    ]);
  });

  test("lowers frame loads, moves, zeroes, barriers, traps, and relocation ownership", () => {
    const result = expandAArch64BackendPseudos({
      frameSlots: [{ frameObjectId: 1, base: "sp", offsetBytes: 32 }],
      pseudos: [
        { stableKey: "p1", kind: "load-frame", frameObjectId: 1, destination: "x0" },
        { stableKey: "p2", kind: "move", source: "x0", destination: "x1" },
        { stableKey: "p3", kind: "zero", destination: "x2" },
        { stableKey: "p4", kind: "barrier" },
        { stableKey: "p5", kind: "trap" },
        { stableKey: "p6", kind: "remat", register: "x3", value: 7n },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected expansion");
    expect(result.value.instructions.map((instruction) => instruction.opcode)).toEqual([
      "ldr-unsigned-immediate",
      "add-immediate",
      "movz",
      "dmb",
      "trap",
      "movz",
    ]);
    expect(result.value.instructions[0]?.operands).toContainEqual({
      kind: "memory",
      base: "sp",
      offsetBytes: 32,
    });
    expect(result.value.instructions[5]?.operands).toEqual([
      { kind: "register", register: "x3" },
      { kind: "immediate", value: 7 },
    ]);
  });

  test("rejects frame-object pseudos without a concrete frame slot", () => {
    const result = expandAArch64BackendPseudos({
      frameSlots: [],
      pseudos: [{ stableKey: "p1", kind: "load-frame", frameObjectId: 99, destination: "x0" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing frame slot error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "pseudo-expansion:frame-slot-missing:p1:frame-object:99",
    ]);
  });

  test("rejects remat pseudos without a concrete register and value", () => {
    const result = expandAArch64BackendPseudos({
      pseudos: [
        { stableKey: "p1", kind: "remat", value: 1n },
        { stableKey: "p2", kind: "remat", register: "x0" },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected invalid remat pseudos");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "pseudo-expansion:register-missing:p1:remat",
      "pseudo-expansion:value-missing-or-unencodable:p2:remat",
    ]);
  });
});

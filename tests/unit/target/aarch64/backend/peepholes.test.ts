import { describe, expect, test } from "bun:test";

import { formAArch64PairLoadPeepholes } from "../../../../../src/target/aarch64/backend/finalization/peepholes";
import type { AArch64SchedulableInstruction } from "../../../../../src/target/aarch64/backend/finalization/post-ra-scheduler";

describe("AArch64 finalization peepholes", () => {
  test("keeps independent loads unchanged because pair destinations are not explicitly modeled", () => {
    const instructions = [
      load({ id: 1, stableKey: "load:a", register: "x8", memoryKey: "sp:16" }),
      load({ id: 2, stableKey: "load:b", register: "x9", memoryKey: "sp:24" }),
    ];

    const result = formAArch64PairLoadPeepholes(instructions);

    expect(result.instructions).toEqual(instructions);
    expect(
      result.instructions.flatMap((instruction) => instruction.definedRegisters ?? []),
    ).toEqual(["x8", "x9"]);
    expect(result.peepholes).toEqual([]);
  });

  test("does not invent a pair for mismatched width, base, or non-adjacent offsets", () => {
    const cases: readonly (readonly AArch64SchedulableInstruction[])[] = [
      [
        load({ id: 1, stableKey: "load:x", opcode: "ldr", register: "x8", memoryKey: "sp:16" }),
        load({ id: 2, stableKey: "load:w", opcode: "ldr-w", register: "w9", memoryKey: "sp:24" }),
      ],
      [
        load({ id: 3, stableKey: "load:sp", register: "x8", memoryKey: "sp:16" }),
        load({ id: 4, stableKey: "load:fp", register: "x9", memoryKey: "x29:24" }),
      ],
      [
        load({ id: 5, stableKey: "load:16", register: "x8", memoryKey: "sp:16" }),
        load({ id: 6, stableKey: "load:40", register: "x9", memoryKey: "sp:40" }),
      ],
    ];

    for (const instructions of cases) {
      const result = formAArch64PairLoadPeepholes(instructions);

      expect(result.instructions).toEqual(instructions);
      expect(result.peepholes).toEqual([]);
    }
  });

  test("does not create duplicate stable keys or duplicate output registers", () => {
    const instructions = [
      load({ id: 1, stableKey: "load:a", register: "x8", memoryKey: "sp:0" }),
      load({ id: 2, stableKey: "load:b", register: "x8", memoryKey: "sp:8" }),
    ];

    const result = formAArch64PairLoadPeepholes(instructions);

    expect(new Set(result.instructions.map((instruction) => instruction.stableKey)).size).toBe(2);
    expect(
      result.instructions.flatMap((instruction) => instruction.definedRegisters ?? []),
    ).toEqual(["x8", "x8"]);
    expect(result.peepholes).toEqual([]);
  });
});

function load(input: {
  readonly id: number;
  readonly stableKey: string;
  readonly register: string;
  readonly memoryKey: string;
  readonly opcode?: string;
}): AArch64SchedulableInstruction {
  return {
    id: input.id,
    stableKey: input.stableKey,
    opcode: input.opcode ?? "ldr",
    memoryKey: input.memoryKey,
    definedRegisters: [input.register],
    usedRegisters: ["sp"],
  };
}

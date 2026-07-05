import { describe, expect, test } from "bun:test";

import {
  exitPreludeInstructionsForAArch64Frame,
  prologueInstructionsForAArch64Frame,
  stackAdjustInstructions,
} from "../../../../../src/target/aarch64/backend/api/frame-instructions";
import {
  layoutAArch64StackFrame,
  type AArch64StackFrameLayout,
} from "../../../../../src/target/aarch64/backend/frame/frame-layout";

describe("AArch64 frame instructions", () => {
  test("splits large stack adjustments into encodable chunks", () => {
    const result = layoutAArch64StackFrame({
      functionKey: "large",
      localSlots: [{ slotKey: "large-local", sizeBytes: 5000, alignmentBytes: 16 }],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected large frame layout");
    const frame = result.value;

    const prologue = prologueInstructionsForAArch64Frame("large", frame, undefined);
    const epilogue = exitPreludeInstructionsForAArch64Frame("large", frame, undefined, "return");

    const prologueAdjustments = prologue.filter(
      (instruction) => instruction.opcode === "sub-immediate",
    );
    const epilogueAdjustments = epilogue.filter(
      (instruction) => instruction.opcode === "add-immediate",
    );

    expect(stackAdjustInstructions(5008)).toEqual([4080, 928]);
    expect(prologueAdjustments).toHaveLength(2);
    expect(epilogueAdjustments).toHaveLength(2);
    expect(
      [...prologueAdjustments, ...epilogueAdjustments].map((instruction) =>
        Number(instruction.operands[2]?.kind === "immediate" ? instruction.operands[2].value : -1n),
      ),
    ).toEqual([4080, 928, 928, 4080]);
    expect(
      [...prologueAdjustments, ...epilogueAdjustments].every((instruction) => {
        const immediate = instruction.operands[2];
        return immediate?.kind === "immediate" && immediate.value >= 0n && immediate.value <= 4095n;
      }),
    ).toBe(true);
    expect(prologueAdjustments.map((instruction) => instruction.stableKey)).toEqual([
      "large:prologue:sub:sp:0",
      "large:prologue:sub:sp:1",
    ]);
    expect(epilogueAdjustments.map((instruction) => instruction.stableKey)).toEqual([
      "large:epilogue:add:sp:0",
      "large:epilogue:add:sp:1",
    ]);
  });

  test("keeps single stack adjustment stable keys unchanged", () => {
    const frame = stackFrameWithSavedRegisters();

    const prologue = prologueInstructionsForAArch64Frame("main", frame, undefined);
    const epilogue = exitPreludeInstructionsForAArch64Frame("main", frame, undefined, "return");

    expect(prologue[0]?.stableKey).toBe("main:prologue:sub:sp");
    expect(epilogue.at(-1)?.stableKey).toBe("main:epilogue:add:sp");
  });

  test("pairs adjacent GPR callee-save slots while keeping FP/SIMD saves single", () => {
    const frame = stackFrameWithSavedRegisters();

    const prologue = prologueInstructionsForAArch64Frame("main", frame, undefined);
    const epilogue = exitPreludeInstructionsForAArch64Frame("main", frame, undefined, "return");

    expect(prologue.map((instruction) => instruction.opcode)).toEqual([
      "sub-immediate",
      "stp-signed-offset",
      "str-unsigned-immediate",
    ]);
    expect(prologue[1]).toMatchObject({
      stableKey: "main:prologue:save-pair:x20:x19",
      operands: [
        { kind: "register", register: "x20" },
        { kind: "register", register: "x19" },
        { kind: "memory-base", register: "sp" },
        { kind: "immediate", value: 0n },
      ],
    });
    expect(prologue[2]).toMatchObject({
      stableKey: "main:prologue:save:d8",
      operands: [
        { kind: "register", register: "d8" },
        { kind: "memory-base", register: "sp" },
        { kind: "immediate", value: 16n },
      ],
    });

    expect(epilogue.map((instruction) => instruction.opcode)).toEqual([
      "ldp-signed-offset",
      "ldr-unsigned-immediate",
      "add-immediate",
    ]);
    expect(epilogue[0]).toMatchObject({
      stableKey: "main:epilogue:restore-pair:x20:x19",
      operands: [
        { kind: "register", register: "x20" },
        { kind: "register", register: "x19" },
        { kind: "memory-base", register: "sp" },
        { kind: "immediate", value: 0n },
      ],
    });
    expect(epilogue[1]).toMatchObject({
      stableKey: "main:epilogue:restore:d8",
      operands: [
        { kind: "register", register: "d8" },
        { kind: "memory-base", register: "sp" },
        { kind: "immediate", value: 16n },
      ],
    });
  });
});

function stackFrameWithSavedRegisters(): AArch64StackFrameLayout {
  return {
    functionKey: "main",
    totalSizeBytes: 32,
    slots: [
      {
        slotKey: "save:x20",
        offsetBytes: -32,
        sizeBytes: 8,
        alignmentBytes: 8,
        role: "callee-save",
      },
      {
        slotKey: "save:x19",
        offsetBytes: -24,
        sizeBytes: 8,
        alignmentBytes: 8,
        role: "callee-save",
      },
      {
        slotKey: "save:d8",
        offsetBytes: -16,
        sizeBytes: 8,
        alignmentBytes: 8,
        role: "callee-save",
      },
    ],
    wipeSlots: [],
    savedRegisters: ["d8", "x19", "x20"],
    outgoingArgSizeBytes: 0,
    requiresFrameRecord: false,
  };
}

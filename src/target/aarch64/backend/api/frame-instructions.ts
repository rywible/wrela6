import type { AArch64FrameSlot, AArch64StackFrameLayout } from "../frame/frame-layout";
import type { AArch64LayoutPhysicalInstruction } from "../object/layout-encode-fixed-point";

export function prologueInstructionsForAArch64Frame(
  functionKey: string,
  frame: AArch64StackFrameLayout,
  zeroScratchRegister: string | undefined,
): readonly AArch64LayoutPhysicalInstruction[] {
  const instructions: AArch64LayoutPhysicalInstruction[] = [];
  if (frame.totalSizeBytes > 0) {
    instructions.push(stackAdjustInstruction(functionKey, "prologue", "sub-immediate", frame));
  }
  for (const register of frame.savedRegisters) {
    const slot = frame.slots.find((candidate) => candidate.slotKey === `save:${register}`);
    if (slot === undefined) continue;
    instructions.push(
      frameLoadStoreInstruction({
        stableKey: `${functionKey}:prologue:save:${register}`,
        opcode: "str-unsigned-immediate",
        register,
        frame,
        slot,
        provenanceSource: `${functionKey}:prologue`,
      }),
    );
  }
  instructions.push(
    ...wipeSlotInstructions({
      functionKey,
      phase: "prologue:init",
      frame,
      zeroScratchRegister,
    }),
  );
  return Object.freeze(instructions);
}

export function epilogueInstructionsForAArch64Frame(
  functionKey: string,
  frame: AArch64StackFrameLayout,
  zeroScratchRegister: string | undefined,
): readonly AArch64LayoutPhysicalInstruction[] {
  if (
    frame.totalSizeBytes === 0 &&
    frame.savedRegisters.length === 0 &&
    frame.wipeSlots.length === 0
  ) {
    return Object.freeze([]);
  }
  const instructions: AArch64LayoutPhysicalInstruction[] = [
    ...exitPreludeInstructionsForAArch64Frame(functionKey, frame, zeroScratchRegister, "return"),
  ];
  instructions.push({
    stableKey: `${functionKey}:epilogue:return`,
    opcode: "ret",
    operands: [],
    provenanceSource: `${functionKey}:epilogue`,
  });
  return Object.freeze(instructions);
}

export function exitPreludeInstructionsForAArch64Frame(
  functionKey: string,
  frame: AArch64StackFrameLayout,
  zeroScratchRegister: string | undefined,
  exitKind: "return" | "tail-call" | "trap" | "noreturn",
): readonly AArch64LayoutPhysicalInstruction[] {
  const instructions: AArch64LayoutPhysicalInstruction[] = [
    ...wipeSlotInstructions({
      functionKey,
      phase: "epilogue:wipe",
      frame,
      zeroScratchRegister,
    }),
  ];
  if (exitKind === "trap" || exitKind === "noreturn") return Object.freeze(instructions);

  for (const register of [...frame.savedRegisters].reverse()) {
    const slot = frame.slots.find((candidate) => candidate.slotKey === `save:${register}`);
    if (slot === undefined) continue;
    instructions.push(
      frameLoadStoreInstruction({
        stableKey: `${functionKey}:epilogue:restore:${register}`,
        opcode: "ldr-unsigned-immediate",
        register,
        frame,
        slot,
        provenanceSource: `${functionKey}:epilogue`,
      }),
    );
  }
  if (frame.totalSizeBytes > 0) {
    instructions.push(stackAdjustInstruction(functionKey, "epilogue", "add-immediate", frame));
  }
  return Object.freeze(instructions);
}

function stackAdjustInstruction(
  functionKey: string,
  phase: "prologue" | "epilogue",
  opcode: "sub-immediate" | "add-immediate",
  frame: AArch64StackFrameLayout,
): AArch64LayoutPhysicalInstruction {
  return {
    stableKey: `${functionKey}:${phase}:${opcode === "sub-immediate" ? "sub" : "add"}:sp`,
    opcode,
    operands: [
      { kind: "register", register: "sp" },
      { kind: "register", register: "sp" },
      { kind: "immediate", value: BigInt(frame.totalSizeBytes) },
    ],
    provenanceSource: `${functionKey}:${phase}`,
  };
}

function frameLoadStoreInstruction(input: {
  readonly stableKey: string;
  readonly opcode: "ldr-unsigned-immediate" | "str-unsigned-immediate";
  readonly register: string;
  readonly frame: AArch64StackFrameLayout;
  readonly slot: AArch64FrameSlot;
  readonly provenanceSource: string;
}): AArch64LayoutPhysicalInstruction {
  return {
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: [
      { kind: "register", register: input.register },
      { kind: "memory-base", register: "sp" },
      { kind: "immediate", value: BigInt(stackAccessOffsetBytes(input.frame, input.slot)) },
    ],
    accessWidthBytes: 8,
    provenanceSource: input.provenanceSource,
  };
}

function wipeSlotInstructions(input: {
  readonly functionKey: string;
  readonly phase: "prologue:init" | "epilogue:wipe";
  readonly frame: AArch64StackFrameLayout;
  readonly zeroScratchRegister: string | undefined;
}): readonly AArch64LayoutPhysicalInstruction[] {
  if (input.frame.wipeSlots.length === 0 || input.zeroScratchRegister === undefined) {
    return Object.freeze([]);
  }
  const instructions: AArch64LayoutPhysicalInstruction[] = [
    {
      stableKey: `${input.functionKey}:${input.phase}:zero`,
      opcode: "movz",
      operands: [
        { kind: "register", register: input.zeroScratchRegister },
        { kind: "immediate", value: 0n },
      ],
      provenanceSource: `${input.functionKey}:${input.phase}`,
    },
  ];
  for (const slot of input.frame.wipeSlots) {
    for (const offset of wipeStoreOffsets(input.frame, slot)) {
      instructions.push({
        stableKey: `${input.functionKey}:${input.phase}:${slot.slotKey}:offset:${offset}`,
        opcode: "str-unsigned-immediate",
        operands: [
          { kind: "register", register: input.zeroScratchRegister },
          { kind: "memory-base", register: "sp" },
          { kind: "immediate", value: BigInt(offset) },
        ],
        accessWidthBytes: 8,
        provenanceSource: `${input.functionKey}:${input.phase}`,
      });
    }
  }
  return Object.freeze(instructions);
}

function wipeStoreOffsets(
  frame: AArch64StackFrameLayout,
  slot: AArch64FrameSlot,
): readonly number[] {
  const firstOffset = stackAccessOffsetBytes(frame, slot);
  const storeCount = Math.max(1, Math.ceil(slot.sizeBytes / 8));
  return Object.freeze(
    Array.from({ length: storeCount }, (_unused, index) => firstOffset + index * 8),
  );
}

function stackAccessOffsetBytes(frame: AArch64StackFrameLayout, slot: AArch64FrameSlot): number {
  return frame.totalSizeBytes + slot.offsetBytes;
}

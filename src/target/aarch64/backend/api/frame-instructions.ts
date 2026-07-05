import type { AArch64FrameSlot, AArch64StackFrameLayout } from "../frame/frame-layout";
import type { AArch64LayoutPhysicalInstruction } from "../object/layout-encode-fixed-point";

const MAX_STACK_ADJUST_IMMEDIATE_BYTES = 4080;

export function prologueInstructionsForAArch64Frame(
  functionKey: string,
  frame: AArch64StackFrameLayout,
  zeroScratchRegister: string | undefined,
): readonly AArch64LayoutPhysicalInstruction[] {
  const instructions: AArch64LayoutPhysicalInstruction[] = [];
  if (frame.totalSizeBytes > 0) {
    instructions.push(
      ...stackAdjustPhysicalInstructions(functionKey, "prologue", "sub-immediate", frame),
    );
  }
  instructions.push(
    ...frameSaveRestoreInstructions({
      functionKey,
      frame,
      phase: "prologue",
      singleOpcode: "str-unsigned-immediate",
      pairOpcode: "stp-signed-offset",
      stableRole: "save",
    }),
  );
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

  instructions.push(
    ...frameSaveRestoreInstructions({
      functionKey,
      frame,
      phase: "epilogue",
      singleOpcode: "ldr-unsigned-immediate",
      pairOpcode: "ldp-signed-offset",
      stableRole: "restore",
    }),
  );
  if (frame.totalSizeBytes > 0) {
    const adjustments = stackAdjustPhysicalInstructions(
      functionKey,
      "epilogue",
      "add-immediate",
      frame,
    )
      .slice()
      .reverse();
    instructions.push(
      ...(adjustments.length === 1
        ? adjustments
        : adjustments.map((instruction, index) => ({
            ...instruction,
            stableKey: `${functionKey}:epilogue:add:sp:${index}`,
          }))),
    );
  }
  return Object.freeze(instructions);
}

export function stackAdjustInstructions(totalSizeBytes: number): readonly number[] {
  if (totalSizeBytes <= 0) return Object.freeze([]);
  const chunks: number[] = [];
  let remaining = totalSizeBytes;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_STACK_ADJUST_IMMEDIATE_BYTES);
    chunks.push(chunk);
    remaining -= chunk;
  }
  return Object.freeze(chunks);
}

function stackAdjustPhysicalInstructions(
  functionKey: string,
  phase: "prologue" | "epilogue",
  opcode: "sub-immediate" | "add-immediate",
  frame: AArch64StackFrameLayout,
): readonly AArch64LayoutPhysicalInstruction[] {
  const chunks = stackAdjustInstructions(frame.totalSizeBytes);
  return Object.freeze(
    chunks.map((sizeBytes, index): AArch64LayoutPhysicalInstruction => {
      const operation = opcode === "sub-immediate" ? "sub" : "add";
      return {
        stableKey:
          chunks.length === 1
            ? `${functionKey}:${phase}:${operation}:sp`
            : `${functionKey}:${phase}:${operation}:sp:${index}`,
        opcode,
        operands: [
          { kind: "register", register: "sp" },
          { kind: "register", register: "sp" },
          { kind: "immediate", value: BigInt(sizeBytes) },
        ],
        provenanceSource: `${functionKey}:${phase}`,
      };
    }),
  );
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

function frameSaveRestoreInstructions(input: {
  readonly functionKey: string;
  readonly frame: AArch64StackFrameLayout;
  readonly phase: "prologue" | "epilogue";
  readonly singleOpcode: "ldr-unsigned-immediate" | "str-unsigned-immediate";
  readonly pairOpcode: "ldp-signed-offset" | "stp-signed-offset";
  readonly stableRole: "restore" | "save";
}): readonly AArch64LayoutPhysicalInstruction[] {
  const accesses = savedRegisterAccesses(input.frame);
  const instructions: AArch64LayoutPhysicalInstruction[] = [];
  for (let index = 0; index < accesses.length; index += 1) {
    const first = accesses[index];
    const second = accesses[index + 1];
    if (first !== undefined && second !== undefined && canPairSavedRegisterAccess(first, second)) {
      instructions.push(
        framePairLoadStoreInstruction({
          stableKey: `${input.functionKey}:${input.phase}:${input.stableRole}-pair:${first.register}:${second.register}`,
          opcode: input.pairOpcode,
          firstRegister: first.register,
          secondRegister: second.register,
          offsetBytes: first.offsetBytes,
          provenanceSource: `${input.functionKey}:${input.phase}`,
        }),
      );
      index += 1;
      continue;
    }
    if (first === undefined) continue;
    instructions.push(
      frameLoadStoreInstruction({
        stableKey: `${input.functionKey}:${input.phase}:${input.stableRole}:${first.register}`,
        opcode: input.singleOpcode,
        register: first.register,
        frame: input.frame,
        slot: first.slot,
        provenanceSource: `${input.functionKey}:${input.phase}`,
      }),
    );
  }
  return Object.freeze(instructions);
}

interface SavedRegisterAccess {
  readonly register: string;
  readonly slot: AArch64FrameSlot;
  readonly offsetBytes: number;
}

function savedRegisterAccesses(frame: AArch64StackFrameLayout): readonly SavedRegisterAccess[] {
  return Object.freeze(
    frame.savedRegisters
      .flatMap((register): readonly SavedRegisterAccess[] => {
        const slot = frame.slots.find((candidate) => candidate.slotKey === `save:${register}`);
        if (slot === undefined) return [];
        return [
          Object.freeze({
            register,
            slot,
            offsetBytes: stackAccessOffsetBytes(frame, slot),
          }),
        ];
      })
      .sort((left, right) => left.offsetBytes - right.offsetBytes),
  );
}

function canPairSavedRegisterAccess(
  first: SavedRegisterAccess,
  second: SavedRegisterAccess,
): boolean {
  return (
    isGpr64Register(first.register) &&
    isGpr64Register(second.register) &&
    second.offsetBytes === first.offsetBytes + 8 &&
    first.offsetBytes % 8 === 0 &&
    first.offsetBytes >= -512 &&
    first.offsetBytes <= 504
  );
}

function isGpr64Register(register: string): boolean {
  return /^x\d+$/.test(register);
}

function framePairLoadStoreInstruction(input: {
  readonly stableKey: string;
  readonly opcode: "ldp-signed-offset" | "stp-signed-offset";
  readonly firstRegister: string;
  readonly secondRegister: string;
  readonly offsetBytes: number;
  readonly provenanceSource: string;
}): AArch64LayoutPhysicalInstruction {
  return {
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: [
      { kind: "register", register: input.firstRegister },
      { kind: "register", register: input.secondRegister },
      { kind: "memory-base", register: "sp" },
      { kind: "immediate", value: BigInt(input.offsetBytes) },
    ],
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

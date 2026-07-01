import type { AArch64MachineBlockId } from "./ids";
import type { AArch64MachineInstruction } from "./machine-instruction";
import type { AArch64VirtualRegister } from "./virtual-register";

export interface AArch64BlockFrequency {
  readonly kind: "entry" | "hot" | "warm" | "cold" | "terminalCold";
}

export interface AArch64MachineBlock {
  readonly blockId: AArch64MachineBlockId;
  readonly parameters: readonly AArch64VirtualRegister[];
  readonly frequency: AArch64BlockFrequency;
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly terminator?: AArch64MachineInstruction;
}

export function aarch64MachineBlock(input: {
  readonly blockId: AArch64MachineBlockId;
  readonly parameters?: readonly AArch64VirtualRegister[];
  readonly frequency?: AArch64BlockFrequency;
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly terminator?: AArch64MachineInstruction;
}): AArch64MachineBlock {
  const frequency: AArch64BlockFrequency = input.frequency ?? { kind: "warm" };
  return Object.freeze({
    blockId: input.blockId,
    parameters: Object.freeze([...(input.parameters ?? [])]),
    frequency: Object.freeze(frequency),
    instructions: Object.freeze([...input.instructions]),
    ...(input.terminator === undefined ? {} : { terminator: input.terminator }),
  });
}

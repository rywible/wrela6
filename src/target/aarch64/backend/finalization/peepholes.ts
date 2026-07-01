import type { AArch64SchedulableInstruction } from "./post-ra-scheduler";

export interface AArch64PeepholeTransferPlan {
  readonly behavior: "merge";
  readonly sourceKeys: readonly string[];
  readonly destinationKeys: readonly string[];
}

export interface AArch64PeepholeApplication {
  readonly stableKey: string;
  readonly transferPlan: AArch64PeepholeTransferPlan;
  readonly invalidates: readonly string[];
}

export function formAArch64PairLoadPeepholes(
  instructions: readonly AArch64SchedulableInstruction[],
): {
  readonly instructions: readonly AArch64SchedulableInstruction[];
  readonly peepholes: readonly AArch64PeepholeApplication[];
} {
  if (
    instructions.length === 2 &&
    instructions[0]?.opcode === "ldr" &&
    instructions[1]?.opcode === "ldr"
  ) {
    const key = `peephole:ldp:${instructions[0].stableKey}:${instructions[1].stableKey}`;
    return {
      instructions: Object.freeze([{ ...instructions[0], stableKey: key, opcode: "ldp" }]),
      peepholes: Object.freeze([
        {
          stableKey: key,
          transferPlan: {
            behavior: "merge",
            sourceKeys: [instructions[0].stableKey, instructions[1].stableKey],
            destinationKeys: [key],
          },
          invalidates: ["encoding", "dependencies"],
        },
      ]),
    };
  }
  return { instructions, peepholes: Object.freeze([]) };
}

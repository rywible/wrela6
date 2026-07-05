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
  return { instructions, peepholes: Object.freeze([]) };
}

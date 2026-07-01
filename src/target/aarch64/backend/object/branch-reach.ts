export const AARCH64_INSTRUCTION_SIZE_BYTES = 4;
export const AARCH64_BRANCH26_REACH_BYTES = 128 * 1024 * 1024;
export const AARCH64_BRANCH19_REACH_BYTES = 1024 * 1024;
export const AARCH64_BRANCH14_REACH_BYTES = 32 * 1024;

export type AArch64ReachBranchKind = "b" | "bl" | "b-cond" | "cbz" | "cbnz" | "tbz" | "tbnz";

export function aarch64BranchReachBytes(kind: AArch64ReachBranchKind): number {
  if (kind === "b" || kind === "bl") return AARCH64_BRANCH26_REACH_BYTES;
  if (kind === "tbz" || kind === "tbnz") return AARCH64_BRANCH14_REACH_BYTES;
  return AARCH64_BRANCH19_REACH_BYTES;
}

export function aarch64RelocationReachBytes(family: string): number | undefined {
  if (family === "branch26") return AARCH64_BRANCH26_REACH_BYTES;
  if (family === "branch19") return AARCH64_BRANCH19_REACH_BYTES;
  if (family === "branch14") return AARCH64_BRANCH14_REACH_BYTES;
  return undefined;
}

export function isWithinAArch64SignedScaledBranchReach(
  distanceBytes: number,
  reachBytes: number,
): boolean {
  return (
    distanceBytes >= -reachBytes && distanceBytes <= reachBytes - AARCH64_INSTRUCTION_SIZE_BYTES
  );
}

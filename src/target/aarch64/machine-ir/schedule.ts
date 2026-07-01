export type AArch64IssueClass =
  | "integer"
  | "load"
  | "store"
  | "branch"
  | "barrier"
  | "vector"
  | "fp";

export type AArch64LatencyClass = "zeroCycle" | "singleCycle" | "multiCycle" | "memory";

export interface AArch64ScheduleMetadata {
  readonly issueClass: AArch64IssueClass;
  readonly latencyClass: AArch64LatencyClass;
  readonly motion: { readonly kind: "insideEffectIsland" | "hardBoundary" | "pinned" };
  readonly pairability: readonly string[];
  readonly pressure: { readonly gpr: number; readonly vector: number };
  readonly errataConstraints: readonly string[];
}

export function aarch64ScheduleMetadata(input: AArch64ScheduleMetadata): AArch64ScheduleMetadata {
  if (input.pressure.gpr < 0 || input.pressure.vector < 0) {
    throw new RangeError("schedule pressure estimates must be non-negative.");
  }
  return Object.freeze({
    issueClass: input.issueClass,
    latencyClass: input.latencyClass,
    motion: Object.freeze({ ...input.motion }),
    pairability: Object.freeze([...input.pairability]),
    pressure: Object.freeze({ ...input.pressure }),
    errataConstraints: Object.freeze([...input.errataConstraints]),
  });
}

export function defaultAArch64ScheduleMetadata(
  issueClass: AArch64IssueClass,
): AArch64ScheduleMetadata {
  return aarch64ScheduleMetadata({
    issueClass,
    latencyClass: "singleCycle",
    motion: { kind: "insideEffectIsland" },
    pairability: [],
    pressure: { gpr: 0, vector: 0 },
    errataConstraints: [],
  });
}

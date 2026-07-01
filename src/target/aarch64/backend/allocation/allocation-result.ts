import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";

export type AArch64BackendRegisterClass = "gpr64" | "gpr32" | "vector128" | "vector64" | "fp";

export interface AArch64AllocationProgressTuple {
  readonly unprocessedIntervals: number;
  readonly unsplitIntervals: number;
  readonly remainingCutPoints: number;
  readonly unresolvedRepairRequests: number;
  readonly frozenEpisodeCount: number;
}

export interface AArch64PhysicalRegisterAlias {
  readonly left: string;
  readonly right: string;
}

export interface AArch64AllocationSegment {
  readonly liveRangeKey: string;
  readonly vreg: number;
  readonly physical: string;
  readonly startOrder: number;
  readonly endOrder: number;
  readonly reason: string;
}

export interface AArch64AllocationRepairRequest {
  readonly liveRangeKey: string;
  readonly kind: "split" | "rematerialize" | "spill";
  readonly stableDetail: string;
}

export interface AArch64AllocationResult {
  readonly segments: readonly AArch64AllocationSegment[];
  readonly repairRequests: readonly AArch64AllocationRepairRequest[];
  readonly progress: AArch64AllocationProgressTuple;
  readonly segmentsFor: (vreg: number) => readonly AArch64AllocationSegment[];
}

export interface AArch64AllocatorInterval {
  readonly liveRangeKey: string;
  readonly vreg: number;
  readonly registerClass: AArch64BackendRegisterClass;
  readonly startOrder: number;
  readonly endOrder: number;
  readonly cutPoints?: readonly number[];
  readonly physicalInterferences?: readonly string[];
  readonly requiredPhysicalRegister?: string;
  readonly noSpill?: boolean;
  readonly mustAllocateBeforeUse?: boolean;
  readonly loopDepth?: number;
  readonly spillCost?: number;
  readonly useDensity?: number;
}

export function allocationResult(input: {
  readonly segments: readonly AArch64AllocationSegment[];
  readonly repairRequests?: readonly AArch64AllocationRepairRequest[];
  readonly progress?: AArch64AllocationProgressTuple;
}): AArch64AllocationResult {
  const sortedSegments = Object.freeze(
    [...input.segments].sort((left, right) =>
      left.vreg === right.vreg
        ? left.startOrder - right.startOrder ||
          compareCodeUnitStrings(left.physical, right.physical)
        : left.vreg - right.vreg,
    ),
  );
  return Object.freeze({
    segments: sortedSegments,
    repairRequests: Object.freeze([...(input.repairRequests ?? [])]),
    progress:
      input.progress ??
      Object.freeze({
        unprocessedIntervals: 0,
        unsplitIntervals: 0,
        remainingCutPoints: 0,
        unresolvedRepairRequests: input.repairRequests?.length ?? 0,
        frozenEpisodeCount: 0,
      }),
    segmentsFor(vreg: number) {
      return sortedSegments.filter((segment) => segment.vreg === vreg);
    },
  });
}

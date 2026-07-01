import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  allocationResult,
  type AArch64AllocationSegment,
  type AArch64AllocationRepairRequest,
  type AArch64AllocationResult,
  type AArch64AllocatorInterval,
  type AArch64PhysicalRegisterAlias,
} from "./allocation-result";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";
import {
  aarch64ExpandUnavailableRegisters,
  aarch64PhysicalAliasMap,
  aarch64RegisterAliasesAny,
  aarch64RegistersAlias,
} from "../api/physical-register-helpers";

export type AllocateAArch64RegistersResult =
  | {
      readonly kind: "ok";
      readonly allocation: AArch64AllocationResult;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function allocateAArch64Registers(input: {
  readonly intervals: readonly AArch64AllocatorInterval[];
  readonly availableGprs?: readonly string[];
  readonly availableVectorRegisters?: readonly string[];
  readonly availableFpRegisters?: readonly string[];
  readonly unavailableRegisters?: readonly string[];
  readonly aliases?: readonly AArch64PhysicalRegisterAlias[];
}): AllocateAArch64RegistersResult {
  const aliasMap = aarch64PhysicalAliasMap(input.aliases ?? []);
  const unavailable = aarch64ExpandUnavailableRegisters(
    [...(input.unavailableRegisters ?? []), "x18", "sp", "xzr", "wzr"],
    aliasMap,
  );
  const gprs = (input.availableGprs ?? ["x0", "x1", "x2", "x3", "x9", "x10", "x19", "x20"]).filter(
    (register) => !aarch64RegisterAliasesAny(register, unavailable, aliasMap),
  );
  const vectors = (input.availableVectorRegisters ?? ["v0", "v1", "v2", "v3", "v4", "v5"]).filter(
    (register) => !aarch64RegisterAliasesAny(register, unavailable, aliasMap),
  );
  const fps = (input.availableFpRegisters ?? ["d0", "d1", "d2", "d3", "d4", "d5"]).filter(
    (register) => !aarch64RegisterAliasesAny(register, unavailable, aliasMap),
  );
  const pending = [...input.intervals].sort(compareIntervals);
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const segments: AArch64AllocationSegment[] = [];
  const repairRequests: AArch64AllocationRepairRequest[] = [];
  let splitRepairCount = 0;
  while (pending.length > 0) {
    const interval = pending.shift();
    if (interval === undefined) continue;
    const physicalPool = physicalPoolForRegisterClass(interval.registerClass, {
      gprs,
      vectors,
      fps,
    });
    const candidatePhysicalRegisters =
      interval.requiredPhysicalRegister === undefined
        ? physicalPool
        : physicalPool.includes(interval.requiredPhysicalRegister)
          ? Object.freeze([interval.requiredPhysicalRegister])
          : Object.freeze([]);
    const intervalPhysicalInterferences = aarch64ExpandUnavailableRegisters(
      interval.physicalInterferences ?? [],
      aliasMap,
    );
    const physical = candidatePhysicalRegisters.find(
      (candidate) =>
        !aarch64RegisterAliasesAny(candidate, intervalPhysicalInterferences, aliasMap) &&
        !segments.some(
          (segment) =>
            aarch64RegistersAlias(segment.physical, candidate, aliasMap) &&
            overlaps(segment, interval),
        ),
    );
    if (physical === undefined) {
      const splitCut = legalCutPoints(interval)[0];
      if (splitCut !== undefined) {
        splitRepairCount += 1;
        pending.unshift(...splitIntervalAtCut(interval, splitCut));
      } else if (interval.noSpill === true) {
        diagnostics.push(
          aarch64BackendDiagnostic({
            code: "AARCH64_BACKEND_ALLOCATION_FAILED",
            ownerKey: interval.liveRangeKey,
            rootCauseKey: "no-spill",
            stableDetail: `allocation:no-spill-unallocatable:vreg:${interval.vreg}:class:${interval.registerClass}:blockers:none-available`,
          }),
        );
      } else {
        repairRequests.push({
          liveRangeKey: interval.liveRangeKey,
          kind: "spill",
          stableDetail: `allocation:spill-required:vreg:${interval.vreg}:range:${interval.startOrder}-${interval.endOrder}:class:${interval.registerClass}:blockers:none-available`,
        });
      }
      continue;
    }
    const cuts = legalCutPoints(interval);
    if (cuts.length === 0) {
      segments.push({
        liveRangeKey: interval.liveRangeKey,
        vreg: interval.vreg,
        physical,
        startOrder: interval.startOrder,
        endOrder: interval.endOrder,
        reason: "assigned",
      });
    } else {
      let start = interval.startOrder;
      for (const cut of cuts) {
        segments.push({
          liveRangeKey: interval.liveRangeKey,
          vreg: interval.vreg,
          physical,
          startOrder: start,
          endOrder: cut,
          reason: "pre-call",
        });
        start = cut;
      }
      segments.push({
        liveRangeKey: interval.liveRangeKey,
        vreg: interval.vreg,
        physical,
        startOrder: start,
        endOrder: interval.endOrder,
        reason: "post-call",
      });
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
  }
  return {
    kind: "ok",
    allocation: allocationResult({
      segments,
      repairRequests,
      progress: {
        unprocessedIntervals: 0,
        unsplitIntervals: 0,
        remainingCutPoints: 0,
        unresolvedRepairRequests: repairRequests.length,
        frozenEpisodeCount: splitRepairCount,
      },
    }),
    diagnostics: [],
  };
}

function physicalPoolForRegisterClass(
  registerClass: AArch64AllocatorInterval["registerClass"],
  pools: {
    readonly gprs: readonly string[];
    readonly vectors: readonly string[];
    readonly fps: readonly string[];
  },
): readonly string[] {
  switch (registerClass) {
    case "gpr64":
    case "gpr32":
      return pools.gprs;
    case "vector128":
    case "vector64":
      return pools.vectors;
    case "fp":
      return pools.fps;
  }
}

function legalCutPoints(interval: AArch64AllocatorInterval): readonly number[] {
  return Object.freeze(
    [...(interval.cutPoints ?? [])]
      .filter((cut) => cut > interval.startOrder && cut < interval.endOrder)
      .sort((left, right) => left - right),
  );
}

function splitIntervalAtCut(
  interval: AArch64AllocatorInterval,
  cut: number,
): readonly AArch64AllocatorInterval[] {
  const cutPoints = legalCutPoints(interval);
  return Object.freeze([
    Object.freeze({
      ...interval,
      endOrder: cut,
      cutPoints: cutPoints.filter((candidate) => candidate < cut),
    }),
    Object.freeze({
      ...interval,
      startOrder: cut,
      cutPoints: cutPoints.filter((candidate) => candidate > cut),
    }),
  ]);
}

function compareIntervals(left: AArch64AllocatorInterval, right: AArch64AllocatorInterval): number {
  return (
    Number(right.mustAllocateBeforeUse === true) - Number(left.mustAllocateBeforeUse === true) ||
    (right.loopDepth ?? 0) - (left.loopDepth ?? 0) ||
    (right.spillCost ?? 0) - (left.spillCost ?? 0) ||
    (right.useDensity ?? 0) - (left.useDensity ?? 0) ||
    compareCodeUnitStrings(left.liveRangeKey, right.liveRangeKey) ||
    left.vreg - right.vreg
  );
}

function overlaps(
  segment: { readonly startOrder: number; readonly endOrder: number },
  interval: AArch64AllocatorInterval,
): boolean {
  return segment.startOrder < interval.endOrder && interval.startOrder < segment.endOrder;
}

import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { verifyAArch64SecurityLabelConservation } from "../facts/security-label-conservation";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";
import type {
  AArch64AllocationResult,
  AArch64AllocationSegment,
  AArch64AllocatorInterval,
  AArch64PhysicalRegisterAlias,
} from "../allocation/allocation-result";
import { aarch64PhysicalAliasMap, aarch64RegistersAlias } from "../api/physical-register-helpers";

export type VerifyAArch64AllocationResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly AArch64BackendDiagnostic[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function verifyAArch64Allocation(input: {
  readonly allocation: AArch64AllocationResult;
  readonly intervals?: readonly AArch64AllocatorInterval[];
  readonly noSpillVregs?: readonly number[];
  readonly aliases?: readonly AArch64PhysicalRegisterAlias[];
}): VerifyAArch64AllocationResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const segment of input.allocation.segments) {
    if (segment.physical === "x18") {
      diagnostics.push(
        aarch64BackendDiagnostic({
          code: "AARCH64_BACKEND_ALLOCATION_FAILED",
          ownerKey: segment.liveRangeKey,
          rootCauseKey: "reserved-register",
          stableDetail: `allocation-verifier:reserved-register-assigned:vreg:${segment.vreg}:x18`,
        }),
      );
    }
  }
  diagnostics.push(...verifyIntervalCoverage(input.intervals ?? [], input.allocation));
  diagnostics.push(
    ...verifyPhysicalRegisterOverlaps(input.allocation.segments, input.aliases ?? []),
  );
  const security = verifyAArch64SecurityLabelConservation({
    labels: (input.noSpillVregs ?? []).map((vreg) => ({
      kind: "no-spill",
      subjectKey: `vreg:${vreg}`,
    })),
    placements: input.allocation.segments.map((segment) => ({
      subjectKey: `vreg:${segment.vreg}`,
      locationKind: segment.physical.startsWith("slot:") ? "spill-slot" : "register",
      locationKey: segment.physical,
    })),
  });
  diagnostics.push(...security.diagnostics);
  const sorted = sortAArch64BackendDiagnostics(diagnostics);
  return sorted.length === 0
    ? { kind: "ok", diagnostics: [] }
    : { kind: "error", diagnostics: sorted };
}

function verifyIntervalCoverage(
  intervals: readonly AArch64AllocatorInterval[],
  allocation: AArch64AllocationResult,
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const repaired = new Set(allocation.repairRequests.map((request) => request.liveRangeKey));
  for (const interval of intervals) {
    if (repaired.has(interval.liveRangeKey)) continue;
    if (coversInterval(interval, allocation.segmentsFor(interval.vreg))) continue;
    diagnostics.push(
      aarch64BackendDiagnostic({
        code: "AARCH64_BACKEND_ALLOCATION_FAILED",
        ownerKey: interval.liveRangeKey,
        rootCauseKey: "uncovered-interval",
        stableDetail: `allocation-verifier:uncovered-interval:vreg:${interval.vreg}:range:${interval.startOrder}-${interval.endOrder}:class:${interval.registerClass}`,
      }),
    );
  }
  return diagnostics;
}

function coversInterval(
  interval: AArch64AllocatorInterval,
  segments: readonly AArch64AllocationSegment[],
): boolean {
  let coveredUntil = interval.startOrder;
  for (const segment of segments) {
    if (segment.liveRangeKey !== interval.liveRangeKey) continue;
    if (segment.endOrder <= coveredUntil) continue;
    if (segment.startOrder > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, segment.endOrder);
    if (coveredUntil >= interval.endOrder) return true;
  }
  return coveredUntil >= interval.endOrder;
}

function verifyPhysicalRegisterOverlaps(
  segments: readonly AArch64AllocationSegment[],
  aliases: readonly AArch64PhysicalRegisterAlias[],
): readonly AArch64BackendDiagnostic[] {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const aliasMap = aarch64PhysicalAliasMap(aliases);
  const registerSegments = segments
    .filter((segment) => !segment.physical.startsWith("slot:"))
    .sort(
      (left, right) =>
        compareCodeUnitStrings(left.physical, right.physical) ||
        left.startOrder - right.startOrder ||
        left.endOrder - right.endOrder ||
        compareCodeUnitStrings(left.liveRangeKey, right.liveRangeKey),
    );
  for (let leftIndex = 0; leftIndex < registerSegments.length; leftIndex += 1) {
    const left = registerSegments[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < registerSegments.length; rightIndex += 1) {
      const right = registerSegments[rightIndex];
      if (right === undefined) continue;
      if (!aarch64RegistersAlias(left.physical, right.physical, aliasMap)) continue;
      if (!(left.startOrder < right.endOrder && right.startOrder < left.endOrder)) continue;
      diagnostics.push(
        aarch64BackendDiagnostic({
          code: "AARCH64_BACKEND_ALLOCATION_FAILED",
          ownerKey: right.liveRangeKey,
          rootCauseKey:
            left.physical === right.physical ? "physical-overlap" : "physical-alias-overlap",
          stableDetail:
            left.physical === right.physical
              ? `allocation-verifier:physical-overlap:register:${right.physical}:left:${left.liveRangeKey}:${left.startOrder}-${left.endOrder}:right:${right.liveRangeKey}:${right.startOrder}-${right.endOrder}`
              : `allocation-verifier:physical-alias-overlap:registers:${[
                  left.physical,
                  right.physical,
                ]
                  .sort(compareCodeUnitStrings)
                  .join(
                    ",",
                  )}:left:${left.liveRangeKey}:${left.startOrder}-${left.endOrder}:right:${right.liveRangeKey}:${right.startOrder}-${right.endOrder}`,
        }),
      );
    }
  }
  return diagnostics;
}

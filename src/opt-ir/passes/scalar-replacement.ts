import type { OptIrRegionId } from "../ids";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import type { OptIrMemoryRewriteRecord } from "./memory-optimization";

export interface OptIrScalarReplacementField {
  readonly byteOffset: bigint;
  readonly byteWidth: number;
}

export interface OptIrScalarReplacementCandidate {
  readonly regionId: OptIrRegionId;
  readonly totalByteWidth: number;
  readonly fields: readonly OptIrScalarReplacementField[];
  readonly cleanupEffectsAccounted: boolean;
}

export type OptIrScalarReplacementRejectReason =
  | "unknownRegion"
  | "incompleteByteCoverage"
  | "cleanupEffectsUnaccounted";

export interface OptIrScalarReplacementInput {
  readonly program: OptIrProgram;
  readonly regions: readonly OptIrRegion[];
  readonly candidates: readonly OptIrScalarReplacementCandidate[];
}

export interface OptIrScalarReplacementResult {
  readonly program: OptIrProgram;
  readonly replacedRegionIds: readonly OptIrRegionId[];
  readonly rejectedCandidates: readonly {
    readonly regionId: OptIrRegionId;
    readonly reason: OptIrScalarReplacementRejectReason;
  }[];
  readonly rewriteRecords: readonly OptIrMemoryRewriteRecord[];
}

export function runScalarReplacementForTest(
  input: OptIrScalarReplacementInput,
): OptIrScalarReplacementResult {
  return runScalarReplacement(input);
}

export function runScalarReplacement(
  input: OptIrScalarReplacementInput,
): OptIrScalarReplacementResult {
  const regionIds = new Set(input.regions.map((region) => region.regionId));
  const replacedRegionIds: OptIrRegionId[] = [];
  const rejectedCandidates: OptIrScalarReplacementResult["rejectedCandidates"][number][] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];

  for (const candidate of input.candidates) {
    const reason = scalarReplacementRejectReason(candidate, regionIds);
    if (reason !== undefined) {
      rejectedCandidates.push({ regionId: candidate.regionId, reason });
      continue;
    }
    replacedRegionIds.push(candidate.regionId);
    rewriteRecords.push({
      subject: { kind: "region", regionId: candidate.regionId },
      invariant: { kind: "noaliasMemoryEquivalence" },
    });
  }

  return { program: input.program, replacedRegionIds, rejectedCandidates, rewriteRecords };
}

function scalarReplacementRejectReason(
  candidate: OptIrScalarReplacementCandidate,
  regionIds: ReadonlySet<OptIrRegionId>,
): OptIrScalarReplacementRejectReason | undefined {
  if (!regionIds.has(candidate.regionId)) {
    return "unknownRegion";
  }
  if (!hasCompleteByteCoverage(candidate)) {
    return "incompleteByteCoverage";
  }
  if (!candidate.cleanupEffectsAccounted) {
    return "cleanupEffectsUnaccounted";
  }
  return undefined;
}

function hasCompleteByteCoverage(candidate: OptIrScalarReplacementCandidate): boolean {
  const covered = new Set<number>();
  for (const field of candidate.fields) {
    if (field.byteOffset < 0n || field.byteWidth <= 0) {
      return false;
    }
    const start = Number(field.byteOffset);
    const end = start + field.byteWidth;
    if (!Number.isSafeInteger(start) || end > candidate.totalByteWidth) {
      return false;
    }
    for (let byte = start; byte < end; byte += 1) {
      if (covered.has(byte)) {
        return false;
      }
      covered.add(byte);
    }
  }
  return covered.size === candidate.totalByteWidth;
}

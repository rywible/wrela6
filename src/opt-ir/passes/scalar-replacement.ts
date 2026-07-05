import { optIrAliasClassId, optIrRegionId, type OptIrOriginId, type OptIrRegionId } from "../ids";
import { hasMemoryAccess, type OptIrMemoryAccessOperation } from "../operation-access";
import type { OptIrOperation } from "../operations";
import { optIrRegionTable, type OptIrProgram } from "../program";
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
  | "cleanupEffectsUnaccounted"
  | "unsupportedRegionKind"
  | "unmatchedLiveRegionReference";

export interface OptIrScalarReplacementInput {
  readonly program: OptIrProgram;
  readonly operations?: readonly OptIrOperation[];
  readonly regions: readonly OptIrRegion[];
  readonly candidates: readonly OptIrScalarReplacementCandidate[];
}

export interface OptIrScalarReplacementResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly optimizationRegions: readonly OptIrRegion[];
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
  const regionsById = new Map(input.regions.map((region) => [region.regionId, region]));
  const operations = input.operations ?? [];
  const replacedRegionIds: OptIrRegionId[] = [];
  const rejectedCandidates: OptIrScalarReplacementResult["rejectedCandidates"][number][] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];
  const acceptedCandidates: OptIrScalarReplacementCandidate[] = [];

  for (const candidate of input.candidates) {
    const reason = scalarReplacementRejectReason(candidate, regionsById, operations);
    if (reason !== undefined) {
      rejectedCandidates.push({ regionId: candidate.regionId, reason });
      continue;
    }
    replacedRegionIds.push(candidate.regionId);
    acceptedCandidates.push(candidate);
    rewriteRecords.push({
      subject: { kind: "region", regionId: candidate.regionId },
      invariant: { kind: "noaliasMemoryEquivalence" },
    });
  }

  const rewritten =
    acceptedCandidates.length === 0
      ? { program: input.program, operations, optimizationRegions: input.regions }
      : rewriteScalarReplacementProgram({
          program: input.program,
          operations,
          regions: input.regions,
          regionsById,
          candidates: acceptedCandidates,
        });

  return {
    program: rewritten.program,
    operations: rewritten.operations,
    optimizationRegions: rewritten.optimizationRegions,
    replacedRegionIds,
    rejectedCandidates,
    rewriteRecords,
  };
}

function scalarReplacementRejectReason(
  candidate: OptIrScalarReplacementCandidate,
  regionsById: ReadonlyMap<OptIrRegionId, OptIrRegion>,
  operations: readonly OptIrOperation[],
): OptIrScalarReplacementRejectReason | undefined {
  const region = regionsById.get(candidate.regionId);
  if (region === undefined) {
    return "unknownRegion";
  }
  if (region.kind !== "sourceAggregate" && region.kind !== "stackLocal") {
    return "unsupportedRegionKind";
  }
  if (!hasCompleteByteCoverage(candidate)) {
    return "incompleteByteCoverage";
  }
  if (!candidate.cleanupEffectsAccounted) {
    return "cleanupEffectsUnaccounted";
  }
  if (!allLiveReferencesMatchCandidateFields(candidate, operations)) {
    return "unmatchedLiveRegionReference";
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

function allLiveReferencesMatchCandidateFields(
  candidate: OptIrScalarReplacementCandidate,
  operations: readonly OptIrOperation[],
): boolean {
  const fieldKeys = new Set(candidate.fields.map(fieldRangeKey));
  return operations
    .filter(hasMemoryAccess)
    .filter((operation) => operation.memoryAccess.region === candidate.regionId)
    .every((operation) => fieldKeys.has(memoryRangeKey(operation.memoryAccess)));
}

function rewriteScalarReplacementProgram(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly regions: readonly OptIrRegion[];
  readonly regionsById: ReadonlyMap<OptIrRegionId, OptIrRegion>;
  readonly candidates: readonly OptIrScalarReplacementCandidate[];
}): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly optimizationRegions: readonly OptIrRegion[];
} {
  const nextRegionId = nextRegionIdAllocator(input.program, input.regionsById);
  const scalarRegionByRange = new Map<string, OptIrRegion>();
  const scalarRegionRecords: {
    readonly regionId: OptIrRegionId;
    readonly originId: OptIrOriginId;
  }[] = [];
  const sourceRegionUpdates = new Map<OptIrRegionId, OptIrRegion>();

  for (const candidate of input.candidates) {
    const sourceRegion = input.regionsById.get(candidate.regionId);
    const sourceRecord = input.program.regions.get(candidate.regionId);
    if (sourceRegion === undefined || sourceRecord === undefined) {
      continue;
    }
    const fields = [...candidate.fields].sort((left, right) =>
      left.byteOffset < right.byteOffset ? -1 : left.byteOffset > right.byteOffset ? 1 : 0,
    );
    const scalarFields = fields.map((field) => {
      const regionId = nextRegionId();
      const scalarRegion: OptIrRegion = Object.freeze({
        ...sourceRegion,
        regionId,
        kind: "stackLocal",
        aliasClass: optIrAliasClassId(Number(regionId)),
        optimization: {
          kind: "scalarReplacementField" as const,
          sourceRegionId: sourceRegion.regionId,
          byteOffset: field.byteOffset,
          byteWidth: field.byteWidth,
        },
      });
      scalarRegionByRange.set(candidateFieldKey(candidate.regionId, field), scalarRegion);
      scalarRegionRecords.push({ regionId, originId: sourceRecord.originId });
      return { regionId, byteOffset: field.byteOffset, byteWidth: field.byteWidth };
    });
    sourceRegionUpdates.set(
      candidate.regionId,
      Object.freeze({
        ...sourceRegion,
        optimization: {
          kind: "scalarReplaced" as const,
          fields: Object.freeze(scalarFields),
        },
      }),
    );
  }

  const rewrittenOperations = input.operations.map((operation) =>
    rewriteScalarReplacementOperation(operation, scalarRegionByRange),
  );
  const optimizationRegions = mergeOptimizationRegions({
    current: input.regions,
    sourceRegionUpdates,
    scalarRegions: [...scalarRegionByRange.values()],
  });

  const program: OptIrProgram = {
    ...input.program,
    regions: optIrRegionTable([...input.program.regions.entries(), ...scalarRegionRecords]),
  };
  return {
    program,
    operations: Object.freeze(rewrittenOperations),
    optimizationRegions,
  };
}

function rewriteScalarReplacementOperation(
  operation: OptIrOperation,
  scalarRegionByRange: ReadonlyMap<string, OptIrRegion>,
): OptIrOperation {
  if (!hasMemoryAccess(operation)) {
    return operation;
  }
  const scalarRegion = scalarRegionByRange.get(memoryOperationRangeKey(operation));
  if (scalarRegion === undefined) {
    return operation;
  }
  return {
    ...operation,
    memoryAccess: {
      ...operation.memoryAccess,
      region: scalarRegion.regionId,
      byteOffset: 0n,
    },
  } as OptIrOperation;
}

function mergeOptimizationRegions(input: {
  readonly current: readonly OptIrRegion[];
  readonly sourceRegionUpdates: ReadonlyMap<OptIrRegionId, OptIrRegion>;
  readonly scalarRegions: readonly OptIrRegion[];
}): readonly OptIrRegion[] {
  const byId = new Map(input.current.map((region) => [region.regionId, region]));
  for (const [regionId, region] of input.sourceRegionUpdates) {
    byId.set(regionId, region);
  }
  for (const region of input.scalarRegions) {
    byId.set(region.regionId, region);
  }
  return Object.freeze([...byId.values()].sort((left, right) => left.regionId - right.regionId));
}

function nextRegionIdAllocator(
  program: OptIrProgram,
  regionsById: ReadonlyMap<OptIrRegionId, OptIrRegion>,
): () => OptIrRegionId {
  let next =
    Math.max(
      -1,
      ...program.regions.entries().map((region) => Number(region.regionId)),
      ...[...regionsById.keys()].map(Number),
    ) + 1;
  return () => {
    const regionId = optIrRegionId(next);
    next += 1;
    return regionId;
  };
}

function candidateFieldKey(regionId: OptIrRegionId, field: OptIrScalarReplacementField): string {
  return `${Number(regionId)}:${fieldRangeKey(field)}`;
}

function fieldRangeKey(field: OptIrScalarReplacementField): string {
  return `${field.byteOffset}:${field.byteWidth}`;
}

function memoryOperationRangeKey(operation: OptIrMemoryAccessOperation): string {
  return `${Number(operation.memoryAccess.region)}:${memoryRangeKey(operation.memoryAccess)}`;
}

function memoryRangeKey(memoryAccess: OptIrMemoryAccessOperation["memoryAccess"]): string {
  return `${memoryAccess.byteOffset}:${memoryAccess.byteWidth}`;
}

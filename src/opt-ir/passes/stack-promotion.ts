import type { OptIrRegionId } from "../ids";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import type { OptIrMemoryRewriteRecord } from "./memory-optimization";

export interface OptIrStackLifetimeFact {
  readonly regionId: OptIrRegionId;
  readonly valid: boolean;
}

export type OptIrStackPromotionRejectReason = "notStackLocal" | "escaped" | "invalidLifetime";

export interface OptIrStackPromotionInput {
  readonly program: OptIrProgram;
  readonly regions: readonly OptIrRegion[];
  readonly lifetimeFacts: readonly OptIrStackLifetimeFact[];
  readonly escapedRegionIds: readonly OptIrRegionId[];
  readonly nonEscapingRegionIds?: readonly OptIrRegionId[];
}

export interface OptIrStackPromotionResult {
  readonly program: OptIrProgram;
  readonly optimizationRegions: readonly OptIrRegion[];
  readonly promotedRegionIds: readonly OptIrRegionId[];
  readonly rejectedRegions: readonly {
    readonly regionId: OptIrRegionId;
    readonly reason: OptIrStackPromotionRejectReason;
  }[];
  readonly rewriteRecords: readonly OptIrMemoryRewriteRecord[];
}

export function runStackPromotionForTest(
  input: OptIrStackPromotionInput,
): OptIrStackPromotionResult {
  return runStackPromotion(input);
}

export function runStackPromotion(input: OptIrStackPromotionInput): OptIrStackPromotionResult {
  const escaped = new Set(input.escapedRegionIds);
  const nonEscaping = new Set(input.nonEscapingRegionIds ?? []);
  const lifetimeByRegion = new Map(input.lifetimeFacts.map((fact) => [fact.regionId, fact.valid]));
  const promotedRegionIds: OptIrRegionId[] = [];
  const rejectedRegions: OptIrStackPromotionResult["rejectedRegions"][number][] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];

  for (const region of [...input.regions].sort(
    (left, right) => Number(left.regionId) - Number(right.regionId),
  )) {
    const reason = stackPromotionRejectReason(region, escaped, nonEscaping, lifetimeByRegion);
    if (reason !== undefined) {
      rejectedRegions.push({ regionId: region.regionId, reason });
      continue;
    }
    promotedRegionIds.push(region.regionId);
    rewriteRecords.push({
      subject: { kind: "region", regionId: region.regionId },
      invariant: { kind: "noaliasMemoryEquivalence" },
    });
  }

  return {
    program: input.program,
    optimizationRegions:
      promotedRegionIds.length === 0
        ? input.regions
        : promoteOptimizationRegions(input.regions, new Set(promotedRegionIds)),
    promotedRegionIds,
    rejectedRegions,
    rewriteRecords,
  };
}

function stackPromotionRejectReason(
  region: OptIrRegion,
  escaped: ReadonlySet<OptIrRegionId>,
  nonEscaping: ReadonlySet<OptIrRegionId>,
  lifetimeByRegion: ReadonlyMap<OptIrRegionId, boolean>,
): OptIrStackPromotionRejectReason | undefined {
  if (escaped.has(region.regionId)) {
    return "escaped";
  }
  if (!nonEscaping.has(region.regionId)) {
    return "escaped";
  }
  if (lifetimeByRegion.get(region.regionId) !== true || region.lifetime !== "activation") {
    return "invalidLifetime";
  }
  if (!isStackPromotableKind(region)) {
    return "notStackLocal";
  }
  return undefined;
}

function isStackPromotableKind(region: OptIrRegion): boolean {
  return region.kind === "stackLocal" || region.kind === "sourceAggregate";
}

function promoteOptimizationRegions(
  regions: readonly OptIrRegion[],
  promotedRegionIds: ReadonlySet<OptIrRegionId>,
): readonly OptIrRegion[] {
  const promoted = regions.map((region) => {
    if (!promotedRegionIds.has(region.regionId)) {
      return region;
    }
    return Object.freeze({
      ...region,
      kind: "stackLocal",
      optimization: {
        kind: "stackPromoted" as const,
        sourceKind: region.kind,
      },
    }) satisfies OptIrRegion;
  });
  return Object.freeze(promoted.sort((left, right) => left.regionId - right.regionId));
}

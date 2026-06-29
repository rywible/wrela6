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
}

export interface OptIrStackPromotionResult {
  readonly program: OptIrProgram;
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
  const lifetimeByRegion = new Map(input.lifetimeFacts.map((fact) => [fact.regionId, fact.valid]));
  const promotedRegionIds: OptIrRegionId[] = [];
  const rejectedRegions: OptIrStackPromotionResult["rejectedRegions"][number][] = [];
  const rewriteRecords: OptIrMemoryRewriteRecord[] = [];

  for (const region of [...input.regions].sort(
    (left, right) => Number(left.regionId) - Number(right.regionId),
  )) {
    const reason = stackPromotionRejectReason(region, escaped, lifetimeByRegion);
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

  return { program: input.program, promotedRegionIds, rejectedRegions, rewriteRecords };
}

function stackPromotionRejectReason(
  region: OptIrRegion,
  escaped: ReadonlySet<OptIrRegionId>,
  lifetimeByRegion: ReadonlyMap<OptIrRegionId, boolean>,
): OptIrStackPromotionRejectReason | undefined {
  if (region.kind !== "stackLocal") {
    return "notStackLocal";
  }
  if (escaped.has(region.regionId)) {
    return "escaped";
  }
  if (lifetimeByRegion.get(region.regionId) !== true || region.lifetime !== "activation") {
    return "invalidLifetime";
  }
  return undefined;
}

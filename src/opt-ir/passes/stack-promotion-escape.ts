import type { OptIrEscapeAnalysisInput } from "../analyses/escape-analysis";
import type { OptIrRegion } from "../regions";

export function productionStackPromotionEscapeAnalysisInput(
  regions: readonly OptIrRegion[],
): OptIrEscapeAnalysisInput {
  return {
    regions,
    exportedRoots: regions.filter(isExportedRootRegion).map((region) => region.regionId),
    unknownCallRegions: regions
      .filter((region) => region.kind === "externalUnknown")
      .map((region) => region.regionId),
    externalFlowRegions: regions.filter(isExternalFlowRegion).map((region) => region.regionId),
  };
}

function isExportedRootRegion(region: OptIrRegion): boolean {
  return (
    region.owner.kind === "program" ||
    region.owner.kind === "target" ||
    region.lifetime === "program"
  );
}

function isExternalFlowRegion(region: OptIrRegion): boolean {
  return (
    region.owner.kind === "external" ||
    region.lifetime === "external" ||
    region.effects.ordering === "orderedEffectToken"
  );
}

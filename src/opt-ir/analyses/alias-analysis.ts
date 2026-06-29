import type { OptIrFactBooleanAnswer } from "../facts/fact-query";
import type { OptIrAliasClassId, OptIrRegionId } from "../ids";
import type { OptIrRegion } from "../regions";

export interface OptIrRegionPairNoaliasSubject {
  readonly kind: "regionPair";
  readonly left: OptIrRegionId;
  readonly right: OptIrRegionId;
}

export interface OptIrAliasAnalysisFactQuery {
  readonly mustNotAlias: (subject: OptIrRegionPairNoaliasSubject) => OptIrFactBooleanAnswer;
}

export interface OptIrAliasAnalysisInput {
  readonly regions: readonly OptIrRegion[];
  readonly factQuery?: OptIrAliasAnalysisFactQuery;
}

export interface OptIrAliasAnalysis {
  readonly aliasClassFor: (regionId: OptIrRegionId) => OptIrAliasClassId | undefined;
  readonly mustNotAlias: (left: OptIrRegionId, right: OptIrRegionId) => OptIrFactBooleanAnswer;
  readonly mayAlias: (left: OptIrRegionId, right: OptIrRegionId) => boolean;
}

export function computeOptIrAliasAnalysis(input: OptIrAliasAnalysisInput): OptIrAliasAnalysis {
  const regionById = new Map(input.regions.map((region) => [region.regionId, region]));

  return Object.freeze({
    aliasClassFor(regionId: OptIrRegionId) {
      return regionById.get(regionId)?.aliasClass;
    },
    mustNotAlias(left: OptIrRegionId, right: OptIrRegionId) {
      return (
        input.factQuery?.mustNotAlias(orderedSubject(left, right)) ?? unknownNoalias(left, right)
      );
    },
    mayAlias(left: OptIrRegionId, right: OptIrRegionId) {
      if (left === right) {
        return true;
      }
      const noalias = input.factQuery?.mustNotAlias(orderedSubject(left, right));
      if (noalias?.kind === "yes") {
        return false;
      }
      const leftRegion = regionById.get(left);
      const rightRegion = regionById.get(right);
      if (leftRegion === undefined || rightRegion === undefined) {
        return true;
      }
      if (leftRegion.aliasClass === rightRegion.aliasClass) {
        return true;
      }
      return leftRegion.kind === "externalUnknown" || rightRegion.kind === "externalUnknown";
    },
  });
}

function orderedSubject(left: OptIrRegionId, right: OptIrRegionId): OptIrRegionPairNoaliasSubject {
  return Number(left) <= Number(right)
    ? { kind: "regionPair", left, right }
    : { kind: "regionPair", left: right, right: left };
}

function unknownNoalias(left: OptIrRegionId, right: OptIrRegionId): OptIrFactBooleanAnswer {
  return {
    kind: "unknown",
    factsUsed: [],
    explanation: [
      `No noalias fact is in scope for region:${Number(left)} and region:${Number(right)}.`,
    ],
  };
}

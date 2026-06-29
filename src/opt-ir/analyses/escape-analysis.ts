import type { OptIrRegionId } from "../ids";
import type { OptIrRegion } from "../regions";

export type OptIrEscapeReason =
  | "addressTakenLocal"
  | "callbackCapture"
  | "exportedRoot"
  | "unknownCall"
  | "externalFlow";

export interface OptIrEscapeAnalysisInput {
  readonly regions: readonly OptIrRegion[];
  readonly addressTakenLocals?: readonly OptIrRegionId[];
  readonly callbackCaptures?: readonly OptIrRegionId[];
  readonly exportedRoots?: readonly OptIrRegionId[];
  readonly unknownCallRegions?: readonly OptIrRegionId[];
  readonly externalFlowRegions?: readonly OptIrRegionId[];
}

export interface OptIrEscapeAnalysis {
  readonly hasEscaped: (regionId: OptIrRegionId) => boolean;
  readonly reasonFor: (regionId: OptIrRegionId) => OptIrEscapeReason | undefined;
  readonly escapedRegions: () => readonly OptIrRegionId[];
}

export function computeOptIrEscapeAnalysis(input: OptIrEscapeAnalysisInput): OptIrEscapeAnalysis {
  const reasons = new Map<OptIrRegionId, OptIrEscapeReason>();
  mark(reasons, input.addressTakenLocals, "addressTakenLocal");
  mark(reasons, input.callbackCaptures, "callbackCapture");
  mark(reasons, input.exportedRoots, "exportedRoot");
  mark(reasons, input.unknownCallRegions, "unknownCall");
  mark(reasons, input.externalFlowRegions, "externalFlow");

  return Object.freeze({
    hasEscaped(regionId: OptIrRegionId) {
      return reasons.has(regionId);
    },
    reasonFor(regionId: OptIrRegionId) {
      return reasons.get(regionId);
    },
    escapedRegions() {
      return [...reasons.keys()].sort((left, right) => Number(left) - Number(right));
    },
  });
}

function mark(
  reasons: Map<OptIrRegionId, OptIrEscapeReason>,
  regionIds: readonly OptIrRegionId[] | undefined,
  reason: OptIrEscapeReason,
): void {
  for (const regionId of regionIds ?? []) {
    if (!reasons.has(regionId)) {
      reasons.set(regionId, reason);
    }
  }
}

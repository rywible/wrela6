import type { OptIrRegionId } from "../ids";
import type { OptIrRegion } from "../regions";

export type OptIrEscapeReason =
  | "addressTakenLocal"
  | "callbackCapture"
  | "exportedRoot"
  | "unknownCall"
  | "externalFlow";

export type OptIrEscapeEvidenceKind =
  | "addressTakenLocals"
  | "callbackCaptures"
  | "exportedRoots"
  | "unknownCallRegions"
  | "externalFlowRegions";

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
  readonly doesNotEscape: (regionId: OptIrRegionId) => boolean;
  readonly reasonFor: (regionId: OptIrRegionId) => OptIrEscapeReason | undefined;
  readonly escapedRegions: () => readonly OptIrRegionId[];
  readonly missingEvidenceKinds: () => readonly OptIrEscapeEvidenceKind[];
}

export function computeOptIrEscapeAnalysis(input: OptIrEscapeAnalysisInput): OptIrEscapeAnalysis {
  const reasons = new Map<OptIrRegionId, OptIrEscapeReason>();
  const missingEvidence = missingEvidenceKinds(input);
  mark(reasons, input.addressTakenLocals, "addressTakenLocal");
  mark(reasons, input.callbackCaptures, "callbackCapture");
  mark(reasons, input.exportedRoots, "exportedRoot");
  mark(reasons, input.unknownCallRegions, "unknownCall");
  mark(reasons, input.externalFlowRegions, "externalFlow");

  return Object.freeze({
    hasEscaped(regionId: OptIrRegionId) {
      return reasons.has(regionId);
    },
    doesNotEscape(regionId: OptIrRegionId) {
      return missingEvidence.length === 0 && !reasons.has(regionId);
    },
    reasonFor(regionId: OptIrRegionId) {
      return reasons.get(regionId);
    },
    escapedRegions() {
      return [...reasons.keys()].sort((left, right) => Number(left) - Number(right));
    },
    missingEvidenceKinds() {
      return missingEvidence;
    },
  });
}

function missingEvidenceKinds(input: OptIrEscapeAnalysisInput): readonly OptIrEscapeEvidenceKind[] {
  const missing: OptIrEscapeEvidenceKind[] = [];
  if (input.addressTakenLocals === undefined) missing.push("addressTakenLocals");
  if (input.callbackCaptures === undefined) missing.push("callbackCaptures");
  if (input.exportedRoots === undefined) missing.push("exportedRoots");
  if (input.unknownCallRegions === undefined) missing.push("unknownCallRegions");
  if (input.externalFlowRegions === undefined) missing.push("externalFlowRegions");
  return Object.freeze(missing);
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

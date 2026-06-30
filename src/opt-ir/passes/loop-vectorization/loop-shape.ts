import type {
  OptIrBlockId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrRegionId,
  OptIrValueId,
} from "../../ids";
import type { OptIrBoundsAuthority } from "../../operations";
import type { OptIrOperationKind } from "../../operation-kinds";
import type { OptIrScalarType } from "../../types";

export type OptIrLoopTripCount =
  | { readonly kind: "certifiedExact"; readonly iterations: number }
  | { readonly kind: "unknown" };

export type OptIrLoopVectorTailPlan =
  | { readonly kind: "certifiedMultiple" }
  | { readonly kind: "maskedTail"; readonly maskValueId: OptIrValueId }
  | { readonly kind: "scalarEpilogue"; readonly epilogueBlockId: OptIrBlockId };

export interface OptIrLoopLaneBoundsProof {
  readonly operationId: OptIrOperationId;
  readonly proven: boolean;
}

export interface OptIrLoopLoadMemoryAccess {
  readonly operationId: OptIrOperationId;
  readonly kind: "load";
  readonly region: OptIrRegionId;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly vectorByteWidth: number;
  readonly alignment: number;
  readonly sourceValueIds: readonly [];
  readonly boundsAuthority: OptIrBoundsAuthority;
  readonly memoryVersionBefore: number;
  readonly memoryVersionAfter: number;
}

export type OptIrLoopBlockedEffect =
  | "volatile"
  | "mmio"
  | "firmwareTable"
  | "imageDevice"
  | "terminal"
  | "callback"
  | "platform"
  | "runtime";

export type OptIrLoopCarriedValueKind =
  | "scalarRecurrence"
  | "recognizedReduction"
  | "preservedRegionToken"
  | "preservedEffectToken"
  | "unknown";

export interface OptIrLoopCarriedValue {
  readonly valueId: OptIrValueId;
  readonly kind: OptIrLoopCarriedValueKind;
}

export interface OptIrLoopEffectSafety {
  readonly safe: boolean;
  readonly carriedValues: readonly OptIrLoopCarriedValue[];
  readonly blockedEffects: readonly OptIrLoopBlockedEffect[];
  readonly vectorPermittedEffects: readonly OptIrLoopBlockedEffect[];
}

export interface OptIrLoopLoadPackCandidate {
  readonly loopId: string;
  readonly headerBlockId: OptIrBlockId;
  readonly latchBlockIds: readonly OptIrBlockId[];
  readonly bodyBlockIds: readonly OptIrBlockId[];
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly nextOperationId: number;
  readonly nextValueId: number;
  readonly originId: OptIrOriginId;
  readonly laneType: OptIrScalarType;
  readonly lanes: number;
  readonly tripCount: OptIrLoopTripCount;
  readonly tailPlan: OptIrLoopVectorTailPlan;
  readonly laneBounds: readonly OptIrLoopLaneBoundsProof[];
  readonly memoryAccesses: readonly OptIrLoopLoadMemoryAccess[];
  readonly memoryIndependenceProven: boolean;
  readonly effectSafety: OptIrLoopEffectSafety;
  readonly targetOperationKinds: readonly OptIrOperationKind[];
  readonly estimatedLiveVectorRegisters: number;
}

export type OptIrLoopVectorizationShape =
  | {
      readonly kind: "vectorizable";
      readonly loopId: string;
      readonly headerBlockId: OptIrBlockId;
      readonly tailPlan: OptIrLoopVectorTailPlan;
      readonly vectorIterationCount: number;
    }
  | {
      readonly kind: "scalar";
      readonly loopId?: string;
      readonly headerBlockId?: OptIrBlockId;
      readonly reason:
        | "unknownTripCount"
        | "invalidTripCount"
        | "missingTailPlan"
        | "tailPlanRequiresRemainder"
        | "invalidVectorWidth";
    };

export function classifyLoopVectorizationShape(
  candidate: OptIrLoopLoadPackCandidate,
): OptIrLoopVectorizationShape {
  if (candidate.tripCount.kind === "unknown") {
    return { kind: "scalar", reason: "unknownTripCount" };
  }
  if (!Number.isInteger(candidate.tripCount.iterations) || candidate.tripCount.iterations < 0) {
    return scalarShape(candidate, "invalidTripCount");
  }
  if (!Number.isInteger(candidate.lanes) || candidate.lanes <= 1) {
    return scalarShape(candidate, "invalidVectorWidth");
  }

  const remainder = candidate.tripCount.iterations % candidate.lanes;
  if (candidate.tailPlan.kind === "certifiedMultiple" && remainder !== 0) {
    return scalarShape(candidate, "tailPlanRequiresRemainder");
  }
  if (candidate.tailPlan.kind !== "certifiedMultiple" && remainder === 0) {
    return scalarShape(candidate, "missingTailPlan");
  }

  return {
    kind: "vectorizable",
    loopId: candidate.loopId,
    headerBlockId: candidate.headerBlockId,
    tailPlan: candidate.tailPlan,
    vectorIterationCount: Math.floor(candidate.tripCount.iterations / candidate.lanes),
  };
}

export function sortLoopVectorizationShapes(
  shapes: readonly OptIrLoopVectorizationShape[],
): readonly OptIrLoopVectorizationShape[] {
  return Object.freeze(
    [...shapes].sort((left, right) => {
      const headerOrder = Number(left.headerBlockId ?? 0) - Number(right.headerBlockId ?? 0);
      if (headerOrder !== 0) return headerOrder;
      return (left.loopId ?? "").localeCompare(right.loopId ?? "");
    }),
  );
}

export function sortLoopVectorizationCandidates(
  candidates: readonly OptIrLoopLoadPackCandidate[],
): readonly OptIrLoopLoadPackCandidate[] {
  return Object.freeze(
    [...candidates].sort((left, right) => {
      const headerOrder = Number(left.headerBlockId) - Number(right.headerBlockId);
      if (headerOrder !== 0) return headerOrder;
      return left.loopId.localeCompare(right.loopId);
    }),
  );
}

function scalarShape(
  candidate: OptIrLoopLoadPackCandidate,
  reason: Extract<OptIrLoopVectorizationShape, { readonly kind: "scalar" }>["reason"],
): OptIrLoopVectorizationShape {
  return {
    kind: "scalar",
    loopId: candidate.loopId,
    headerBlockId: candidate.headerBlockId,
    reason,
  };
}

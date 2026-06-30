import {
  optIrVectorPolicyAllowsLaneCount,
  optIrVectorPolicyAllowsLaneType,
  type OptIrVectorPolicy,
} from "../../policy/vector-policy";
import type { OptIrOperationKind } from "../../operation-kinds";
import {
  classifyLoopVectorizationShape,
  sortLoopVectorizationCandidates,
  type OptIrLoopCarriedValue,
  type OptIrLoopLoadPackCandidate,
} from "./loop-shape";

export type OptIrLoopVectorizationRejectionReason =
  | "unknownTripCount"
  | "invalidShape"
  | "missingLaneBounds"
  | "memoryDependence"
  | "effectUnsafe"
  | "illegalCarriedValue"
  | "malformedMemoryAccess"
  | "targetVectorOperationMissing"
  | "registerPressureTooHigh";

export interface OptIrLoopVectorizationRejection {
  readonly candidate: OptIrLoopLoadPackCandidate;
  readonly reason: OptIrLoopVectorizationRejectionReason;
}

export interface OptIrLoopVectorizationLegalityResult {
  readonly accepted: readonly OptIrLoopLoadPackCandidate[];
  readonly rejections: readonly OptIrLoopVectorizationRejection[];
}

const LEGAL_LOOP_LOAD_PACK_OPERATION_KINDS = new Set<OptIrOperationKind>([
  "vectorLoad",
  "vectorMaskedLoad",
]);

export function validateLoopVectorizationLegality(
  candidates: readonly OptIrLoopLoadPackCandidate[],
  policy: OptIrVectorPolicy,
): OptIrLoopVectorizationLegalityResult {
  const accepted: OptIrLoopLoadPackCandidate[] = [];
  const rejections: OptIrLoopVectorizationRejection[] = [];

  for (const candidate of sortLoopVectorizationCandidates(candidates)) {
    const reason = legalityRejection(candidate, policy);
    if (reason === undefined) {
      accepted.push(candidate);
    } else {
      rejections.push({ candidate, reason });
    }
  }

  return {
    accepted: Object.freeze(accepted),
    rejections: Object.freeze(rejections),
  };
}

function legalityRejection(
  candidate: OptIrLoopLoadPackCandidate,
  policy: OptIrVectorPolicy,
): OptIrLoopVectorizationRejectionReason | undefined {
  const shape = classifyLoopVectorizationShape(candidate);
  if (shape.kind === "scalar") {
    return shape.reason === "unknownTripCount" ? "unknownTripCount" : "invalidShape";
  }
  if (
    !policy.enabled ||
    !optIrVectorPolicyAllowsLaneType(policy, candidate.laneType) ||
    !optIrVectorPolicyAllowsLaneCount(policy, candidate.lanes) ||
    !candidate.targetOperationKinds.every((operationKind) =>
      LEGAL_LOOP_LOAD_PACK_OPERATION_KINDS.has(operationKind),
    )
  ) {
    return "targetVectorOperationMissing";
  }
  if (!candidate.laneBounds.every((laneBound) => laneBound.proven)) {
    return "missingLaneBounds";
  }
  if (!candidate.memoryIndependenceProven || !memoryVersionsAreCompatible(candidate)) {
    return "memoryDependence";
  }
  if (!memoryAccessShapesAreWellFormed(candidate)) {
    return "malformedMemoryAccess";
  }
  if (!effectsAreVectorSafe(candidate)) {
    return "effectUnsafe";
  }
  if (!candidate.effectSafety.carriedValues.every(isLegalCarriedValue)) {
    return "illegalCarriedValue";
  }
  if (candidate.estimatedLiveVectorRegisters > policy.maxLiveVectorRegisters) {
    return "registerPressureTooHigh";
  }
  return undefined;
}

function memoryAccessShapesAreWellFormed(candidate: OptIrLoopLoadPackCandidate): boolean {
  return candidate.memoryAccesses.every((access) => access.sourceValueIds.length === 0);
}

function memoryVersionsAreCompatible(candidate: OptIrLoopLoadPackCandidate): boolean {
  return candidate.memoryAccesses.every(
    (access) => access.memoryVersionBefore === access.memoryVersionAfter,
  );
}

function effectsAreVectorSafe(candidate: OptIrLoopLoadPackCandidate): boolean {
  if (!candidate.effectSafety.safe) {
    return false;
  }
  const permittedEffects = new Set(candidate.effectSafety.vectorPermittedEffects);
  return candidate.effectSafety.blockedEffects.every((blockedEffect) =>
    permittedEffects.has(blockedEffect),
  );
}

function isLegalCarriedValue(carriedValue: OptIrLoopCarriedValue): boolean {
  return carriedValue.kind !== "unknown";
}

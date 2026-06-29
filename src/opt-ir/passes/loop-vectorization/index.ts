import type { OptIrVectorPolicy } from "../../policy/vector-policy";
import { validateLoopVectorizationLegality } from "./loop-legality";
import { rewriteLoopVectorizationCandidates } from "./loop-rewrite";
import {
  classifyLoopVectorizationShape,
  sortLoopVectorizationCandidates,
  type OptIrLoopVectorizationCandidate,
} from "./loop-shape";

export type {
  OptIrLoopVectorizationRejection,
  OptIrLoopVectorizationRejectionReason,
} from "./loop-legality";
export type { OptIrLoopVectorRewriteRecord, RewriteLoopVectorizationResult } from "./loop-rewrite";
export type {
  OptIrLoopBlockedEffect,
  OptIrLoopCarriedValue,
  OptIrLoopEffectSafety,
  OptIrLoopLaneBoundsProof,
  OptIrLoopMemoryAccess,
  OptIrLoopTripCount,
  OptIrLoopVectorTailPlan,
  OptIrLoopVectorizationCandidate,
  OptIrLoopVectorizationShape,
} from "./loop-shape";

export interface RunLoopVectorizationInput {
  readonly candidates: readonly OptIrLoopVectorizationCandidate[];
  readonly policy: OptIrVectorPolicy;
}

export interface RunLoopVectorizationResult extends ReturnType<
  typeof rewriteLoopVectorizationCandidates
> {
  readonly rejections: ReturnType<typeof validateLoopVectorizationLegality>["rejections"];
  readonly scalarLoopIds: readonly string[];
}

export function runLoopVectorization(input: RunLoopVectorizationInput): RunLoopVectorizationResult {
  const candidates = sortLoopVectorizationCandidates(input.candidates);
  const scalarLoopIds = candidates
    .filter((candidate) => classifyLoopVectorizationShape(candidate).kind === "scalar")
    .map((candidate) => candidate.loopId);
  const vectorCandidates = candidates.filter(
    (candidate) => classifyLoopVectorizationShape(candidate).kind !== "scalar",
  );
  const legality = validateLoopVectorizationLegality(vectorCandidates, input.policy);
  const rewrite = rewriteLoopVectorizationCandidates(legality.accepted);

  return {
    vectorOperations: rewrite.vectorOperations,
    rewriteRecords: rewrite.rewriteRecords,
    rejections: legality.rejections,
    scalarLoopIds: Object.freeze(scalarLoopIds),
  };
}

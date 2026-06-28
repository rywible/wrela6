export type {
  ProofCheckConcreteResourceKind,
  ProofCheckLiftType,
  LiftProofCheckResourceKindResult,
  ProofCheckPlaceProjection,
  ProofCheckStructuredPlacePath,
  ProofCheckPlaceRelation,
} from "./ownership-place-model";

export {
  proofCheckConcreteResourceKinds,
  liftProofCheckResourceKind,
  liftProofCheckResourceKindResult,
  parseProofCheckStructuredPlacePath,
  buildProofCheckStructuredPlace,
  compareProofCheckPlaces,
  isProofRelevantConcreteResourceKind,
  requiresCheckedOwnerSemantics,
} from "./ownership-place-model";

export type {
  ProofCheckOwnershipTransferResult,
  ProofCheckPlaceOperationInput,
  ProofCheckMoveTransferInput,
  ProofCheckConsumeTransferInput,
  ProofCheckObserveTransferInput,
  ProofCheckAssignTransferInput,
  ProofCheckSummaryPlaceEffectInput,
} from "./ownership-transfer";

export {
  checkUsePlace,
  transferMovePlace,
  observeCopyPlace,
  transferConsumePlace,
  transferAssignPlace,
  applySummaryPlaceEffect,
  applySummaryMutationEffect,
  applySummaryProduceEffect,
} from "./ownership-transfer";

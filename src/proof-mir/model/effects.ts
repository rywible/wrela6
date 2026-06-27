import type { BrandId, ObligationId, PrivateStateTransitionId, SessionId } from "../../hir/ids";
import type { FieldId } from "../../semantic/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  ProofMirCallId,
  ProofMirLoanId,
  ProofMirOriginId,
  ProofMirOwnedPlaceId,
  ProofMirPlaceId,
  ProofMirPrivateStateGenerationId,
  ProofMirScopeId,
  ProofMirValueId,
} from "../ids";

export interface ProofMirLoanReference {
  readonly loanId: ProofMirLoanId;
  readonly mode: "shared" | "exclusive";
  readonly placeId: ProofMirPlaceId;
  readonly scopeId: ProofMirScopeId;
  readonly startOrigin: ProofMirOriginId;
  readonly endOrigin?: ProofMirOriginId;
}

export interface ProofMirSessionMemberReference {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly obligationId?: MonoInstantiatedProofId<ObligationId>;
  readonly placeId?: ProofMirPlaceId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirObligationReference {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateTransitionReference {
  readonly transitionId: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateGenerationReference {
  readonly generationId: ProofMirPrivateStateGenerationId;
  readonly place: ProofMirOwnedPlaceId;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirResourceBoundarySet {
  readonly places: readonly ProofMirPlaceId[];
  readonly loans: readonly ProofMirLoanId[];
  readonly obligations: readonly ProofMirObligationReference[];
  readonly sessionMembers: readonly ProofMirSessionMemberReference[];
  readonly privateStateGenerations: readonly ProofMirPrivateStateGenerationReference[];
}

export type ProofMirEdgeEffect =
  | { readonly kind: "consumePlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "introducePlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "startLoan"; readonly loanId: ProofMirLoanId }
  | { readonly kind: "endLoan"; readonly loanId: ProofMirLoanId }
  | { readonly kind: "openObligation"; readonly obligation: ProofMirObligationReference }
  | { readonly kind: "dischargeObligation"; readonly obligation: ProofMirObligationReference }
  | { readonly kind: "openSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "closeSessionMember"; readonly member: ProofMirSessionMemberReference }
  | {
      readonly kind: "advancePrivateState";
      readonly from: ProofMirPrivateStateGenerationReference;
      readonly target: ProofMirPrivateStateGenerationReference;
    };

export type ProofMirConcurrencyOperation =
  | {
      readonly kind: "pinCore";
      readonly sourcePlace: ProofMirPlaceId;
      readonly workerPlace: ProofMirPlaceId;
      readonly targetCorePlace: ProofMirPlaceId;
      readonly transferObligation: ProofMirObligationReference;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "spawnWorker";
      readonly workerPlace: ProofMirPlaceId;
      readonly entryCall: ProofMirCallId;
      readonly producedSession?: ProofMirSessionMemberReference;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "moveRingEnqueue";
      readonly ringPlace: ProofMirPlaceId;
      readonly valuePlace: ProofMirPlaceId;
      readonly transferBrand: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "moveRingDequeue";
      readonly ringPlace: ProofMirPlaceId;
      readonly resultPlace: ProofMirPlaceId;
      readonly transferBrand: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "transferOwnership";
      readonly fromPlace: ProofMirPlaceId;
      readonly toPlace: ProofMirPlaceId;
      readonly transferBrand?: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    };

export type ProofMirExtensionGate = "crossCoreOwnership" | "coroutineYield" | "streamLoop";

export type ProofMirExtensionConstruct = "crossCoreOwnership" | "coroutineYield" | "streamLoop";

export type ProofMirStatementExtension = {
  readonly gate: "crossCoreOwnership";
  readonly kind: "concurrency";
  readonly operation: ProofMirConcurrencyOperation;
};

export interface ProofMirStreamLoopExtension {
  readonly gate: "streamLoop";
  readonly sessionMember: ProofMirSessionMemberReference;
  readonly streamInstanceId: MonoInstanceId;
  readonly itemFieldId?: FieldId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirYieldFrameBoundary extends ProofMirResourceBoundarySet {
  readonly values: readonly ProofMirValueId[];
}

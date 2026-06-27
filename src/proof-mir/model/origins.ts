import type {
  AttemptId,
  BrandId,
  CallSiteRequirementId,
  FactOriginId,
  HirImageOriginId,
  HirOriginId,
  HirPlatformContractEdgeId,
  ObligationId,
  PrivateStateTransitionId,
  SessionId,
  ValidationId,
} from "../../hir/ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoStatementId,
} from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { PlatformPrimitiveId } from "../../semantic/ids";
import type { ProofMirDeterministicTable } from "../canonicalization/canonical-order";
import type { ProofMirOriginId, ProofMirRuntimeOperationId } from "../ids";
import type { ProofMirLayoutReference } from "./layout-bindings";

export interface ProofMirOrigin {
  readonly originId: ProofMirOriginId;
  readonly owner: ProofMirOriginOwner;
  readonly sourceOrigin?: HirOriginId;
  readonly diagnosticOrigin?: string;
  readonly monoExpressionId?: MonoExpressionId;
  readonly monoStatementId?: MonoStatementId;
  readonly monoLocalId?: MonoLocalId;
  readonly monoProofId?:
    | MonoInstantiatedProofId<ObligationId>
    | MonoInstantiatedProofId<SessionId>
    | MonoInstantiatedProofId<BrandId>
    | MonoInstantiatedProofId<ValidationId>
    | MonoInstantiatedProofId<AttemptId>
    | MonoInstantiatedProofId<PrivateStateTransitionId>
    | MonoInstantiatedProofId<FactOriginId>
    | MonoInstantiatedProofId<CallSiteRequirementId>
    | MonoInstantiatedProofId<HirPlatformContractEdgeId>
    | MonoInstantiatedProofId<HirImageOriginId>;
  readonly layoutKey?: ProofMirLayoutReference;
  readonly note?: string;
}

export type ProofMirOriginOwner =
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "image"; readonly imageInstanceId: MonoInstanceId }
  | {
      readonly kind: "platform";
      readonly edgeId?: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId?: PlatformPrimitiveId;
    }
  | { readonly kind: "runtimeCatalog"; readonly runtimeId?: ProofMirRuntimeOperationId }
  | { readonly kind: "program" };

export type ProofMirOriginTable = ProofMirDeterministicTable<ProofMirOriginId, ProofMirOrigin>;

import type { HirPlatformContractEdgeId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { PlatformPrimitiveId } from "../../semantic/ids";
import type { ProofMirDeterministicTable } from "../canonicalization/canonical-order";
import type {
  ProofMirFactId,
  ProofMirOriginId,
  ProofMirOwnedCallId,
  ProofMirOwnedPlaceId,
  ProofMirRuntimeCallId,
  ProofMirRuntimeOperationId,
} from "../ids";
import type { ProofMirLayoutReference } from "./layout-bindings";

export type ProofMirCallTarget =
  | {
      readonly kind: "sourceFunction";
      readonly functionInstanceId: MonoInstanceId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "functionAbi" };
    }
  | {
      readonly kind: "certifiedPlatform";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
    }
  | {
      readonly kind: "compilerRuntime";
      readonly runtimeId: ProofMirRuntimeOperationId;
      readonly runtimeCallId: ProofMirRuntimeCallId;
    };

export interface ProofMirCallGraphEdge {
  readonly callId: ProofMirOwnedCallId;
  readonly target: ProofMirCallTarget;
  readonly origin: ProofMirOriginId;
}

export type ProofMirCallGraph = ProofMirDeterministicTable<
  ProofMirOwnedCallId,
  ProofMirCallGraphEdge
>;

export type ProofMirRuntimeEffect =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "writesMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export interface ProofMirRuntimeCallContract {
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFacts: readonly ProofMirFactId[];
  readonly consumedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly producedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly effects: readonly ProofMirRuntimeEffect[];
  readonly origin: ProofMirOriginId;
}

export type ProofMirRuntimeCallTable = ProofMirDeterministicTable<
  ProofMirRuntimeCallId,
  ProofMirRuntimeCallContract
>;

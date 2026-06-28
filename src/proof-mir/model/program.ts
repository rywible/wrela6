import type { HirPlatformContractEdgeId } from "../../hir/ids";
import type { LayoutFactProgram } from "../../layout/layout-program";
import type {
  MonoInstantiatedProofId,
  MonoProofMetadata,
  MonoReachableFunctionReason,
} from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { PlatformPrimitiveId } from "../../semantic/ids";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import type { ProofMirDeterministicTable } from "../canonicalization/canonical-order";
import type {
  ProofMirLayoutTermId,
  ProofMirOriginId,
  ProofMirOwnedPlaceId,
  ProofMirPrivateStateGenerationId,
} from "../ids";
import type { ProofMirCallGraph, ProofMirRuntimeCallTable } from "./calls";
import type { ProofMirFactTable } from "./facts";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermRecord,
  ProofMirPrivateStateGenerationReference,
} from "./layout-bindings";
import type { ProofMirFunction } from "./graph";
import type { ProofMirOriginTable } from "./origins";

export interface ProofMirProgram {
  readonly image: ProofMirImage;
  readonly reachableFunctions: ProofMirReachableFunctionTable;
  readonly functions: ProofMirFunctionTable;
  readonly layout: LayoutFactProgram;
  readonly proofMetadata: MonoProofMetadata;
  readonly origins: ProofMirOriginTable;
  readonly facts: ProofMirFactTable;
  readonly layoutTerms: ProofMirLayoutTermTable;
  readonly privateStateGenerations: ProofMirPrivateStateGenerationTable;
  readonly callGraph: ProofMirCallGraph;
  readonly platformEdges: ProofMirPlatformEdgeTable;
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
  readonly runtimeCalls: ProofMirRuntimeCallTable;
}

export interface ProofMirImage {
  readonly imageInstanceId: MonoInstanceId;
  readonly entryFunctionInstanceId: MonoInstanceId;
  readonly externalRoots: readonly ProofMirExternalRoot[];
  readonly layout: ProofMirLayoutReference & { readonly kind: "imageEntryAbi" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirExternalRoot {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly origin: ProofMirOriginId;
}

export interface ProofMirReachableFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: MonoReachableFunctionReason;
  readonly origin: ProofMirOriginId;
}

export type ProofMirReachableFunctionTable = ProofMirDeterministicTable<
  MonoInstanceId,
  ProofMirReachableFunction
>;

export interface ProofMirPlatformEdge {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: PlatformPrimitiveId;
  readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateGeneration {
  readonly generationId: ProofMirPrivateStateGenerationId;
  readonly place: ProofMirOwnedPlaceId;
  readonly previous?: ProofMirPrivateStateGenerationId;
  readonly producedBy?: ProofMirPrivateStateGenerationReference["producedBy"];
  readonly origin: ProofMirOriginId;
}

export type { ProofMirFunction } from "./graph";

export type ProofMirFunctionTable = ProofMirDeterministicTable<MonoInstanceId, ProofMirFunction>;

export type ProofMirLayoutTermTable = ProofMirDeterministicTable<
  ProofMirLayoutTermId,
  ProofMirLayoutTermRecord
>;

export type ProofMirPrivateStateGenerationTable = ProofMirDeterministicTable<
  ProofMirPrivateStateGenerationId,
  ProofMirPrivateStateGeneration
>;

export type ProofMirPlatformEdgeTable = ProofMirDeterministicTable<
  MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  ProofMirPlatformEdge
>;

import type { FactOriginId, HirPlatformContractEdgeId, HirTerminalCallId } from "../../hir/ids";
import type { MonoInstantiatedProofId, MonoLiteralValue } from "../../mono/mono-hir";
import type { ProofMirDeterministicTable } from "../canonicalization/canonical-order";
import type {
  ProofMirFactId,
  ProofMirOriginId,
  ProofMirOwnedLayoutTermBindingId,
  ProofMirOwnedPlaceId,
  ProofMirOwnedValueId,
  ProofMirRuntimeCallId,
} from "../ids";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermReference,
  ProofMirPrivateStateGenerationReference,
} from "./layout-bindings";

export type ProofMirFactRole = "evidence" | "requirement" | "trustedAxiom" | "candidate";

export interface ProofMirFact {
  readonly factId: ProofMirFactId;
  readonly role: ProofMirFactRole;
  readonly kind: ProofMirFactKind;
  readonly origin: ProofMirOriginId;
  readonly dependsOn: readonly ProofMirFactDependency[];
}

export type ProofMirFactKind =
  | {
      readonly kind: "comparison";
      readonly left: ProofMirFactOperand;
      readonly operator: ProofMirComparisonOperator;
      readonly right: ProofMirFactOperand;
    }
  | {
      readonly kind: "predicate";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly arguments: readonly ProofMirFactOperand[];
    }
  | {
      readonly kind: "matchRefinement";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly scrutinee: ProofMirFactOperand;
      readonly caseLabel: string;
    }
  | {
      readonly kind: "layoutFits";
      readonly source: ProofMirOwnedPlaceId;
      readonly end: ProofMirLayoutTermReference;
      readonly binding?: ProofMirOwnedLayoutTermBindingId;
    }
  | {
      readonly kind: "payloadEnd";
      readonly source: ProofMirOwnedPlaceId;
      readonly end: ProofMirLayoutTermReference;
      readonly binding?: ProofMirOwnedLayoutTermBindingId;
    }
  | {
      readonly kind: "platformEnsured";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | {
      readonly kind: "runtimeEnsured";
      readonly runtimeCallId: ProofMirRuntimeCallId;
    }
  | {
      readonly kind: "terminalCall";
      readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
    };

export type ProofMirFactOperand =
  | { readonly kind: "value"; readonly valueId: ProofMirOwnedValueId }
  | { readonly kind: "place"; readonly placeId: ProofMirOwnedPlaceId }
  | { readonly kind: "constant"; readonly literal: MonoLiteralValue }
  | { readonly kind: "layoutTerm"; readonly term: ProofMirLayoutTermReference }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "enumCase"; readonly label: string };

export type ProofMirFactDependency =
  | { readonly kind: "value"; readonly valueId: ProofMirOwnedValueId }
  | { readonly kind: "place"; readonly placeId: ProofMirOwnedPlaceId }
  | { readonly kind: "layout"; readonly layout: ProofMirLayoutReference }
  | {
      readonly kind: "privateState";
      readonly generation: ProofMirPrivateStateGenerationReference;
    }
  | {
      readonly kind: "platformEdge";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "runtimeCall"; readonly runtimeCallId: ProofMirRuntimeCallId }
  | { readonly kind: "fact"; readonly factId: ProofMirFactId };

export type ProofMirComparisonOperator = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type ProofMirFactTable = ProofMirDeterministicTable<ProofMirFactId, ProofMirFact>;

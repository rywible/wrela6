import type { HirPlatformContractEdgeId, PrivateStateTransitionId } from "../../hir/ids";
import type {
  LayoutFieldKey,
  LayoutImageDeviceKey,
  LayoutTermUnit,
  LayoutTypeKey,
} from "../../layout/layout-program";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { FieldId } from "../../semantic/ids";
import type {
  ProofMirLayoutTermBindingId,
  ProofMirLayoutTermId,
  ProofMirOriginId,
  ProofMirOwnedPlaceId,
  ProofMirPlaceId,
  ProofMirPrivateStateGenerationId,
  ProofMirValueId,
} from "../ids";

export type ProofMirLayoutReference =
  | { readonly kind: "type"; readonly key: LayoutTypeKey }
  | { readonly kind: "field"; readonly key: LayoutFieldKey }
  | { readonly kind: "validatedBuffer"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferField";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "imageDevice"; readonly key: LayoutImageDeviceKey }
  | {
      readonly kind: "platformAbi";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "functionAbi"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "imageEntryAbi"; readonly imageInstanceId: MonoInstanceId };

export interface ProofMirLayoutTermReference {
  readonly termId: ProofMirLayoutTermId;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
}

export interface ProofMirLayoutTermRecord {
  readonly termId: ProofMirLayoutTermId;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirLayoutTermPath {
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
}

export type ProofMirLayoutTermRoot =
  | { readonly kind: "validatedBufferSourceLength"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferFieldTerm";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly slot: "offset" | "byteLength" | "elementCount" | "end" | "derivedValue";
    }
  | {
      readonly kind: "validatedBufferReadRequirement";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly requirementIndex: number;
      readonly slot: "end" | "left" | "right" | "expression";
    }
  | {
      readonly kind: "validatedBufferDerivedSource";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "validatedBufferDerivedCase";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly caseIndex: number;
      readonly slot: "conditionValue" | "result";
    };

export type ProofMirLayoutTermChild = "left" | "right";

export interface ProofMirLayoutTermBinding {
  readonly bindingId: ProofMirLayoutTermBindingId;
  readonly term: ProofMirLayoutTermReference;
  readonly value: ProofMirValueId;
  readonly sourcePlace?: ProofMirPlaceId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateGenerationReference {
  readonly generationId: ProofMirPrivateStateGenerationId;
  readonly place: ProofMirOwnedPlaceId;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}

import type { FunctionId, ImageId, TypeId } from "../semantic/ids";

export type HirOriginId = number & { readonly __brand: "HirOriginId" };
export type HirExpressionId = number & { readonly __brand: "HirExpressionId" };
export type HirProofExpressionId = number & {
  readonly __brand: "HirProofExpressionId";
};
export type HirStatementId = number & { readonly __brand: "HirStatementId" };
export type HirLocalId = number & { readonly __brand: "HirLocalId" };
export type HirTerminalCallId = number & { readonly __brand: "HirTerminalCallId" };

export type ObligationId = number & { readonly __brand: "ObligationId" };
export type SessionId = number & { readonly __brand: "SessionId" };
export type BrandId = number & { readonly __brand: "BrandId" };
export type ResourcePlaceId = number & {
  readonly __brand: "ResourcePlaceId";
};
export type HirRequirementId = number & {
  readonly __brand: "HirRequirementId";
};
export type CallSiteRequirementId = number & {
  readonly __brand: "CallSiteRequirementId";
};
export type ValidationId = number & { readonly __brand: "ValidationId" };
export type AttemptId = number & { readonly __brand: "AttemptId" };
export type PrivateStateTransitionId = number & {
  readonly __brand: "PrivateStateTransitionId";
};
export type FactOriginId = number & { readonly __brand: "FactOriginId" };
export type HirPlatformContractEdgeId = number & {
  readonly __brand: "HirPlatformContractEdgeId";
};
export type HirImageOriginId = number & { readonly __brand: "HirImageOriginId" };

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function hirOriginId(value: number): HirOriginId {
  return denseId(value, "HirOriginId") as HirOriginId;
}

export function hirExpressionId(value: number): HirExpressionId {
  return denseId(value, "HirExpressionId") as HirExpressionId;
}

export function hirProofExpressionId(value: number): HirProofExpressionId {
  return denseId(value, "HirProofExpressionId") as HirProofExpressionId;
}

export function hirStatementId(value: number): HirStatementId {
  return denseId(value, "HirStatementId") as HirStatementId;
}

export function hirLocalId(value: number): HirLocalId {
  return denseId(value, "HirLocalId") as HirLocalId;
}

export function hirTerminalCallId(value: number): HirTerminalCallId {
  return denseId(value, "HirTerminalCallId") as HirTerminalCallId;
}

export function obligationId(value: number): ObligationId {
  return denseId(value, "ObligationId") as ObligationId;
}

export function sessionId(value: number): SessionId {
  return denseId(value, "SessionId") as SessionId;
}

export function brandId(value: number): BrandId {
  return denseId(value, "BrandId") as BrandId;
}

export function resourcePlaceId(value: number): ResourcePlaceId {
  return denseId(value, "ResourcePlaceId") as ResourcePlaceId;
}

export function hirRequirementId(value: number): HirRequirementId {
  return denseId(value, "HirRequirementId") as HirRequirementId;
}

export function callSiteRequirementId(value: number): CallSiteRequirementId {
  return denseId(value, "CallSiteRequirementId") as CallSiteRequirementId;
}

export function validationId(value: number): ValidationId {
  return denseId(value, "ValidationId") as ValidationId;
}

export function attemptId(value: number): AttemptId {
  return denseId(value, "AttemptId") as AttemptId;
}

export function privateStateTransitionId(value: number): PrivateStateTransitionId {
  return denseId(value, "PrivateStateTransitionId") as PrivateStateTransitionId;
}

export function factOriginId(value: number): FactOriginId {
  return denseId(value, "FactOriginId") as FactOriginId;
}

export function hirPlatformContractEdgeId(value: number): HirPlatformContractEdgeId {
  return denseId(value, "HirPlatformContractEdgeId") as HirPlatformContractEdgeId;
}

export function hirImageOriginId(value: number): HirImageOriginId {
  return denseId(value, "HirImageOriginId") as HirImageOriginId;
}

export type HirProofOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "image"; readonly imageId: ImageId }
  | { readonly kind: "type"; readonly typeId: TypeId };

export interface HirOwnedId<IdValue> {
  readonly owner: HirProofOwner;
  readonly id: IdValue;
}

export function ownedId<IdValue>(
  owner: HirProofOwner,
  id: IdValue,
  _family: string,
): HirOwnedId<IdValue> {
  return { owner, id };
}

function ownerKey(owner: HirProofOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${owner.functionId}`;
    case "image":
      return `image:${owner.imageId}`;
    case "type":
      return `type:${owner.typeId}`;
  }
}

export function ownedIdKey<IdValue>(ownedIdValue: HirOwnedId<IdValue>, family: string): string {
  return `${ownerKey(ownedIdValue.owner)}/${family}:${String(ownedIdValue.id)}`;
}

export function ownedObligationId(
  ownerFunctionId: FunctionId,
  ordinal: number,
): HirOwnedId<ObligationId> {
  return ownedId(
    { kind: "function", functionId: ownerFunctionId },
    obligationId(ordinal),
    "obligation",
  );
}

export function ownedSessionId(owner: HirProofOwner, ordinal: number): HirOwnedId<SessionId> {
  return ownedId(owner, sessionId(ordinal), "session");
}

export function ownedBrandId(owner: HirProofOwner, ordinal: number): HirOwnedId<BrandId> {
  return ownedId(owner, brandId(ordinal), "brand");
}

export function ownedResourcePlaceId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<ResourcePlaceId> {
  return ownedId(owner, resourcePlaceId(ordinal), "resourcePlace");
}

export function ownedHirRequirementId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<HirRequirementId> {
  return ownedId(owner, hirRequirementId(ordinal), "requirement");
}

export function ownedCallSiteRequirementId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<CallSiteRequirementId> {
  return ownedId(owner, callSiteRequirementId(ordinal), "callSiteRequirement");
}

export function ownedValidationId(owner: HirProofOwner, ordinal: number): HirOwnedId<ValidationId> {
  return ownedId(owner, validationId(ordinal), "validation");
}

export function ownedAttemptId(owner: HirProofOwner, ordinal: number): HirOwnedId<AttemptId> {
  return ownedId(owner, attemptId(ordinal), "attempt");
}

export function ownedPrivateStateTransitionId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<PrivateStateTransitionId> {
  return ownedId(owner, privateStateTransitionId(ordinal), "privateStateTransition");
}

export function ownedFactOriginId(owner: HirProofOwner, ordinal: number): HirOwnedId<FactOriginId> {
  return ownedId(owner, factOriginId(ordinal), "factOrigin");
}

export function ownedHirPlatformContractEdgeId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<HirPlatformContractEdgeId> {
  return ownedId(owner, hirPlatformContractEdgeId(ordinal), "platformContractEdge");
}

export function ownedHirImageOriginId(
  owner: HirProofOwner,
  ordinal: number,
): HirOwnedId<HirImageOriginId> {
  return ownedId(owner, hirImageOriginId(ordinal), "imageOrigin");
}

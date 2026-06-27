import type { MonoInstanceId } from "../mono/ids";

export type ProofMirBlockId = number & { readonly __brand: "ProofMirBlockId" };
export type ProofMirValueId = number & { readonly __brand: "ProofMirValueId" };
export type ProofMirStatementId = number & { readonly __brand: "ProofMirStatementId" };
export type ProofMirTerminatorId = number & { readonly __brand: "ProofMirTerminatorId" };
export type ProofMirCallId = number & { readonly __brand: "ProofMirCallId" };
export type ProofMirPlaceId = number & { readonly __brand: "ProofMirPlaceId" };
export type ProofMirLocalId = number & { readonly __brand: "ProofMirLocalId" };
export type ProofMirOriginId = number & { readonly __brand: "ProofMirOriginId" };
export type ProofMirExitEdgeId = number & { readonly __brand: "ProofMirExitEdgeId" };
export type ProofMirControlEdgeId = number & { readonly __brand: "ProofMirControlEdgeId" };
export type ProofMirFactId = number & { readonly __brand: "ProofMirFactId" };
export type ProofMirScopeId = number & { readonly __brand: "ProofMirScopeId" };
export type ProofMirLoanId = number & { readonly __brand: "ProofMirLoanId" };
export type ProofMirLayoutTermId = number & { readonly __brand: "ProofMirLayoutTermId" };
export type ProofMirLayoutTermBindingId = number & {
  readonly __brand: "ProofMirLayoutTermBindingId";
};
export type ProofMirPrivateStateGenerationId = number & {
  readonly __brand: "ProofMirPrivateStateGenerationId";
};
export type ProofMirRuntimeOperationId = number & {
  readonly __brand: "ProofMirRuntimeOperationId";
};
export type ProofMirRuntimeCallId = number & { readonly __brand: "ProofMirRuntimeCallId" };

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function proofMirBlockId(value: number): ProofMirBlockId {
  return denseId(value, "ProofMirBlockId") as ProofMirBlockId;
}

export function proofMirValueId(value: number): ProofMirValueId {
  return denseId(value, "ProofMirValueId") as ProofMirValueId;
}

export function proofMirStatementId(value: number): ProofMirStatementId {
  return denseId(value, "ProofMirStatementId") as ProofMirStatementId;
}

export function proofMirTerminatorId(value: number): ProofMirTerminatorId {
  return denseId(value, "ProofMirTerminatorId") as ProofMirTerminatorId;
}

export function proofMirCallId(value: number): ProofMirCallId {
  return denseId(value, "ProofMirCallId") as ProofMirCallId;
}

export function proofMirPlaceId(value: number): ProofMirPlaceId {
  return denseId(value, "ProofMirPlaceId") as ProofMirPlaceId;
}

export function proofMirLocalId(value: number): ProofMirLocalId {
  return denseId(value, "ProofMirLocalId") as ProofMirLocalId;
}

export function proofMirOriginId(value: number): ProofMirOriginId {
  return denseId(value, "ProofMirOriginId") as ProofMirOriginId;
}

export function proofMirExitEdgeId(value: number): ProofMirExitEdgeId {
  return denseId(value, "ProofMirExitEdgeId") as ProofMirExitEdgeId;
}

export function proofMirControlEdgeId(value: number): ProofMirControlEdgeId {
  return denseId(value, "ProofMirControlEdgeId") as ProofMirControlEdgeId;
}

export function proofMirFactId(value: number): ProofMirFactId {
  return denseId(value, "ProofMirFactId") as ProofMirFactId;
}

export function proofMirScopeId(value: number): ProofMirScopeId {
  return denseId(value, "ProofMirScopeId") as ProofMirScopeId;
}

export function proofMirLoanId(value: number): ProofMirLoanId {
  return denseId(value, "ProofMirLoanId") as ProofMirLoanId;
}

export function proofMirLayoutTermId(value: number): ProofMirLayoutTermId {
  return denseId(value, "ProofMirLayoutTermId") as ProofMirLayoutTermId;
}

export function proofMirLayoutTermBindingId(value: number): ProofMirLayoutTermBindingId {
  return denseId(value, "ProofMirLayoutTermBindingId") as ProofMirLayoutTermBindingId;
}

export function proofMirPrivateStateGenerationId(value: number): ProofMirPrivateStateGenerationId {
  return denseId(value, "ProofMirPrivateStateGenerationId") as ProofMirPrivateStateGenerationId;
}

export function proofMirRuntimeOperationId(value: number): ProofMirRuntimeOperationId {
  return denseId(value, "ProofMirRuntimeOperationId") as ProofMirRuntimeOperationId;
}

export function proofMirRuntimeCallId(value: number): ProofMirRuntimeCallId {
  return denseId(value, "ProofMirRuntimeCallId") as ProofMirRuntimeCallId;
}

export interface ProofMirOwnedValueId {
  readonly functionInstanceId: MonoInstanceId;
  readonly valueId: ProofMirValueId;
}

export interface ProofMirOwnedPlaceId {
  readonly functionInstanceId: MonoInstanceId;
  readonly placeId: ProofMirPlaceId;
}

export interface ProofMirOwnedCallId {
  readonly functionInstanceId: MonoInstanceId;
  readonly callId: ProofMirCallId;
}

export interface ProofMirOwnedLayoutTermBindingId {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindingId: ProofMirLayoutTermBindingId;
}

export interface ProofMirOwnedControlEdgeId {
  readonly functionInstanceId: MonoInstanceId;
  readonly edgeId: ProofMirControlEdgeId;
}

export function proofMirOwnedValueId(
  functionInstanceId: MonoInstanceId,
  valueId: ProofMirValueId,
): ProofMirOwnedValueId {
  return { functionInstanceId, valueId };
}

export function proofMirOwnedPlaceId(
  functionInstanceId: MonoInstanceId,
  placeId: ProofMirPlaceId,
): ProofMirOwnedPlaceId {
  return { functionInstanceId, placeId };
}

export function proofMirOwnedCallId(
  functionInstanceId: MonoInstanceId,
  callId: ProofMirCallId,
): ProofMirOwnedCallId {
  return { functionInstanceId, callId };
}

export function proofMirOwnedLayoutTermBindingId(
  functionInstanceId: MonoInstanceId,
  bindingId: ProofMirLayoutTermBindingId,
): ProofMirOwnedLayoutTermBindingId {
  return { functionInstanceId, bindingId };
}

export function proofMirOwnedControlEdgeId(
  functionInstanceId: MonoInstanceId,
  edgeId: ProofMirControlEdgeId,
): ProofMirOwnedControlEdgeId {
  return { functionInstanceId, edgeId };
}

function ownedIdKey(functionInstanceId: MonoInstanceId, family: string, id: number): string {
  return `${String(functionInstanceId)}/${family}:${String(id)}`;
}

export function proofMirOwnedValueIdKey(ownedId: ProofMirOwnedValueId): string {
  return ownedIdKey(ownedId.functionInstanceId, "value", ownedId.valueId);
}

export function proofMirOwnedPlaceIdKey(ownedId: ProofMirOwnedPlaceId): string {
  return ownedIdKey(ownedId.functionInstanceId, "place", ownedId.placeId);
}

export function proofMirOwnedCallIdKey(ownedId: ProofMirOwnedCallId): string {
  return ownedIdKey(ownedId.functionInstanceId, "call", ownedId.callId);
}

export function proofMirOwnedLayoutTermBindingIdKey(
  ownedId: ProofMirOwnedLayoutTermBindingId,
): string {
  return ownedIdKey(ownedId.functionInstanceId, "layoutTermBinding", ownedId.bindingId);
}

export function proofMirOwnedControlEdgeIdKey(ownedId: ProofMirOwnedControlEdgeId): string {
  return ownedIdKey(ownedId.functionInstanceId, "controlEdge", ownedId.edgeId);
}

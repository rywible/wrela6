export type AArch64BackendStableId<Brand extends string> = string & { readonly __brand: Brand };

export type AArch64BackendSurfaceId = AArch64BackendStableId<"AArch64BackendSurfaceId">;
export type AArch64BackendPrivateConventionId =
  AArch64BackendStableId<"AArch64BackendPrivateConventionId">;
export type AArch64BackendAbiBoundaryId = AArch64BackendStableId<"AArch64BackendAbiBoundaryId">;
export type AArch64PhysicalRegisterId = AArch64BackendStableId<"AArch64PhysicalRegisterId">;
export type AArch64PhysicalAliasSetId = AArch64BackendStableId<"AArch64PhysicalAliasSetId">;
export type AArch64BackendLiveRangeId = AArch64BackendStableId<"AArch64BackendLiveRangeId">;
export type AArch64AllocationSegmentId = AArch64BackendStableId<"AArch64AllocationSegmentId">;
export type AArch64BackendFrameSlotId = AArch64BackendStableId<"AArch64BackendFrameSlotId">;
export type AArch64ObjectSectionId = AArch64BackendStableId<"AArch64ObjectSectionId">;
export type AArch64ObjectFragmentId = AArch64BackendStableId<"AArch64ObjectFragmentId">;
export type AArch64ObjectRelocationId = AArch64BackendStableId<"AArch64ObjectRelocationId">;
export type AArch64LiteralPoolId = AArch64BackendStableId<"AArch64LiteralPoolId">;
export type AArch64VeneerId = AArch64BackendStableId<"AArch64VeneerId">;
export type AArch64ObjectSymbolId = AArch64BackendStableId<"AArch64ObjectSymbolId">;
export type AArch64RewriteTransactionId = AArch64BackendStableId<"AArch64RewriteTransactionId">;
export type AArch64BackendVerifierRunKey = AArch64BackendStableId<"AArch64BackendVerifierRunKey">;

export function aarch64BackendSurfaceId(value: string): AArch64BackendSurfaceId {
  return backendStableId(value, "AArch64BackendSurfaceId");
}
export function aarch64BackendPrivateConventionId(
  value: string,
): AArch64BackendPrivateConventionId {
  return backendStableId(value, "AArch64BackendPrivateConventionId");
}
export function aarch64BackendAbiBoundaryId(value: string): AArch64BackendAbiBoundaryId {
  return backendStableId(value, "AArch64BackendAbiBoundaryId");
}
export function aarch64PhysicalRegisterId(value: string): AArch64PhysicalRegisterId {
  return backendStableId(value, "AArch64PhysicalRegisterId");
}
export function aarch64PhysicalAliasSetId(value: string): AArch64PhysicalAliasSetId {
  return backendStableId(value, "AArch64PhysicalAliasSetId");
}
export function aarch64BackendLiveRangeId(value: string): AArch64BackendLiveRangeId {
  return backendStableId(value, "AArch64BackendLiveRangeId");
}
export function aarch64AllocationSegmentId(value: string): AArch64AllocationSegmentId {
  return backendStableId(value, "AArch64AllocationSegmentId");
}
export function aarch64BackendFrameSlotId(value: string): AArch64BackendFrameSlotId {
  return backendStableId(value, "AArch64BackendFrameSlotId");
}
export function aarch64ObjectSectionId(value: string): AArch64ObjectSectionId {
  return backendStableId(value, "AArch64ObjectSectionId");
}
export function aarch64ObjectFragmentId(value: string): AArch64ObjectFragmentId {
  return backendStableId(value, "AArch64ObjectFragmentId");
}
export function aarch64ObjectRelocationId(value: string): AArch64ObjectRelocationId {
  return backendStableId(value, "AArch64ObjectRelocationId");
}
export function aarch64LiteralPoolId(value: string): AArch64LiteralPoolId {
  return backendStableId(value, "AArch64LiteralPoolId");
}
export function aarch64VeneerId(value: string): AArch64VeneerId {
  return backendStableId(value, "AArch64VeneerId");
}
export function aarch64ObjectSymbolId(value: string): AArch64ObjectSymbolId {
  return backendStableId(value, "AArch64ObjectSymbolId");
}
export function aarch64RewriteTransactionId(value: string): AArch64RewriteTransactionId {
  return backendStableId(value, "AArch64RewriteTransactionId");
}
export function aarch64BackendVerifierRunKey(value: string): AArch64BackendVerifierRunKey {
  return backendStableId(value, "AArch64BackendVerifierRunKey");
}

function backendStableId<Brand extends string>(
  value: string,
  label: string,
): AArch64BackendStableId<Brand> {
  if (value.length === 0 || value.trim() !== value) {
    throw new RangeError(`${label} stable key must be non-empty and trimmed.`);
  }
  return value as AArch64BackendStableId<Brand>;
}

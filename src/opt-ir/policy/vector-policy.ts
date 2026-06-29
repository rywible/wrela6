import type { OptIrTargetSurface } from "../target-surface";
import { optIrTypesEqual, type OptIrScalarType } from "../types";
import type { OptIrOperationKind } from "../operation-kinds";

export type OptIrMaskedInactiveLaneBehavior = "passthrough" | "noEffect";
export type OptIrVectorInactiveLaneMemoryEffect = "none";

const VECTOR_OPERATION_KINDS = [
  "vectorLoad",
  "vectorStore",
  "vectorMaskedLoad",
  "vectorMaskedStore",
  "vectorShuffle",
  "vectorCompare",
  "vectorSelect",
  "vectorByteSwap",
] as const satisfies readonly OptIrOperationKind[];

export interface OptIrVectorInactiveLaneSemantics {
  readonly inactiveLaneBehavior: OptIrMaskedInactiveLaneBehavior;
  readonly memoryEffect: OptIrVectorInactiveLaneMemoryEffect;
}

export interface OptIrVectorPolicy {
  readonly enabled: boolean;
  readonly legalLaneTypes: readonly OptIrScalarType[];
  readonly legalLaneCounts: readonly number[];
  readonly preferredByteWidths: readonly number[];
  readonly allowUnalignedPacketLoads: boolean;
  readonly allowEndianSwapVectorIdioms: boolean;
  readonly maxLiveVectorRegisters: number;
}

export function optIrDefaultVectorPolicy(target: OptIrTargetSurface): OptIrVectorPolicy {
  return {
    enabled: target.vector.enabled,
    legalLaneTypes: target.vector.legalLaneTypes,
    legalLaneCounts: target.vector.legalLaneCounts,
    preferredByteWidths: target.vector.preferredByteWidths,
    allowUnalignedPacketLoads: target.vector.supportsUnalignedPacketLoads,
    allowEndianSwapVectorIdioms: target.vector.supportsEndianSwapVectorIdioms,
    maxLiveVectorRegisters: 16,
  };
}

export function optIrVectorPolicyAllowsLaneType(
  policy: OptIrVectorPolicy,
  laneType: OptIrScalarType,
): boolean {
  return policy.legalLaneTypes.some((legalLaneType) => optIrTypesEqual(legalLaneType, laneType));
}

export function optIrVectorPolicyAllowsLaneCount(
  policy: OptIrVectorPolicy,
  lanes: number,
): boolean {
  return policy.legalLaneCounts.includes(lanes);
}

export function optIrVectorOperationKinds(): readonly (typeof VECTOR_OPERATION_KINDS)[number][] {
  return VECTOR_OPERATION_KINDS;
}

export function optIrMaskedLoadInactiveLaneSemantics(): OptIrVectorInactiveLaneSemantics {
  return { inactiveLaneBehavior: "passthrough", memoryEffect: "none" };
}

export function optIrMaskedStoreInactiveLaneSemantics(): OptIrVectorInactiveLaneSemantics {
  return { inactiveLaneBehavior: "noEffect", memoryEffect: "none" };
}

export function optIrVectorSelectInactiveLaneSemantics(): OptIrVectorInactiveLaneSemantics {
  return { inactiveLaneBehavior: "passthrough", memoryEffect: "none" };
}

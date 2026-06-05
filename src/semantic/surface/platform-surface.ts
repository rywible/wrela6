import type {
  DeviceSurfaceId,
  ImageProfileId,
  PlatformContractId,
  PlatformPrimitiveFamilyId,
  PlatformPrimitiveId,
  TargetId,
  UniqueEdgeRootKey,
} from "../ids";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind, ConcreteResourceKind } from "./resource-kind";
import { compareCodeUnitStrings } from "./deterministic-sort";

export interface TargetAvailability {
  readonly targetId: TargetId;
  readonly profiles: readonly ImageProfileId[];
  readonly features: readonly string[];
}

export interface TargetParameterSpec {
  readonly type: CheckedType;
  readonly mode: "observe" | "consume";
  readonly resourceKind: CheckedResourceKind;
}

export interface TargetFunctionSignature {
  readonly genericArity: number;
  readonly receiver: TargetParameterSpec | undefined;
  readonly parameters: readonly TargetParameterSpec[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
  readonly requiredModifiers: readonly string[];
  readonly forbiddenModifiers: readonly string[];
}

export interface TargetProofContractSurface {
  readonly requiredFacts: readonly CheckedRequirementSurfacePlaceholder[];
  readonly ensuredFacts: readonly CheckedRequirementSurfacePlaceholder[];
}

export interface CheckedRequirementSurfacePlaceholder {
  readonly text: string;
}

export interface PlatformPrimitiveSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly availability: TargetAvailability;
  readonly signature: TargetFunctionSignature;
  readonly proofContract: TargetProofContractSurface;
}

export interface PlatformPrimitiveCatalog {
  get(primitiveId: PlatformPrimitiveId): PlatformPrimitiveSpec | undefined;
  entries(): readonly PlatformPrimitiveSpec[];
}

export function platformPrimitiveCatalog(
  primitives: readonly PlatformPrimitiveSpec[],
): PlatformPrimitiveCatalog {
  const sorted = [...primitives].sort((left, right) =>
    compareCodeUnitStrings(left.primitiveId, right.primitiveId),
  );
  const byId = new Map<PlatformPrimitiveId, PlatformPrimitiveSpec>();
  for (const primitive of sorted) {
    if (byId.has(primitive.primitiveId)) {
      throw new RangeError(`Duplicate platform primitive id '${primitive.primitiveId}'.`);
    }
    byId.set(primitive.primitiveId, primitive);
  }
  return {
    get: (primitiveId) => byId.get(primitiveId),
    entries: () => sorted,
  };
}

export interface ImageProfileSpec {
  readonly profileId: ImageProfileId;
  readonly name: string;
  readonly declarationKind: "uefi";
  readonly entryFunctionName: string;
  readonly entrySignature: TargetFunctionSignature;
  readonly availableDeviceSurfaces: readonly DeviceSurfaceId[];
  readonly availablePlatformFamilies: readonly PlatformPrimitiveFamilyId[];
}

export interface DeviceSurfaceSpec {
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly name: string;
  readonly availability: TargetAvailability;
  readonly resourceKind: ConcreteResourceKind;
  readonly uniqueEdgeRoots: readonly UniqueEdgeRootKey[];
}

export interface SemanticTargetSurface {
  readonly targetId: TargetId;
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
}

function sortedImageProfiles(profiles: readonly ImageProfileSpec[]): readonly ImageProfileSpec[] {
  return [...profiles].sort((left, right) => compareCodeUnitStrings(left.name, right.name));
}

function sortedDeviceSurfaces(devices: readonly DeviceSurfaceSpec[]): readonly DeviceSurfaceSpec[] {
  return [...devices].sort((left, right) => compareCodeUnitStrings(left.name, right.name));
}

export function semanticTargetSurface(input: {
  readonly targetId: TargetId;
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
}): SemanticTargetSurface {
  const profiles = sortedImageProfiles(input.imageProfiles);
  const profileNames = new Set<string>();
  const profileIds = new Set<string>();
  for (const profile of profiles) {
    if (profileNames.has(profile.name)) {
      throw new RangeError(`Duplicate image profile name '${profile.name}'.`);
    }
    if (profileIds.has(profile.profileId)) {
      throw new RangeError(`Duplicate image profile id '${profile.profileId}'.`);
    }
    profileNames.add(profile.name);
    profileIds.add(profile.profileId);
  }

  const devices = sortedDeviceSurfaces(input.deviceSurfaces);
  const deviceNames = new Set<string>();
  const deviceIds = new Set<string>();
  for (const device of devices) {
    if (deviceNames.has(device.name)) {
      throw new RangeError(`Duplicate device surface name '${device.name}'.`);
    }
    if (deviceIds.has(device.deviceSurfaceId)) {
      throw new RangeError(`Duplicate device surface id '${device.deviceSurfaceId}'.`);
    }
    deviceNames.add(device.name);
    deviceIds.add(device.deviceSurfaceId);
  }

  return {
    targetId: input.targetId,
    platformPrimitives: input.platformPrimitives,
    imageProfiles: profiles,
    deviceSurfaces: devices,
  };
}

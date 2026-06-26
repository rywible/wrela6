import type {
  DeviceSurfaceId,
  FunctionId,
  ImageProfileId,
  ParameterId,
  PlatformContractId,
  PlatformPrimitiveFamilyId,
  PlatformPrimitiveId,
  TargetId,
  TargetTypeId,
  TypeId,
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
  readonly ensuredFacts: readonly TargetEnsuredFactSurface[];
  readonly takeModeContracts?: readonly TargetTakeModeContractSurface[];
  readonly validationContracts?: readonly TargetValidationContractSurface[];
  readonly attemptContracts?: readonly TargetAttemptContractSurface[];
}

export interface CheckedRequirementSurfacePlaceholder {
  readonly text: string;
}

export type TargetEnsuredFactSurface =
  | {
      readonly kind: "predicate";
      readonly predicateFunctionId: FunctionId;
      readonly argumentBindings: readonly TargetEnsuredFactArgument[];
    }
  | {
      readonly kind: "state";
      readonly stateKind: "advanced" | "closed" | "available";
      readonly argumentBindings: readonly TargetEnsuredFactArgument[];
    }
  | {
      readonly kind: "rawText";
      readonly text: string;
    };

export interface TargetEnsuredFactArgument {
  readonly kind: "receiver" | "parameter" | "constant";
  readonly parameterId?: ParameterId;
  readonly placeKey?: string;
  readonly expressionText?: string;
}

export type TargetTakeModeContractSurface =
  | {
      readonly kind: "stream";
      readonly itemType: CheckedType;
      readonly itemResourceKind: CheckedResourceKind;
    }
  | {
      readonly kind: "buffer";
      readonly sourceTypeId: TypeId;
      readonly bufferResourceKind: CheckedResourceKind;
    };

export interface TargetValidationContractSurface {
  readonly validatedBufferTypeId: TypeId;
  readonly resultType: CheckedType;
  readonly sourceType: CheckedType;
  readonly okPayloadType: CheckedType;
  readonly errPayloadType: CheckedType;
  readonly sourceParameterIndex: number;
}

export type TargetAttemptInputPosition =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly parameterIndex: number };

export interface TargetAttemptContractSurface {
  readonly resultType: CheckedType;
  readonly okType: CheckedType;
  readonly errType: CheckedType;
  readonly inputs: readonly TargetAttemptInputPosition[];
}

export interface PlatformPrimitiveSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly primitiveFamilyId?: PlatformPrimitiveFamilyId;
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
    entries: () => [...sorted],
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
  readonly sourceTypeName: string;
  readonly availability: TargetAvailability;
  readonly resourceKind: ConcreteResourceKind;
  readonly uniqueEdgeRoots: readonly UniqueEdgeRootKey[];
}

export interface TargetTypeKindSpec {
  readonly targetTypeId: TargetTypeId;
  readonly kind: ConcreteResourceKind;
}

export interface SemanticTargetSurface {
  readonly targetId: TargetId;
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
  readonly targetTypeKinds: readonly TargetTypeKindSpec[];
}

function sortedImageProfiles(profiles: readonly ImageProfileSpec[]): readonly ImageProfileSpec[] {
  return [...profiles].sort((left, right) => compareCodeUnitStrings(left.name, right.name));
}

function sortedDeviceSurfaces(devices: readonly DeviceSurfaceSpec[]): readonly DeviceSurfaceSpec[] {
  return [...devices].sort((left, right) => compareCodeUnitStrings(left.name, right.name));
}

function sortedTargetTypeKinds(
  kinds: readonly TargetTypeKindSpec[],
): readonly TargetTypeKindSpec[] {
  return [...kinds].sort((left, right) =>
    compareCodeUnitStrings(String(left.targetTypeId), String(right.targetTypeId)),
  );
}

export function semanticTargetSurface(input: {
  readonly targetId: TargetId;
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
  readonly targetTypeKinds?: readonly TargetTypeKindSpec[];
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

  const targetTypeKinds = sortedTargetTypeKinds(input.targetTypeKinds ?? []);
  const targetKindIds = new Set<string>();
  for (const kindSpec of targetTypeKinds) {
    if (targetKindIds.has(String(kindSpec.targetTypeId))) {
      throw new RangeError(`Duplicate target type kind id '${kindSpec.targetTypeId}'.`);
    }
    targetKindIds.add(String(kindSpec.targetTypeId));
  }

  return {
    targetId: input.targetId,
    platformPrimitives: input.platformPrimitives,
    imageProfiles: profiles,
    deviceSurfaces: devices,
    targetTypeKinds,
  };
}

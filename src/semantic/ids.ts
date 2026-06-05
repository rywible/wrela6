export type ModuleId = number & { readonly __brand: "ModuleId" };
export type ItemId = number & { readonly __brand: "ItemId" };
export type TypeId = number & { readonly __brand: "TypeId" };
export type FunctionId = number & { readonly __brand: "FunctionId" };
export type ImageId = number & { readonly __brand: "ImageId" };
export type FieldId = number & { readonly __brand: "FieldId" };
export type ParameterId = number & { readonly __brand: "ParameterId" };
export type CoreTypeId = string & { readonly __brand: "CoreTypeId" };
export type PlatformPrimitiveId = string & { readonly __brand: "PlatformPrimitiveId" };
export type TargetId = string & { readonly __brand: "TargetId" };
export type PlatformContractId = string & { readonly __brand: "PlatformContractId" };
export type ImageProfileId = string & { readonly __brand: "ImageProfileId" };
export type DeviceSurfaceId = string & { readonly __brand: "DeviceSurfaceId" };
export type PlatformPrimitiveFamilyId = string & {
  readonly __brand: "PlatformPrimitiveFamilyId";
};
export type TargetTypeId = string & { readonly __brand: "TargetTypeId" };
export type UniqueEdgeRootKey = string & { readonly __brand: "UniqueEdgeRootKey" };

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function moduleId(value: number): ModuleId {
  return denseId(value, "ModuleId") as ModuleId;
}

export function itemId(value: number): ItemId {
  return denseId(value, "ItemId") as ItemId;
}

export function typeId(value: number): TypeId {
  return denseId(value, "TypeId") as TypeId;
}

export function functionId(value: number): FunctionId {
  return denseId(value, "FunctionId") as FunctionId;
}

export function imageId(value: number): ImageId {
  return denseId(value, "ImageId") as ImageId;
}

export function fieldId(value: number): FieldId {
  return denseId(value, "FieldId") as FieldId;
}

export function parameterId(value: number): ParameterId {
  return denseId(value, "ParameterId") as ParameterId;
}

function nonEmptyTrimmedId(value: string, label: string): string {
  if (value.length === 0) throw new RangeError(`${label} must not be empty.`);
  if (value !== value.trim()) {
    throw new RangeError(`${label} must not have leading or trailing whitespace.`);
  }
  return value;
}

export function coreTypeId(value: string): CoreTypeId {
  return nonEmptyTrimmedId(value, "CoreTypeId") as CoreTypeId;
}

export function platformPrimitiveId(value: string): PlatformPrimitiveId {
  return nonEmptyTrimmedId(value, "PlatformPrimitiveId") as PlatformPrimitiveId;
}

export function targetId(value: string): TargetId {
  return nonEmptyTrimmedId(value, "TargetId") as TargetId;
}

export function platformContractId(value: string): PlatformContractId {
  return nonEmptyTrimmedId(value, "PlatformContractId") as PlatformContractId;
}

export function imageProfileId(value: string): ImageProfileId {
  return nonEmptyTrimmedId(value, "ImageProfileId") as ImageProfileId;
}

export function deviceSurfaceId(value: string): DeviceSurfaceId {
  return nonEmptyTrimmedId(value, "DeviceSurfaceId") as DeviceSurfaceId;
}

export function platformPrimitiveFamilyId(value: string): PlatformPrimitiveFamilyId {
  return nonEmptyTrimmedId(value, "PlatformPrimitiveFamilyId") as PlatformPrimitiveFamilyId;
}

export function targetTypeId(value: string): TargetTypeId {
  return nonEmptyTrimmedId(value, "TargetTypeId") as TargetTypeId;
}

export function uniqueEdgeRootKey(value: string): UniqueEdgeRootKey {
  return nonEmptyTrimmedId(value, "UniqueEdgeRootKey") as UniqueEdgeRootKey;
}

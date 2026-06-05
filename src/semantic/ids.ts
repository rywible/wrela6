export type ModuleId = number & { readonly __brand: "ModuleId" };
export type ItemId = number & { readonly __brand: "ItemId" };
export type TypeId = number & { readonly __brand: "TypeId" };
export type FunctionId = number & { readonly __brand: "FunctionId" };
export type ImageId = number & { readonly __brand: "ImageId" };
export type FieldId = number & { readonly __brand: "FieldId" };
export type ParameterId = number & { readonly __brand: "ParameterId" };
export type CoreTypeId = string & { readonly __brand: "CoreTypeId" };
export type PlatformPrimitiveId = string & { readonly __brand: "PlatformPrimitiveId" };

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

export function coreTypeId(value: string): CoreTypeId {
  if (value.length === 0) {
    throw new RangeError("CoreTypeId must not be empty.");
  }
  if (value !== value.trim()) {
    throw new RangeError("CoreTypeId must not have leading or trailing whitespace.");
  }
  return value as CoreTypeId;
}

export function platformPrimitiveId(value: string): PlatformPrimitiveId {
  if (value.length === 0) {
    throw new RangeError("PlatformPrimitiveId must not be empty.");
  }
  if (value !== value.trim()) {
    throw new RangeError("PlatformPrimitiveId must not have leading or trailing whitespace.");
  }
  return value as PlatformPrimitiveId;
}

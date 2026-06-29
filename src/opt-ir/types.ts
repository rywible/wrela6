export type OptIrIntegerSignedness = "signed" | "unsigned";

export interface OptIrBooleanType {
  readonly kind: "boolean";
}

export interface OptIrIntegerType {
  readonly kind: "integer";
  readonly signedness: OptIrIntegerSignedness;
  readonly width: number;
}

export interface OptIrPointerType {
  readonly kind: "pointer";
  readonly addressSpace: string;
}

export interface OptIrAddressType {
  readonly kind: "address";
}

export interface OptIrNeverType {
  readonly kind: "never";
}

export interface OptIrUnitType {
  readonly kind: "unit";
}

export interface OptIrZeroSizedType {
  readonly kind: "zeroSized";
  readonly name: string;
}

export type OptIrScalarType =
  | OptIrBooleanType
  | OptIrIntegerType
  | OptIrPointerType
  | OptIrAddressType
  | OptIrNeverType
  | OptIrUnitType
  | OptIrZeroSizedType;

export interface OptIrVectorType {
  readonly kind: "vector";
  readonly laneType: OptIrScalarType;
  readonly laneCount: number;
}

export interface OptIrVectorMaskType {
  readonly kind: "vectorMask";
  readonly laneCount: number;
}

export type OptIrType = OptIrScalarType | OptIrVectorType | OptIrVectorMaskType;

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, got ${value}.`);
  }
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    throw new RangeError(`${label} must be non-empty.`);
  }
  return value;
}

export function optIrBooleanType(): OptIrBooleanType {
  return { kind: "boolean" };
}

export function optIrSignedIntegerType(width: number): OptIrIntegerType {
  return {
    kind: "integer",
    signedness: "signed",
    width: requirePositiveInteger(width, "integer width"),
  };
}

export function optIrUnsignedIntegerType(width: number): OptIrIntegerType {
  return {
    kind: "integer",
    signedness: "unsigned",
    width: requirePositiveInteger(width, "integer width"),
  };
}

export function optIrPointerType(input: { readonly addressSpace: string }): OptIrPointerType {
  return {
    kind: "pointer",
    addressSpace: requireNonEmpty(input.addressSpace, "addressSpace"),
  };
}

export function optIrAddressType(): OptIrAddressType {
  return { kind: "address" };
}

export function optIrNeverType(): OptIrNeverType {
  return { kind: "never" };
}

export function optIrUnitType(): OptIrUnitType {
  return { kind: "unit" };
}

export function optIrZeroSizedType(name: string): OptIrZeroSizedType {
  return { kind: "zeroSized", name: requireNonEmpty(name, "zero-sized type name") };
}

export function optIrTypeStableKey(type: OptIrType): string {
  switch (type.kind) {
    case "boolean":
      return "bool";
    case "integer":
      return `${type.signedness === "signed" ? "i" : "u"}${type.width}`;
    case "pointer":
      return `ptr(${type.addressSpace})`;
    case "address":
      return "address";
    case "never":
      return "never";
    case "unit":
      return "unit";
    case "zeroSized":
      return `zst(${type.name})`;
    case "vector":
      return `vector(${optIrTypeStableKey(type.laneType)}x${type.laneCount})`;
    case "vectorMask":
      return `mask(${type.laneCount})`;
  }
}

export function optIrTypesEqual(left: OptIrType, right: OptIrType): boolean {
  return optIrTypeStableKey(left) === optIrTypeStableKey(right);
}

export function optIrRequireLaneCount(laneCount: number): number {
  return requirePositiveInteger(laneCount, "lane count");
}

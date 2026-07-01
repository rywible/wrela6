export type AArch64RegisterClass = "gpr32" | "gpr64" | "fpScalar" | "vector64" | "vector128";

export type AArch64MachineType =
  | AArch64MachineScalarType
  | {
      readonly kind: "vector";
      readonly laneType: AArch64MachineScalarType;
      readonly laneCount: number;
    };

export type AArch64MachineScalarType =
  | { readonly kind: "integer"; readonly width: 1 | 8 | 16 | 32 | 64 }
  | { readonly kind: "pointer"; readonly addressSpace: string }
  | { readonly kind: "float"; readonly width: 16 | 32 | 64 }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "resourceToken"; readonly resource: string };

function requireWidth<Width extends number>(
  width: number,
  allowed: readonly Width[],
  label: string,
): Width {
  if (!Number.isInteger(width) || !allowed.includes(width as Width)) {
    throw new RangeError(`${label} must be one of ${allowed.join(", ")}, got ${width}.`);
  }
  return width as Width;
}

function requireNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    throw new RangeError(`${label} must be non-empty.`);
  }
  return value;
}

export function aarch64IntMachineType(width: number): AArch64MachineScalarType {
  return Object.freeze({
    kind: "integer",
    width: requireWidth(width, [1, 8, 16, 32, 64], "integer width"),
  });
}

export function aarch64PointerMachineType(addressSpace: string): AArch64MachineScalarType {
  return Object.freeze({
    kind: "pointer",
    addressSpace: requireNonEmpty(addressSpace, "addressSpace"),
  });
}

export function aarch64FloatMachineType(width: number): AArch64MachineScalarType {
  return Object.freeze({ kind: "float", width: requireWidth(width, [16, 32, 64], "float width") });
}

export function aarch64TokenMachineType(token: string): AArch64MachineScalarType {
  return Object.freeze({ kind: "token", token: requireNonEmpty(token, "token") });
}

export function aarch64ResourceTokenMachineType(resource: string): AArch64MachineScalarType {
  return Object.freeze({ kind: "resourceToken", resource: requireNonEmpty(resource, "resource") });
}

export function aarch64VectorMachineType(input: {
  readonly laneType: AArch64MachineScalarType;
  readonly laneCount: number;
}): AArch64MachineType {
  if (!Number.isInteger(input.laneCount) || input.laneCount <= 0) {
    throw new RangeError(`laneCount must be a positive integer, got ${input.laneCount}.`);
  }
  return Object.freeze({
    kind: "vector",
    laneType: Object.freeze({ ...input.laneType }) as AArch64MachineScalarType,
    laneCount: input.laneCount,
  });
}

export function aarch64MachineTypeStableKey(type: AArch64MachineType): string {
  switch (type.kind) {
    case "integer":
      return `i${type.width}`;
    case "pointer":
      return `ptr:${type.addressSpace}`;
    case "float":
      return `f${type.width}`;
    case "token":
      return `token:${type.token}`;
    case "resourceToken":
      return `resource:${type.resource}`;
    case "vector":
      return `vector:${aarch64MachineTypeStableKey(type.laneType)}x${type.laneCount}`;
  }
}

export function aarch64RegisterClassAcceptsType(
  registerClass: AArch64RegisterClass,
  type: AArch64MachineType,
): boolean {
  switch (registerClass) {
    case "gpr32":
      return type.kind === "integer" && type.width <= 32;
    case "gpr64":
      return (type.kind === "integer" && type.width <= 64) || type.kind === "pointer";
    case "fpScalar":
      return type.kind === "float";
    case "vector64":
      return type.kind === "vector" && type.laneCount * laneWidth(type.laneType) <= 64;
    case "vector128":
      return type.kind === "vector" && type.laneCount * laneWidth(type.laneType) <= 128;
  }
}

function laneWidth(type: AArch64MachineScalarType): number {
  switch (type.kind) {
    case "integer":
    case "float":
      return type.width;
    case "pointer":
      return 64;
    case "token":
    case "resourceToken":
      return 0;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

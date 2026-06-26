import type { WireEndian } from "./wire-layout";
import {
  validateLayoutWireMarker,
  wireIntegerEncodingFromLayoutMarker,
  wireScalarEncodingFromLayoutMarker,
  type LayoutWireMarkerValidation,
  type WireIntegerEncoding,
  type WireScalarEncoding,
} from "./wire-layout";

export type { LayoutWireMarkerValidation };

const MULTI_BYTE_UNSIGNED_CORE_TYPE_BIT_WIDTHS = new Map<string, number>([
  ["u16", 16],
  ["u32", 32],
  ["u64", 64],
]);

export function unsignedIntegerBitWidthForCoreTypeName(
  coreTypeName: string,
  targetPointerWidthBits?: number,
): number | undefined {
  if (coreTypeName === "u8") {
    return 8;
  }
  if (coreTypeName === "usize") {
    return targetPointerWidthBits;
  }
  return MULTI_BYTE_UNSIGNED_CORE_TYPE_BIT_WIDTHS.get(coreTypeName);
}

export function maximumUnsignedIntegerValueForCoreTypeName(
  coreTypeName: string,
  targetPointerWidthBits?: number,
): bigint | undefined {
  const bitWidth = unsignedIntegerBitWidthForCoreTypeName(coreTypeName, targetPointerWidthBits);
  if (bitWidth === undefined) {
    return undefined;
  }
  if (bitWidth === 8) {
    return 255n;
  }
  return (1n << BigInt(bitWidth)) - 1n;
}

export function validateSemanticLayoutWireMarker(input: {
  readonly coreTypeName: string;
  readonly layoutWireEndian?: WireEndian;
}): LayoutWireMarkerValidation {
  if (input.coreTypeName === "usize") {
    if (input.layoutWireEndian === undefined) {
      return { kind: "missingMarker" };
    }
    return { kind: "valid" };
  }
  return validateLayoutWireMarkerForCoreType({
    coreTypeName: input.coreTypeName,
    layoutWireEndian: input.layoutWireEndian,
  });
}

export function validateLayoutWireMarkerForCoreType(input: {
  readonly coreTypeName: string;
  readonly layoutWireEndian?: WireEndian;
  readonly targetPointerWidthBits?: number;
}): LayoutWireMarkerValidation {
  return validateLayoutWireMarker({
    layoutWireEndian: input.layoutWireEndian,
    unsignedIntegerBitWidth: unsignedIntegerBitWidthForCoreTypeName(
      input.coreTypeName,
      input.targetPointerWidthBits,
    ),
  });
}

export function layoutWireMarkerValidationMessage(
  validation: LayoutWireMarkerValidation,
): string | undefined {
  switch (validation.kind) {
    case "valid":
      return undefined;
    case "missingMarker":
      return "multi-byte layout field requires le or be wire endian marker";
    case "invalidMarker":
      return "wire endian marker is not valid for this field type";
    default: {
      const unreachable: never = validation;
      return unreachable;
    }
  }
}

export function wireScalarEncodingForCoreType(input: {
  readonly coreTypeName: string;
  readonly layoutWireEndian?: WireEndian;
  readonly targetPointerWidthBits?: number;
}): WireScalarEncoding | undefined {
  return wireScalarEncodingFromLayoutMarker({
    layoutWireEndian: input.layoutWireEndian,
    unsignedIntegerBitWidth: unsignedIntegerBitWidthForCoreTypeName(
      input.coreTypeName,
      input.targetPointerWidthBits,
    ),
  });
}

export function wireIntegerEncodingForCoreType(input: {
  readonly coreTypeName: string;
  readonly layoutWireEndian?: WireEndian;
  readonly targetPointerWidthBits?: number;
}): WireIntegerEncoding | undefined {
  return wireIntegerEncodingFromLayoutMarker({
    layoutWireEndian: input.layoutWireEndian,
    unsignedIntegerBitWidth: unsignedIntegerBitWidthForCoreTypeName(
      input.coreTypeName,
      input.targetPointerWidthBits,
    ),
  });
}

export function unsignedIntegerBitWidthForPrimitiveSpec(input: {
  readonly representation: string;
  readonly bitWidth?: number | bigint;
}): number | undefined {
  if (input.representation !== "unsignedInteger") {
    return undefined;
  }
  if (input.bitWidth === undefined) {
    return undefined;
  }
  return Number(input.bitWidth);
}

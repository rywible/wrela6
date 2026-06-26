export type WireEndian = "big" | "little";

export type WireIntegerEncoding =
  | {
      readonly kind: "integer";
      readonly endian: WireEndian;
      readonly signedness: "signed" | "unsigned";
      readonly bitWidth: number;
    }
  | { readonly kind: "byte" };

export type WireScalarEncoding = WireIntegerEncoding | { readonly kind: "opaqueBytes" };

export type LayoutWireMarkerValidation =
  | { readonly kind: "valid" }
  | { readonly kind: "missingMarker" }
  | { readonly kind: "invalidMarker" };

export function validateLayoutWireMarker(input: {
  readonly layoutWireEndian?: WireEndian;
  readonly unsignedIntegerBitWidth?: number;
}): LayoutWireMarkerValidation {
  const { layoutWireEndian, unsignedIntegerBitWidth } = input;

  if (layoutWireEndian !== undefined) {
    if (unsignedIntegerBitWidth === undefined || unsignedIntegerBitWidth <= 8) {
      return { kind: "invalidMarker" };
    }
    return { kind: "valid" };
  }

  if (unsignedIntegerBitWidth !== undefined && unsignedIntegerBitWidth > 8) {
    return { kind: "missingMarker" };
  }

  return { kind: "valid" };
}

export function wireScalarEncodingFromLayoutMarker(input: {
  readonly layoutWireEndian?: WireEndian;
  readonly unsignedIntegerBitWidth?: number;
}): WireScalarEncoding | undefined {
  const validation = validateLayoutWireMarker(input);
  if (validation.kind === "invalidMarker" || validation.kind === "missingMarker") {
    return undefined;
  }

  const { layoutWireEndian, unsignedIntegerBitWidth } = input;
  if (layoutWireEndian !== undefined && unsignedIntegerBitWidth !== undefined) {
    return {
      kind: "integer",
      endian: layoutWireEndian,
      signedness: "unsigned",
      bitWidth: unsignedIntegerBitWidth,
    };
  }

  if (unsignedIntegerBitWidth === 8) {
    return { kind: "byte" };
  }

  return undefined;
}

export function wireIntegerEncodingFromLayoutMarker(input: {
  readonly layoutWireEndian?: WireEndian;
  readonly unsignedIntegerBitWidth?: number;
}): WireIntegerEncoding | undefined {
  const encoding = wireScalarEncodingFromLayoutMarker(input);
  if (encoding === undefined || encoding.kind === "opaqueBytes") {
    return undefined;
  }
  return encoding;
}

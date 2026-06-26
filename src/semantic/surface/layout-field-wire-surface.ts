import { coreTypeId } from "../ids";
import type { WireEndian, WireScalarEncoding } from "../../shared/wire-layout";
import { validateLayoutWireMarker } from "../../shared/wire-layout";
import {
  layoutWireMarkerValidationMessage,
  validateSemanticLayoutWireMarker,
  wireScalarEncodingForCoreType,
} from "../../shared/layout-wire-marker";
import type { CheckedType } from "./type-model";

export interface LayoutFieldWireSurfaceValue {
  readonly wireEncoding?: WireScalarEncoding;
  readonly validationDetails?: string;
}

function coreTypeNameForCheckedType(type: CheckedType): string | undefined {
  if (type.kind !== "core") {
    return undefined;
  }
  for (const name of ["u8", "u16", "u32", "u64", "usize"] as const) {
    if (type.coreTypeId === coreTypeId(name)) {
      return name;
    }
  }
  return undefined;
}

export function layoutFieldWireSurfaceForCheckedType(input: {
  readonly type: CheckedType;
  readonly layoutWireEndian?: WireEndian;
}): LayoutFieldWireSurfaceValue {
  const coreTypeName = coreTypeNameForCheckedType(input.type);
  const validation =
    coreTypeName !== undefined
      ? validateSemanticLayoutWireMarker({
          coreTypeName,
          layoutWireEndian: input.layoutWireEndian,
        })
      : validateLayoutWireMarker({
          layoutWireEndian: input.layoutWireEndian,
          unsignedIntegerBitWidth: undefined,
        });
  const validationDetails = layoutWireMarkerValidationMessage(validation);
  const wireEncoding =
    coreTypeName !== undefined && validation.kind === "valid"
      ? wireScalarEncodingForCoreType({
          coreTypeName,
          layoutWireEndian: input.layoutWireEndian,
        })
      : undefined;
  return { wireEncoding, validationDetails };
}

import type { MonoCheckedType, MonomorphizedHirProgram } from "../mono/mono-hir";
import type { FieldId } from "../semantic/ids";
import { coreTypeId } from "../semantic/ids";
import type { WireEndian, WireIntegerEncoding, WireScalarEncoding } from "../shared/wire-layout";
import { unsignedIntegerBitWidthForCoreTypeName } from "../shared/layout-wire-marker";
import { wireIntegerEncodingFromLayoutMarker } from "../shared/wire-layout";
import type { LayoutIntegerRange, TargetLayoutFacts } from "./layout-program";
import {
  buildTypeInstanceLookup,
  monoTypeInstanceIdForCheckedType,
} from "./layout-type-resolution";

const CONSERVATIVE_MAXIMUM_OBJECT_SIZE_BYTES = 1_073_741_824n;

export interface LayoutEnumDiscriminantLookup {
  enumMaximumDiscriminant(type: MonoCheckedType): bigint | undefined;
}

export function buildLayoutEnumDiscriminantLookup(
  program: MonomorphizedHirProgram,
): LayoutEnumDiscriminantLookup {
  const typeInstanceByCanonicalKey = buildTypeInstanceLookup(program);
  return {
    enumMaximumDiscriminant(type: MonoCheckedType): bigint | undefined {
      const instanceId = monoTypeInstanceIdForCheckedType(type, typeInstanceByCanonicalKey);
      if (instanceId === undefined) {
        return undefined;
      }
      const instance = program.types.get(instanceId);
      if (instance === undefined || instance.sourceKind !== "enum") {
        return undefined;
      }
      return BigInt(Math.max(instance.enumCases.length - 1, 0));
    },
  };
}

export interface LayoutFieldWireMetadata {
  readonly wireEncoding?: WireScalarEncoding;
  readonly layoutWireEndian?: WireEndian;
}

function coreTypeNameForMonoType(type: MonoCheckedType): string | undefined {
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

function isUsizeType(type: MonoCheckedType): boolean {
  return type.kind === "core" && type.coreTypeId === coreTypeId("usize");
}

export function integerRangeForFieldValueType(input: {
  readonly enumDiscriminantLookup?: LayoutEnumDiscriminantLookup;
  readonly type: MonoCheckedType;
  readonly targetFacts: TargetLayoutFacts;
}): LayoutIntegerRange {
  if (input.type.kind === "core" && input.type.coreTypeId === coreTypeId("bool")) {
    return { minimum: 0n, maximum: 1n, provenance: "checkedType" };
  }

  const enumMaximum = input.enumDiscriminantLookup?.enumMaximumDiscriminant(input.type);
  if (enumMaximum !== undefined) {
    return { minimum: 0n, maximum: enumMaximum, provenance: "checkedType" };
  }

  const coreTypeName = coreTypeNameForMonoType(input.type);
  if (coreTypeName !== undefined) {
    const bitWidth = unsignedIntegerBitWidthForCoreTypeName(
      coreTypeName,
      isUsizeType(input.type) ? input.targetFacts.pointerWidthBits : undefined,
    );
    if (bitWidth !== undefined) {
      const maximum = (1n << BigInt(bitWidth)) - 1n;
      return { minimum: 0n, maximum, provenance: "checkedType" };
    }
  }

  return {
    minimum: 0n,
    maximum: CONSERVATIVE_MAXIMUM_OBJECT_SIZE_BYTES,
    provenance: "checkedType",
  };
}

function wireIntegerEncodingFromScalar(
  encoding: WireScalarEncoding | undefined,
): WireIntegerEncoding | undefined {
  if (encoding === undefined || encoding.kind === "opaqueBytes") {
    return undefined;
  }
  return encoding;
}

export function wireIntegerEncodingForLayoutField(input: {
  readonly fieldId: FieldId;
  readonly type: MonoCheckedType;
  readonly targetFacts: TargetLayoutFacts;
  readonly layoutFieldWireByFieldId: ReadonlyMap<FieldId, LayoutFieldWireMetadata>;
}): WireIntegerEncoding | undefined {
  const metadata = input.layoutFieldWireByFieldId.get(input.fieldId);
  const fromChecked = wireIntegerEncodingFromScalar(metadata?.wireEncoding);
  if (fromChecked !== undefined) {
    if (isUsizeType(input.type) && fromChecked.kind === "integer") {
      return { ...fromChecked, bitWidth: input.targetFacts.pointerWidthBits };
    }
    return fromChecked;
  }
  const coreTypeName = coreTypeNameForMonoType(input.type);
  if (coreTypeName === undefined) {
    return undefined;
  }
  const bitWidth = unsignedIntegerBitWidthForCoreTypeName(
    coreTypeName,
    isUsizeType(input.type) ? input.targetFacts.pointerWidthBits : undefined,
  );
  return wireIntegerEncodingFromLayoutMarker({
    layoutWireEndian: metadata?.layoutWireEndian,
    unsignedIntegerBitWidth: bitWidth,
  });
}

export function integerRangeForWireEncoding(encoding: WireIntegerEncoding): LayoutIntegerRange {
  if (encoding.kind === "byte") {
    return { minimum: 0n, maximum: 255n, provenance: "wireEncoding" };
  }
  const maximum = (1n << BigInt(encoding.bitWidth)) - 1n;
  return { minimum: 0n, maximum, provenance: "wireEncoding" };
}

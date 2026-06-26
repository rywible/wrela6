import type { MonoCheckedType } from "../mono/mono-hir";
import type { CoreTypeId, FieldId, TargetTypeId } from "../semantic/ids";
import type { WireIntegerEncoding, WireScalarEncoding, WireEndian } from "../shared/wire-layout";
import { wireScalarEncodingFromLayoutMarker } from "../shared/wire-layout";
import { unsignedIntegerBitWidthForPrimitiveSpec } from "../shared/layout-wire-marker";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { wireOwnerKey } from "./layout-owners";
import type { TargetWireReadHelperId } from "./ids";
import type {
  LayoutTypeKey,
  LayoutWireAggregateFieldFact,
  LayoutWireReadPolicy,
  LayoutWireReservedRange,
  LayoutWireTypeFact,
} from "./layout-program";
import type {
  LayoutPrimitiveTypeSpec,
  LayoutTargetSurface,
  LayoutWireReadHelperSpec,
} from "./target-layout";
import { layoutTypeKeyFromPrimitiveRef } from "./target-facts";

export interface ComputeWireTypeFactInput {
  readonly fieldId: FieldId;
  readonly type: MonoCheckedType;
  readonly target: LayoutTargetSurface;
  readonly sourceOrigin: string;
  readonly layoutWireEndian?: WireEndian;
  readonly wireEncoding?: WireScalarEncoding;
  readonly elementCountCanBeNonZero?: boolean;
  readonly readHelperId?: TargetWireReadHelperId;
  readonly targetProvidedAggregate?: {
    readonly fields: readonly LayoutWireAggregateFieldFact[];
    readonly reservedRanges?: readonly LayoutWireReservedRange[];
    readonly wireSizeBytes: bigint;
    readonly wireStrideBytes: bigint;
  };
}

export interface WireTypeFactValue {
  readonly wire: LayoutWireTypeFact;
  readonly readPolicy: LayoutWireReadPolicy;
}

function wireDiagnostic(
  fieldIdValue: FieldId,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  const ownerKey = String(wireOwnerKey(fieldIdValue));
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  });
}

function layoutTypeKeyFromMonoType(type: MonoCheckedType): LayoutTypeKey | undefined {
  switch (type.kind) {
    case "core":
      return { kind: "core", coreTypeId: type.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: type.targetTypeId };
    default:
      return undefined;
  }
}

function primitiveSpecForTypeKey(
  target: LayoutTargetSurface,
  typeKey: LayoutTypeKey,
): LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId> | undefined {
  switch (typeKey.kind) {
    case "core":
      return target.coreTypes.get(typeKey.coreTypeId);
    case "target":
      return target.targetTypes.get(typeKey.targetTypeId);
    default:
      return undefined;
  }
}

function isWireCompatiblePrimitive(
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): boolean {
  switch (spec.representation) {
    case "unsignedInteger":
    case "signedInteger":
    case "bool":
      return true;
    case "never":
    case "address":
    case "float":
    case "unit":
    case "opaqueScalar":
      return false;
    default: {
      const unreachable: never = spec.representation;
      return unreachable;
    }
  }
}

function signednessForRepresentation(
  representation: LayoutPrimitiveTypeSpec<CoreTypeId>["representation"],
): "signed" | "unsigned" | undefined {
  switch (representation) {
    case "unsignedInteger":
      return "unsigned";
    case "signedInteger":
      return "signed";
    case "bool":
      return "unsigned";
    default:
      return undefined;
  }
}

function encodingMatchesPrimitive(
  encoding: WireIntegerEncoding,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): boolean {
  if (encoding.kind === "byte") {
    return spec.bitWidth === 8 && signednessForRepresentation(spec.representation) === "unsigned";
  }
  if (spec.bitWidth === undefined) {
    return false;
  }
  if (encoding.bitWidth !== spec.bitWidth) {
    return false;
  }
  const expectedSignedness = signednessForRepresentation(spec.representation);
  if (expectedSignedness === undefined) {
    return false;
  }
  return encoding.signedness === expectedSignedness;
}

function resolveWireEncodingForLayoutField(input: {
  readonly type: MonoCheckedType;
  readonly layoutWireEndian?: WireEndian;
  readonly wireEncoding?: WireScalarEncoding;
  readonly spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>;
}): WireScalarEncoding | undefined {
  if (input.wireEncoding !== undefined) {
    return input.wireEncoding;
  }
  const unsignedIntegerBitWidth = unsignedIntegerBitWidthForPrimitiveSpec(input.spec);
  return wireScalarEncodingFromLayoutMarker({
    layoutWireEndian: input.layoutWireEndian,
    unsignedIntegerBitWidth,
  });
}

function normalizeScalarEncoding(
  wireEncoding: WireScalarEncoding | undefined,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): WireScalarEncoding | "missing" | "invalid" {
  const wireSizeBytes = spec.sizeBytes;
  const isSingleByte = wireSizeBytes === 1n;

  if (wireEncoding === undefined) {
    if (isSingleByte) {
      return { kind: "byte" };
    }
    return "missing";
  }

  switch (wireEncoding.kind) {
    case "byte":
      if (!isSingleByte) {
        return "invalid";
      }
      return wireEncoding;
    case "opaqueBytes":
      if (!isSingleByte) {
        return "invalid";
      }
      return wireEncoding;
    case "integer":
      if (!encodingMatchesPrimitive(wireEncoding, spec)) {
        return "invalid";
      }
      return wireEncoding;
    default: {
      const unreachable: never = wireEncoding;
      return unreachable;
    }
  }
}

function scalarEncodingForFact(encoding: WireScalarEncoding): WireScalarEncoding {
  if (encoding.kind === "byte") {
    return encoding;
  }
  if (encoding.kind === "opaqueBytes") {
    return encoding;
  }
  return encoding;
}

function encodingsMatch(left: WireScalarEncoding, right: WireScalarEncoding): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "byte":
    case "opaqueBytes":
      return true;
    case "integer":
      if (right.kind !== "integer") {
        return false;
      }
      return (
        left.endian === right.endian &&
        left.signedness === right.signedness &&
        left.bitWidth === right.bitWidth
      );
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}

function typeKeysMatch(left: LayoutTypeKey, right: LayoutTypeKey): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "core":
      return right.kind === "core" && String(left.coreTypeId) === String(right.coreTypeId);
    case "target":
      return right.kind === "target" && String(left.targetTypeId) === String(right.targetTypeId);
    case "source":
      return right.kind === "source" && String(left.instanceId) === String(right.instanceId);
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}

function findMatchingWireReadHelper(
  helpers: readonly LayoutWireReadHelperSpec[],
  encoding: WireScalarEncoding,
  resultType: LayoutTypeKey,
): LayoutWireReadHelperSpec | undefined {
  return helpers.find(
    (helper) =>
      encodingsMatch(helper.encoding, encoding) &&
      typeKeysMatch(layoutTypeKeyFromPrimitiveRef(helper.resultType), resultType),
  );
}

function selectReadPolicy(
  fieldIdValue: FieldId,
  target: LayoutTargetSurface,
  encoding: WireScalarEncoding,
  typeKey: LayoutTypeKey,
  wireSizeBytes: bigint,
  readHelperId: TargetWireReadHelperId | undefined,
): { readonly policy: LayoutWireReadPolicy } | { readonly error: LayoutDiagnostic } {
  const helpers = target.wireReadHelpers.entries();
  const selectedHelper =
    readHelperId !== undefined
      ? target.wireReadHelpers.get(readHelperId)
      : findMatchingWireReadHelper(helpers, encoding, typeKey);

  if (readHelperId !== undefined) {
    if (selectedHelper === undefined) {
      return {
        error: wireDiagnostic(fieldIdValue, {
          code: "LAYOUT_WIRE_HELPER_MISSING",
          message: "layout wire read helper is missing from the target surface",
          stableDetail: `helper:${String(readHelperId)}`,
        }),
      };
    }
    if (!encodingsMatch(selectedHelper.encoding, encoding)) {
      return {
        error: wireDiagnostic(fieldIdValue, {
          code: "LAYOUT_WIRE_HELPER_MISMATCH",
          message: "layout wire read helper encoding does not match the field wire encoding",
          stableDetail: `helper:${String(readHelperId)}:encoding`,
        }),
      };
    }
    if (!typeKeysMatch(layoutTypeKeyFromPrimitiveRef(selectedHelper.resultType), typeKey)) {
      return {
        error: wireDiagnostic(fieldIdValue, {
          code: "LAYOUT_WIRE_HELPER_MISMATCH",
          message: "layout wire read helper result type does not match the field layout type",
          stableDetail: `helper:${String(readHelperId)}:resultType`,
        }),
      };
    }
    return {
      policy: {
        alignment: "unalignedSafe",
        lowering: "targetProvided",
        helperId: selectedHelper.helperId,
      },
    };
  }

  if (selectedHelper !== undefined) {
    return {
      policy: {
        alignment: "unalignedSafe",
        lowering: "targetProvided",
        helperId: selectedHelper.helperId,
      },
    };
  }

  if (
    encoding.kind === "integer" &&
    wireSizeBytes > 1n &&
    encoding.endian === target.dataModel.endian
  ) {
    return {
      policy: {
        alignment: "unalignedSafe",
        lowering: "targetSafeUnalignedLoad",
      },
    };
  }

  return {
    policy: {
      alignment: "unalignedSafe",
      lowering: "bytewiseAssemble",
    },
  };
}

function wireError(
  fieldIdValue: FieldId,
  sourceOrigin: string | undefined,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
  },
): LayoutBuilderResult<WireTypeFactValue> {
  const ownerKey = wireOwnerKey(fieldIdValue);
  return {
    kind: "error",
    ownerKey,
    dependencies: [],
    diagnostics: [wireDiagnostic(fieldIdValue, { ...input, sourceOrigin })],
  };
}

export function computeWireTypeFact(
  input: ComputeWireTypeFactInput,
): LayoutBuilderResult<WireTypeFactValue> {
  const fieldIdValue = input.fieldId;
  const target = input.target;
  const sourceOrigin = input.sourceOrigin;
  const elementCountCanBeNonZero = input.elementCountCanBeNonZero ?? true;
  const ownerKey = wireOwnerKey(fieldIdValue);

  if (input.targetProvidedAggregate !== undefined) {
    const aggregate = input.targetProvidedAggregate;
    const typeKey = layoutTypeKeyFromMonoType(input.type);
    if (typeKey === undefined) {
      return wireError(fieldIdValue, sourceOrigin, {
        code: "LAYOUT_INVALID_WIRE_ENCODING",
        message: "layout wire aggregate field type is not wire compatible",
        stableDetail: "type:unsupported",
      });
    }

    if (aggregate.wireSizeBytes === 0n && elementCountCanBeNonZero) {
      return wireError(fieldIdValue, sourceOrigin, {
        code: "LAYOUT_ZERO_SIZED_WIRE_ELEMENT",
        message: "layout wire element size is zero while element count may be non-zero",
        stableDetail: "wireSizeBytes:0",
      });
    }

    const readPolicyResult = selectReadPolicy(
      fieldIdValue,
      target,
      input.wireEncoding ?? { kind: "opaqueBytes" },
      typeKey,
      aggregate.wireStrideBytes,
      input.readHelperId,
    );
    if ("error" in readPolicyResult) {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          {
            ...readPolicyResult.error,
            ownerKey: String(wireOwnerKey(fieldIdValue)),
            rootCauseKey: String(wireOwnerKey(fieldIdValue)),
          },
        ],
      };
    }

    return {
      kind: "ok",
      ownerKey,
      dependencies: [],
      value: {
        wire: {
          kind: "aggregate",
          type: typeKey,
          wireSizeBytes: aggregate.wireSizeBytes,
          wireStrideBytes: aggregate.wireStrideBytes,
          wireCompatible: true,
          fields: aggregate.fields,
          reservedRanges: aggregate.reservedRanges ?? [],
          reason: "targetProvided",
        },
        readPolicy: readPolicyResult.policy,
      },
      diagnostics: [],
    };
  }

  const typeKey = layoutTypeKeyFromMonoType(input.type);
  if (typeKey === undefined) {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_INVALID_WIRE_ENCODING",
      message: "layout wire field type is not a wire-compatible primitive",
      stableDetail: "type:unsupported",
    });
  }

  const spec = primitiveSpecForTypeKey(target, typeKey);
  if (spec === undefined) {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_INVALID_WIRE_ENCODING",
      message: "layout wire field primitive spec is missing",
      stableDetail: `type:${typeKey.kind}`,
    });
  }

  if (spec.sizeBytes === 0n && elementCountCanBeNonZero) {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_ZERO_SIZED_WIRE_ELEMENT",
      message: "layout wire element size is zero while element count may be non-zero",
      stableDetail: "wireSizeBytes:0",
    });
  }

  if (!isWireCompatiblePrimitive(spec)) {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_INVALID_WIRE_ENCODING",
      message: "layout wire field type is not wire compatible",
      stableDetail: `representation:${spec.representation}`,
    });
  }

  const resolvedEncoding = resolveWireEncodingForLayoutField({
    type: input.type,
    layoutWireEndian: input.layoutWireEndian,
    wireEncoding: input.wireEncoding,
    spec,
  });
  const normalizedEncoding = normalizeScalarEncoding(resolvedEncoding, spec);
  if (normalizedEncoding === "missing") {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_MISSING_WIRE_ENCODING",
      message: "layout wire field requires an explicit wire encoding",
      stableDetail: `bitWidth:${String(spec.bitWidth ?? spec.sizeBytes * 8n)}`,
    });
  }
  if (normalizedEncoding === "invalid") {
    return wireError(fieldIdValue, sourceOrigin, {
      code: "LAYOUT_INVALID_WIRE_ENCODING",
      message: "layout wire field encoding does not match the primitive wire width or signedness",
      stableDetail: `bitWidth:${String(spec.bitWidth ?? spec.sizeBytes * 8n)}`,
    });
  }

  const readPolicyResult = selectReadPolicy(
    fieldIdValue,
    target,
    normalizedEncoding,
    typeKey,
    spec.sizeBytes,
    input.readHelperId,
  );
  if ("error" in readPolicyResult) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        {
          ...readPolicyResult.error,
          ownerKey: String(wireOwnerKey(fieldIdValue)),
          rootCauseKey: String(wireOwnerKey(fieldIdValue)),
        },
      ],
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      wire: {
        kind: "scalar",
        type: typeKey,
        scalarEncoding: scalarEncodingForFact(normalizedEncoding),
        wireSizeBytes: spec.sizeBytes,
        wireStrideBytes: spec.sizeBytes,
        wireCompatible: true,
        reason: "scalar",
      },
      readPolicy: readPolicyResult.policy,
    },
    diagnostics: [],
  };
}

import {
  computeSourceAggregateLayout,
  type ComputeSourceAggregateNestedType,
} from "./aggregate-layout";
import type { LayoutBuilderResult } from "./builder-context";
import { enumLayoutDiagnostic } from "./enum-layout-diagnostics";
import { sourceTypeCacheKey } from "./layout-fact-builder-support";
import { enumLayoutOwnerKey } from "./layout-owners";
import type {
  LayoutEnumCaseFact,
  LayoutEnumPayloadFieldFact,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type {
  LayoutPrimitiveKind,
  LayoutPrimitiveTypeSpec,
  LayoutTargetSurface,
} from "./target-layout";
import type { MonoFieldRecord } from "../mono/mono-hir";
import type { CoreTypeId, FieldId, TargetTypeId } from "../semantic/ids";

export interface EnumLayoutCaseInput extends LayoutEnumCaseFact {
  readonly payloadFieldIds: readonly FieldId[];
}

export interface EnumPayloadLayoutValue {
  readonly fields: readonly LayoutEnumPayloadFieldFact[];
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}

function alignUp(sizeBytes: bigint, alignmentBytes: bigint): bigint {
  if (sizeBytes === 0n) {
    return 0n;
  }
  return ((sizeBytes + alignmentBytes - 1n) / alignmentBytes) * alignmentBytes;
}

function payloadTypeKey(
  field: MonoFieldRecord,
  resolver: LayoutTypeResolver | undefined,
): LayoutTypeKey | undefined {
  switch (field.type.kind) {
    case "core":
      return { kind: "core", coreTypeId: field.type.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: field.type.targetTypeId };
    default:
      return resolver?.get(field.type);
  }
}

function primitiveSpecForTypeKey(
  target: LayoutTargetSurface,
  key: LayoutTypeKey,
): LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId> | undefined {
  switch (key.kind) {
    case "core":
      return target.coreTypes.get(key.coreTypeId);
    case "target":
      return target.targetTypes.get(key.targetTypeId);
    case "source":
      return undefined;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function primitivePayloadTypeFact(
  key: LayoutTypeKey,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): LayoutTypeFact {
  return {
    key,
    sizeBytes: spec.sizeBytes,
    alignmentBytes: spec.alignmentBytes,
    strideBytes: alignUp(spec.sizeBytes, spec.alignmentBytes),
    representation: primitivePayloadRepresentation(spec.representation, spec.sizeBytes),
  };
}

function primitivePayloadRepresentation(
  representation: LayoutPrimitiveKind,
  sizeBytes: bigint,
): LayoutTypeFact["representation"] {
  if (representation === "never") return { kind: "never" };
  if (sizeBytes === 0n) return { kind: "zeroSized", reason: "unit" };
  return { kind: "primitive", primitive: representation };
}

function layoutFactForPayloadType(input: {
  readonly type: LayoutTypeKey;
  readonly target: LayoutTargetSurface;
  readonly typeFacts?: LayoutTypeFactTable;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
  readonly targetFacts?: TargetLayoutFacts;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
}): LayoutTypeFact | undefined {
  const existing =
    input.precomputedTypeFacts?.get(sourceTypeCacheKey(input.type)) ??
    input.typeFacts?.get(input.type);
  if (existing !== undefined) return existing;

  const primitiveSpec = primitiveSpecForTypeKey(input.target, input.type);
  if (primitiveSpec !== undefined) {
    return primitivePayloadTypeFact(input.type, primitiveSpec);
  }
  if (input.type.kind !== "source") {
    return undefined;
  }

  const sourceType = input.type;
  if (
    input.targetFacts === undefined ||
    input.typeFacts === undefined ||
    input.sourceTypeKeys === undefined
  ) {
    return undefined;
  }

  const nested = input.nestedSourceTypes?.find(
    (candidate) => candidate.instanceId === sourceType.instanceId,
  );
  if (nested === undefined) {
    return undefined;
  }

  const result = computeSourceAggregateLayout({
    owner: sourceType,
    sourceKind: nested.sourceKind,
    fields: nested.fields,
    targetFacts: input.targetFacts,
    primitiveFacts: input.typeFacts,
    nestedSourceTypes: input.nestedSourceTypes,
    sourceTypeKeys: input.sourceTypeKeys,
    sourceOrigin: nested.sourceOrigin ?? `type:${String(nested.instanceId)}`,
    precomputedTypeFacts: input.precomputedTypeFacts,
  });
  return result.kind === "ok" ? result.value.typeFact : undefined;
}

function enumPayloadFields(input: {
  readonly fields: readonly MonoFieldRecord[];
  readonly target: LayoutTargetSurface;
  readonly payloadOffsetBytes: bigint;
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly typeResolver?: LayoutTypeResolver;
  readonly typeFacts?: LayoutTypeFactTable;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
  readonly targetFacts?: TargetLayoutFacts;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
}): LayoutBuilderResult<EnumPayloadLayoutValue> {
  let offset = input.payloadOffsetBytes;
  let maximumAlignmentBytes = 1n;
  const fields: LayoutEnumPayloadFieldFact[] = [];

  for (const field of input.fields) {
    const type = payloadTypeKey(field, input.typeResolver);
    const layout =
      type === undefined
        ? undefined
        : layoutFactForPayloadType({
            type,
            target: input.target,
            typeFacts: input.typeFacts,
            precomputedTypeFacts: input.precomputedTypeFacts,
            targetFacts: input.targetFacts,
            nestedSourceTypes: input.nestedSourceTypes,
            sourceTypeKeys: input.sourceTypeKeys,
          });
    if (type === undefined || layout === undefined) {
      const ownerKey = enumLayoutOwnerKey(input.owner.instanceId);
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(input.owner.instanceId), {
            code:
              type === undefined
                ? "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION"
                : "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
            message:
              type === undefined
                ? "layout enum payload field type is not resolved to a layout key"
                : "layout enum payload field type has no layout fact",
            stableDetail:
              type === undefined
                ? `payload-field:${field.name}:type:${field.type.kind}`
                : `payload-field:${field.name}:layout:${sourceTypeCacheKey(type)}`,
            sourceOrigin: field.sourceOrigin,
          }),
        ],
      };
    }

    const fieldOffset = alignUp(offset, layout.alignmentBytes);
    fields.push({
      fieldId: field.fieldId,
      name: field.name,
      type,
      offsetBytes: fieldOffset,
      sizeBytes: layout.sizeBytes,
      alignmentBytes: layout.alignmentBytes,
      sourceOrigin: field.sourceOrigin,
    });
    maximumAlignmentBytes =
      layout.alignmentBytes > maximumAlignmentBytes ? layout.alignmentBytes : maximumAlignmentBytes;
    offset = fieldOffset + layout.sizeBytes;
  }

  return {
    kind: "ok",
    ownerKey: enumLayoutOwnerKey(input.owner.instanceId),
    dependencies: [],
    diagnostics: [],
    value: {
      fields,
      sizeBytes: offset - input.payloadOffsetBytes,
      alignmentBytes: maximumAlignmentBytes,
    },
  };
}

export function enumPayloadFieldsForCase(input: {
  readonly caseFact: EnumLayoutCaseInput;
  readonly fieldsById: ReadonlyMap<FieldId, MonoFieldRecord>;
  readonly target: LayoutTargetSurface;
  readonly payloadOffsetBytes: bigint;
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly typeResolver?: LayoutTypeResolver;
  readonly typeFacts?: LayoutTypeFactTable;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
  readonly targetFacts?: TargetLayoutFacts;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
}): LayoutBuilderResult<EnumPayloadLayoutValue> {
  const fields: MonoFieldRecord[] = [];
  for (const fieldId of input.caseFact.payloadFieldIds) {
    const field = input.fieldsById.get(fieldId);
    if (field === undefined) {
      return {
        kind: "error",
        ownerKey: enumLayoutOwnerKey(input.owner.instanceId),
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(input.owner.instanceId), {
            code: "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
            message: "layout enum case references a missing payload field",
            stableDetail: `enum-case:${input.caseFact.name}:missing-field:${String(fieldId)}`,
            sourceOrigin: input.caseFact.sourceOrigin,
          }),
        ],
      };
    }
    fields.push(field);
  }
  return enumPayloadFields({
    fields,
    target: input.target,
    payloadOffsetBytes: input.payloadOffsetBytes,
    owner: input.owner,
    typeResolver: input.typeResolver,
    typeFacts: input.typeFacts,
    precomputedTypeFacts: input.precomputedTypeFacts,
    targetFacts: input.targetFacts,
    nestedSourceTypes: input.nestedSourceTypes,
    sourceTypeKeys: input.sourceTypeKeys,
  });
}

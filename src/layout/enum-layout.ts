import type { LayoutBuilderResult } from "./builder-context";
import type { ComputeSourceAggregateNestedType } from "./aggregate-layout";
import { enumLayoutDiagnostic, FIXTURE_ENUM_SOURCE_ORIGIN } from "./enum-layout-diagnostics";
import { enumPayloadFieldsForCase, type EnumLayoutCaseInput } from "./enum-payload-layout";
import type {
  LayoutEnumCaseFact,
  LayoutEnumFact,
  LayoutFieldFact,
  TargetLayoutFacts,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
} from "./layout-program";
import type {
  LayoutPrimitiveTypeRef,
  LayoutPrimitiveTypeSpec,
  LayoutTargetSurface,
} from "./target-layout";
import type { MonoTypeInstance } from "../mono/mono-hir";
import type { CoreTypeId, TargetTypeId } from "../semantic/ids";
import { itemId } from "../semantic/ids";
import { monoInstanceId } from "../mono/ids";
import { enumLayoutOwnerKey } from "./layout-owners";
import type { LayoutTypeResolver } from "./layout-type-resolver";

export interface ComputeEnumLayoutInput {
  readonly cases: readonly string[];
  readonly candidateTagTypes: readonly CoreTypeId[] | readonly LayoutPrimitiveTypeRef[];
  readonly discriminantStart: bigint;
  readonly target: LayoutTargetSurface;
  readonly typeInstance?: MonoTypeInstance;
  readonly owner?: LayoutTypeKey & { readonly kind: "source" };
  readonly typeResolver?: LayoutTypeResolver;
  readonly typeFacts?: LayoutTypeFactTable;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
  readonly targetFacts?: TargetLayoutFacts;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
}

export interface ComputeEnumLayoutValue {
  readonly enumFact: LayoutEnumFact;
  readonly typeFact: LayoutTypeFact;
  readonly fieldFacts: readonly LayoutFieldFact[];
}

function alignUp(sizeBytes: bigint, alignmentBytes: bigint): bigint {
  if (sizeBytes === 0n) {
    return 0n;
  }
  return ((sizeBytes + alignmentBytes - 1n) / alignmentBytes) * alignmentBytes;
}

function normalizeCandidateTagType(
  candidate: CoreTypeId | LayoutPrimitiveTypeRef,
): LayoutPrimitiveTypeRef {
  if (typeof candidate === "object" && "kind" in candidate) {
    return candidate;
  }
  return { kind: "core", coreTypeId: candidate };
}

function layoutTypeKeyFromRef(ref: LayoutPrimitiveTypeRef): LayoutTypeKey {
  switch (ref.kind) {
    case "core":
      return { kind: "core", coreTypeId: ref.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: ref.targetTypeId };
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

function primitiveSpecForRef(
  target: LayoutTargetSurface,
  ref: LayoutPrimitiveTypeRef,
): LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId> | undefined {
  switch (ref.kind) {
    case "core":
      return target.coreTypes.get(ref.coreTypeId);
    case "target":
      return target.targetTypes.get(ref.targetTypeId);
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

function unsignedMaximumForBitWidth(bitWidth: number): bigint {
  return (1n << BigInt(bitWidth)) - 1n;
}

function syntheticEnumCases(
  owner: LayoutTypeKey & { readonly kind: "source" },
  caseNames: readonly string[],
): readonly EnumLayoutCaseInput[] {
  return caseNames.map((name, ordinal) => ({
    itemId: itemId(ordinal + 1),
    name,
    ordinal,
    discriminant: 0n,
    payloadFieldIds: [],
    sourceOrigin: FIXTURE_ENUM_SOURCE_ORIGIN,
  }));
}

function enumCasesFromTypeInstance(typeInstance: MonoTypeInstance): readonly EnumLayoutCaseInput[] {
  return [...typeInstance.enumCases]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((caseRecord) => ({
      itemId: caseRecord.caseItemId,
      name: caseRecord.name,
      ordinal: caseRecord.ordinal,
      discriminant: 0n,
      payloadFieldIds: Object.freeze([...caseRecord.payloadFieldIds]),
      sourceOrigin: caseRecord.sourceOrigin,
    }));
}

export function computeEnumLayout(
  input: ComputeEnumLayoutInput,
): LayoutBuilderResult<ComputeEnumLayoutValue> {
  const owner =
    input.owner ??
    (input.typeInstance !== undefined
      ? ({ kind: "source", instanceId: input.typeInstance.instanceId } as const)
      : ({ kind: "source", instanceId: monoInstanceId("type:Enum") } as const));
  const ownerKey = enumLayoutOwnerKey(owner.instanceId);
  const sourceOrigin =
    input.typeInstance?.sourceOrigin ??
    input.owner?.instanceId.toString() ??
    FIXTURE_ENUM_SOURCE_ORIGIN;

  if (input.typeInstance !== undefined) {
    if (input.typeInstance.sourceKind !== "enum") {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(owner.instanceId), {
            code: "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
            message: "layout enum facts require a fieldless enum type instance",
            stableDetail: `sourceKind:${input.typeInstance.sourceKind}`,
            sourceOrigin: input.typeInstance.sourceOrigin,
          }),
        ],
      };
    }
  }

  const caseFacts =
    input.typeInstance !== undefined
      ? enumCasesFromTypeInstance(input.typeInstance)
      : syntheticEnumCases(owner, input.cases);

  if (caseFacts.length === 0) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        enumLayoutDiagnostic(String(owner.instanceId), {
          code: "LAYOUT_EMPTY_ENUM_REJECTED",
          message: "layout rejects empty source enums",
          stableDetail: "cases:empty",
          sourceOrigin,
        }),
      ],
    };
  }

  if (input.discriminantStart < 0n) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        enumLayoutDiagnostic(String(owner.instanceId), {
          code: "LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START",
          message: "layout enum discriminant start must be non-negative",
          stableDetail: `discriminantStart:${input.discriminantStart.toString()}`,
          sourceOrigin,
        }),
      ],
    };
  }

  const candidateTagTypes = input.candidateTagTypes.map(normalizeCandidateTagType);
  for (const candidate of candidateTagTypes) {
    const spec = primitiveSpecForRef(input.target, candidate);
    if (spec !== undefined && spec.representation !== "unsignedInteger") {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(owner.instanceId), {
            code: "LAYOUT_INVALID_ENUM_POLICY",
            message: "layout enum candidate tag type must be an unsigned integer primitive",
            stableDetail: `candidate:${String(spec.id)}:${spec.representation}`,
            sourceOrigin,
          }),
        ],
      };
    }
  }

  const sizeTypeSpec = primitiveSpecForRef(input.target, input.target.dataModel.sizeType);
  const sizeTypeMaximum =
    sizeTypeSpec?.bitWidth !== undefined
      ? unsignedMaximumForBitWidth(sizeTypeSpec.bitWidth)
      : input.target.dataModel.maximumObjectSizeBytes;

  const assignedCases: EnumLayoutCaseInput[] = [];
  let minimumDiscriminant: bigint | undefined;
  let maximumDiscriminant: bigint | undefined;

  for (const caseFact of caseFacts) {
    const discriminant = input.discriminantStart + BigInt(caseFact.ordinal);
    if (discriminant > sizeTypeMaximum) {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(owner.instanceId), {
            code: "LAYOUT_ENUM_DISCRIMINANT_OVERFLOW",
            message: "layout enum discriminant overflowed the target size type",
            stableDetail: `discriminant:${discriminant.toString()}:sizeTypeMaximum:${sizeTypeMaximum.toString()}`,
            sourceOrigin: caseFact.sourceOrigin,
          }),
        ],
      };
    }

    minimumDiscriminant =
      minimumDiscriminant === undefined
        ? discriminant
        : discriminant < minimumDiscriminant
          ? discriminant
          : minimumDiscriminant;
    maximumDiscriminant =
      maximumDiscriminant === undefined
        ? discriminant
        : discriminant > maximumDiscriminant
          ? discriminant
          : maximumDiscriminant;

    assignedCases.push({
      ...caseFact,
      discriminant,
    });
  }

  const minimum = minimumDiscriminant ?? 0n;
  const maximum = maximumDiscriminant ?? 0n;

  let selectedTagType: LayoutTypeKey | undefined;
  let tagSpec:
    | LayoutPrimitiveTypeSpec<CoreTypeId>
    | LayoutPrimitiveTypeSpec<TargetTypeId>
    | undefined;
  for (const candidate of candidateTagTypes) {
    const spec = primitiveSpecForRef(input.target, candidate);
    if (spec === undefined || spec.bitWidth === undefined) {
      continue;
    }
    if (spec.representation !== "unsignedInteger") {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          enumLayoutDiagnostic(String(owner.instanceId), {
            code: "LAYOUT_INVALID_ENUM_POLICY",
            message: "layout enum candidate tag type must be an unsigned integer primitive",
            stableDetail: `candidate:${String(spec.id)}:${spec.representation}`,
            sourceOrigin,
          }),
        ],
      };
    }
    const candidateMaximum = unsignedMaximumForBitWidth(spec.bitWidth);
    if (minimum >= 0n && maximum <= candidateMaximum) {
      selectedTagType = layoutTypeKeyFromRef(candidate);
      tagSpec = spec;
      break;
    }
  }

  if (selectedTagType === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        enumLayoutDiagnostic(String(owner.instanceId), {
          code: "LAYOUT_ENUM_DISCRIMINANT_OVERFLOW",
          message: "layout enum discriminants do not fit any candidate tag type",
          stableDetail: `minimum:${minimum.toString()}:maximum:${maximum.toString()}`,
          sourceOrigin,
        }),
      ],
    };
  }

  if (tagSpec === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        enumLayoutDiagnostic(String(owner.instanceId), {
          code: "LAYOUT_ENUM_DISCRIMINANT_OVERFLOW",
          message: "layout enum tag type primitive spec is missing",
          stableDetail: "tagType:missing",
          sourceOrigin,
        }),
      ],
    };
  }

  const fieldsById = new Map(
    (input.typeInstance?.fields ?? []).map((field) => [field.fieldId, field] as const),
  );
  const payloadOffsetBytes = assignedCases.some((caseFact) => caseFact.payloadFieldIds.length > 0)
    ? tagSpec.sizeBytes
    : undefined;
  let maximumPayloadSizeBytes = 0n;
  let maximumPayloadAlignmentBytes = 1n;
  const casesWithPayload: LayoutEnumCaseFact[] = [];
  const fieldFacts: LayoutFieldFact[] = [];
  let payloadFieldIndex = 0;
  for (const caseFact of assignedCases) {
    if (payloadOffsetBytes === undefined || caseFact.payloadFieldIds.length === 0) {
      const { payloadFieldIds: _payloadFieldIds, ...layoutCase } = caseFact;
      void _payloadFieldIds;
      casesWithPayload.push(layoutCase);
      continue;
    }
    const payloadLayout = enumPayloadFieldsForCase({
      caseFact,
      fieldsById,
      target: input.target,
      payloadOffsetBytes,
      owner,
      typeResolver: input.typeResolver,
      typeFacts: input.typeFacts,
      precomputedTypeFacts: input.precomputedTypeFacts,
      targetFacts: input.targetFacts,
      nestedSourceTypes: input.nestedSourceTypes,
      sourceTypeKeys: input.sourceTypeKeys,
    });
    if (payloadLayout.kind === "error") return payloadLayout;
    maximumPayloadSizeBytes =
      payloadLayout.value.sizeBytes > maximumPayloadSizeBytes
        ? payloadLayout.value.sizeBytes
        : maximumPayloadSizeBytes;
    maximumPayloadAlignmentBytes =
      payloadLayout.value.alignmentBytes > maximumPayloadAlignmentBytes
        ? payloadLayout.value.alignmentBytes
        : maximumPayloadAlignmentBytes;
    const { payloadFieldIds: _payloadFieldIds, ...layoutCase } = caseFact;
    void _payloadFieldIds;
    let previousPayloadFieldEnd = payloadOffsetBytes;
    for (const payloadField of payloadLayout.value.fields) {
      fieldFacts.push({
        owner,
        fieldId: payloadField.fieldId,
        fieldName: payloadField.name,
        fieldType: payloadField.type,
        offsetBytes: payloadField.offsetBytes,
        sizeBytes: payloadField.sizeBytes,
        alignmentBytes: payloadField.alignmentBytes,
        index: payloadFieldIndex,
        paddingBeforeBytes: payloadField.offsetBytes - previousPayloadFieldEnd,
        sourceOrigin: payloadField.sourceOrigin,
      });
      payloadFieldIndex += 1;
      previousPayloadFieldEnd = payloadField.offsetBytes + payloadField.sizeBytes;
    }
    casesWithPayload.push({
      ...layoutCase,
      payloadOffsetBytes,
      payloadFields: payloadLayout.value.fields,
    });
  }

  const enumFact: LayoutEnumFact = {
    owner,
    tagType: selectedTagType,
    tagOffsetBytes: 0n,
    cases: casesWithPayload,
    sourceOrigin,
  };

  const payloadEndBytes =
    payloadOffsetBytes !== undefined
      ? payloadOffsetBytes + maximumPayloadSizeBytes
      : tagSpec.sizeBytes;
  const enumAlignment =
    maximumPayloadAlignmentBytes > tagSpec.alignmentBytes
      ? maximumPayloadAlignmentBytes
      : tagSpec.alignmentBytes;
  const enumSizeBytes = alignUp(payloadEndBytes, enumAlignment);

  const typeFact: LayoutTypeFact = {
    key: owner,
    sizeBytes: enumSizeBytes,
    alignmentBytes: enumAlignment,
    strideBytes: alignUp(enumSizeBytes, enumAlignment),
    representation: { kind: "enum" },
    sourceOrigin,
  };

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: { enumFact, typeFact, fieldFacts },
    diagnostics: [],
  };
}

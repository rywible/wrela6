import { monoInstanceId, type MonoInstanceId } from "../mono/ids";
import type { FieldId } from "../semantic/ids";
import { fieldId } from "../semantic/ids";
import type { SourceItemKind } from "../semantic/item-index/item-records";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { typeLayoutOwnerKey } from "./layout-owners";
import type {
  LayoutAggregateStorageFact,
  LayoutFieldFact,
  LayoutPaddingRange,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  LayoutTypeRepresentation,
  TargetLayoutFacts,
} from "./layout-program";
import type { LayoutTargetSurface } from "./target-layout";
import { seedPrimitiveTypeFacts } from "./primitive-layout";
import { layoutDeterministicTable, layoutFieldKeyString } from "./type-key";

const UNSUPPORTED_SOURCE_KINDS = new Set<SourceItemKind>([
  "interface",
  "image",
  "function",
  "enumCase",
  "validatedBuffer",
]);

export function layoutUnsupportedSourceKindDiagnosticCode(
  sourceKind: SourceItemKind,
): "LAYOUT_UNSUPPORTED_INTERFACE_VALUE" | "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION" {
  return sourceKind === "interface"
    ? "LAYOUT_UNSUPPORTED_INTERFACE_VALUE"
    : "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION";
}

export interface ComputeSourceAggregateLayoutField {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly type: CheckedType;
  readonly sourceOrigin?: string;
}

export interface ComputeSourceAggregateNestedType {
  readonly instanceId: MonoInstanceId;
  readonly sourceKind: SourceItemKind;
  readonly fields: readonly ComputeSourceAggregateLayoutField[];
  readonly sourceOrigin?: string;
}

export interface ComputeSourceAggregateLayoutInput {
  readonly fields: readonly ComputeSourceAggregateLayoutField[];
  readonly target?: LayoutTargetSurface;
  readonly targetFacts?: TargetLayoutFacts;
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly sourceKind: SourceItemKind;
  readonly sourceOrigin: string;
  readonly primitiveFacts?: LayoutTypeFactTable;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
}

export interface SourceAggregateLayoutValue {
  readonly typeFact: LayoutTypeFact;
  readonly fieldFacts: readonly LayoutFieldFact[];
}

export function alignLayoutBytes(sizeBytes: bigint, alignmentBytes: bigint): bigint {
  if (sizeBytes === 0n) {
    return 0n;
  }
  if (alignmentBytes <= 0n) {
    return sizeBytes;
  }
  const remainder = sizeBytes % alignmentBytes;
  if (remainder === 0n) {
    return sizeBytes;
  }
  return sizeBytes + (alignmentBytes - remainder);
}

export function resolveCheckedTypeToLayoutKey(
  type: CheckedType,
  sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>,
): LayoutTypeKey | undefined {
  switch (type.kind) {
    case "core":
      return { kind: "core", coreTypeId: type.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: type.targetTypeId };
    case "source": {
      const fingerprint = checkedTypeFingerprint(type);
      const mapped = sourceTypeKeys?.get(fingerprint);
      if (mapped !== undefined) {
        return mapped;
      }
      return { kind: "source", instanceId: monoInstanceId(`source:${type.typeId}`) };
    }
    case "applied": {
      if (type.constructor.kind === "core") {
        return { kind: "core", coreTypeId: type.constructor.coreTypeId };
      }
      if (type.constructor.kind === "target") {
        return { kind: "target", targetTypeId: type.constructor.targetTypeId };
      }
      if (type.constructor.kind === "source") {
        const fingerprint = checkedTypeFingerprint(type);
        const mapped = sourceTypeKeys?.get(fingerprint);
        if (mapped !== undefined) {
          return mapped;
        }
        return undefined;
      }
      return undefined;
    }
    case "genericParameter":
    case "error":
      return undefined;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function aggregateTypeDiagnostic(
  instanceId: MonoInstanceId,
  code: string,
  message: string,
  stableDetail: string,
  sourceOrigin?: string,
): LayoutDiagnostic {
  const ownerKey = String(typeLayoutOwnerKey(instanceId));
  return layoutDiagnostic({
    severity: "error",
    code,
    message,
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail,
    ...(sourceOrigin !== undefined ? { sourceOrigin } : {}),
  });
}

function isCapabilitySourceKind(sourceKind: SourceItemKind): boolean {
  return sourceKind === "edgeClass" || sourceKind === "stream";
}

function zeroSizedRepresentation(sourceKind: SourceItemKind): LayoutTypeRepresentation {
  if (isCapabilitySourceKind(sourceKind)) {
    return { kind: "zeroSized", reason: "capabilityToken" };
  }
  return { kind: "zeroSized", reason: "emptyAggregate" };
}

interface AggregateLayoutContext {
  readonly targetFacts: TargetLayoutFacts;
  readonly primitiveFacts: LayoutTypeFactTable;
  readonly nestedSourceTypes: ReadonlyMap<string, ComputeSourceAggregateNestedType>;
  readonly sourceTypeKeys?: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
  readonly computedFacts: Map<string, LayoutTypeFact>;
  readonly activeStack: Set<string>;
}

function layoutTypeKeyCacheKey(key: LayoutTypeKey): string {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}`;
    case "core":
      return `core:${String(key.coreTypeId)}`;
    case "target":
      return `target:${String(key.targetTypeId)}`;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function exceedsMaximum(value: bigint, maximum: bigint): boolean {
  return value > maximum;
}

function computeNestedSourceLayout(
  nested: ComputeSourceAggregateNestedType,
  context: AggregateLayoutContext,
): LayoutBuilderResult<AggregateLayoutComputation> {
  const owner: LayoutTypeKey & { readonly kind: "source" } = {
    kind: "source",
    instanceId: nested.instanceId,
  };
  return computeSourceAggregateLayoutInternal({
    owner,
    sourceKind: nested.sourceKind,
    fields: nested.fields,
    targetFacts: context.targetFacts,
    primitiveFacts: context.primitiveFacts,
    sourceTypeKeys: context.sourceTypeKeys,
    sourceOrigin: nested.sourceOrigin ?? `type:${String(nested.instanceId)}`,
    context,
  });
}

function layoutForTypeKey(
  key: LayoutTypeKey,
  context: AggregateLayoutContext,
  ownerInstanceId: MonoInstanceId,
  sourceOrigin: string,
): { readonly layout?: LayoutTypeFact; readonly diagnostics: readonly LayoutDiagnostic[] } {
  if (key.kind === "core" || key.kind === "target") {
    const layout = context.primitiveFacts.get(key);
    if (layout === undefined) {
      return {
        diagnostics: [
          aggregateTypeDiagnostic(
            ownerInstanceId,
            "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
            "Field type has no layout fact.",
            layoutTypeKeyCacheKey(key),
            sourceOrigin,
          ),
        ],
      };
    }
    return { layout, diagnostics: [] };
  }

  const cacheKey = layoutTypeKeyCacheKey(key);
  const cached = context.computedFacts.get(cacheKey);
  if (cached !== undefined) {
    return { layout: cached, diagnostics: [] };
  }

  if (context.activeStack.has(cacheKey)) {
    return {
      diagnostics: [
        aggregateTypeDiagnostic(
          key.instanceId,
          "LAYOUT_RECURSIVE_TYPE_LAYOUT",
          "Source type layout depends on itself by value.",
          cacheKey,
          sourceOrigin,
        ),
      ],
    };
  }

  const nested = context.nestedSourceTypes.get(String(key.instanceId));
  if (nested === undefined) {
    return {
      diagnostics: [
        aggregateTypeDiagnostic(
          ownerInstanceId,
          "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
          "Field source type layout is not available.",
          cacheKey,
          sourceOrigin,
        ),
      ],
    };
  }

  const nestedResult = computeNestedSourceLayout(nested, context);

  if (nestedResult.kind === "error") {
    return { diagnostics: nestedResult.diagnostics };
  }

  context.computedFacts.set(cacheKey, nestedResult.value.typeFact);
  return { layout: nestedResult.value.typeFact, diagnostics: nestedResult.diagnostics };
}

function validateFieldTypeLayout(
  fieldType: CheckedType,
  fieldLayout: LayoutTypeFact,
  ownerInstanceId: MonoInstanceId,
  fieldName: string,
  sourceOrigin: string,
): readonly LayoutDiagnostic[] {
  if (fieldLayout.representation.kind === "never") {
    return [
      aggregateTypeDiagnostic(
        ownerInstanceId,
        "LAYOUT_FORBIDDEN_NEVER_STORAGE",
        `Field '${fieldName}' stores forbidden Never type.`,
        fieldName,
        sourceOrigin,
      ),
    ];
  }

  if (fieldType.kind === "genericParameter" || fieldType.kind === "error") {
    return [
      aggregateTypeDiagnostic(
        ownerInstanceId,
        "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
        `Field '${fieldName}' has unsupported type representation.`,
        checkedTypeFingerprint(fieldType),
        sourceOrigin,
      ),
    ];
  }

  return [];
}

function buildFieldFacts(input: {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly fields: readonly ComputeSourceAggregateLayoutField[];
  readonly sourceOrigin: string;
  readonly context: AggregateLayoutContext;
}): {
  readonly fieldFacts: readonly LayoutFieldFact[];
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const diagnostics: LayoutDiagnostic[] = [];
  const paddingRanges: LayoutPaddingRange[] = [];
  const transitivePaddingRanges: LayoutPaddingRange[] = [];
  const fieldFacts: LayoutFieldFact[] = [];

  let offset = 0n;
  let aggregateAlignment = 1n;

  for (const [index, field] of input.fields.entries()) {
    const fieldSourceOrigin = field.sourceOrigin ?? input.sourceOrigin;
    const fieldTypeKey = resolveCheckedTypeToLayoutKey(field.type, input.context.sourceTypeKeys);
    if (fieldTypeKey === undefined) {
      diagnostics.push(
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
          `Field '${field.name}' has unsupported type representation.`,
          checkedTypeFingerprint(field.type),
          fieldSourceOrigin,
        ),
      );
      continue;
    }

    const layoutResult = layoutForTypeKey(
      fieldTypeKey,
      input.context,
      input.owner.instanceId,
      fieldSourceOrigin,
    );
    diagnostics.push(...layoutResult.diagnostics);
    const fieldLayout = layoutResult.layout;
    if (fieldLayout === undefined) {
      continue;
    }

    const fieldTypeDiagnostics = validateFieldTypeLayout(
      field.type,
      fieldLayout,
      input.owner.instanceId,
      field.name,
      fieldSourceOrigin,
    );
    diagnostics.push(...fieldTypeDiagnostics);
    if (fieldTypeDiagnostics.length > 0) {
      continue;
    }

    if (fieldLayout.alignmentBytes > input.context.targetFacts.maximumAlignmentBytes) {
      diagnostics.push(
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          "LAYOUT_FIELD_ALIGNMENT_OVERFLOW",
          `Field '${field.name}' alignment exceeds target maximum.`,
          field.name,
          fieldSourceOrigin,
        ),
      );
      continue;
    }

    const fieldOffset = alignLayoutBytes(offset, fieldLayout.alignmentBytes);
    const paddingBefore = fieldOffset - offset;
    if (paddingBefore > 0n) {
      const interFieldPadding: LayoutPaddingRange = {
        offsetBytes: offset,
        sizeBytes: paddingBefore,
        kind: "interField",
      };
      paddingRanges.push(interFieldPadding);
      transitivePaddingRanges.push(interFieldPadding);
    }

    for (const nestedPadding of fieldLayout.aggregateStorage?.transitivePaddingRanges ?? []) {
      transitivePaddingRanges.push({
        offsetBytes: fieldOffset + nestedPadding.offsetBytes,
        sizeBytes: nestedPadding.sizeBytes,
        kind: nestedPadding.kind,
      });
    }

    if (exceedsMaximum(fieldOffset, input.context.targetFacts.maximumObjectSizeBytes)) {
      diagnostics.push(
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
          "Aggregate field offset exceeds target maximum object size.",
          field.name,
          fieldSourceOrigin,
        ),
      );
      continue;
    }

    const fieldEnd = fieldOffset + fieldLayout.sizeBytes;
    if (exceedsMaximum(fieldEnd, input.context.targetFacts.maximumObjectSizeBytes)) {
      diagnostics.push(
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
          "Aggregate field end exceeds target maximum object size.",
          field.name,
          fieldSourceOrigin,
        ),
      );
      continue;
    }

    fieldFacts.push({
      owner: input.owner,
      fieldId: field.fieldId ?? fieldId(index + 1),
      fieldName: field.name,
      fieldType: fieldTypeKey,
      offsetBytes: fieldOffset,
      sizeBytes: fieldLayout.sizeBytes,
      alignmentBytes: fieldLayout.alignmentBytes,
      index,
      paddingBeforeBytes: paddingBefore,
      sourceOrigin: fieldSourceOrigin,
    });

    offset = fieldEnd;
    if (fieldLayout.alignmentBytes > aggregateAlignment) {
      aggregateAlignment = fieldLayout.alignmentBytes;
    }
  }

  const sizeBytes = alignLayoutBytes(offset, aggregateAlignment);
  const trailingPadding = sizeBytes - offset;
  if (trailingPadding > 0n) {
    const trailingRange: LayoutPaddingRange = {
      offsetBytes: offset,
      sizeBytes: trailingPadding,
      kind: "trailing",
    };
    paddingRanges.push(trailingRange);
    transitivePaddingRanges.push(trailingRange);
  }

  if (exceedsMaximum(sizeBytes, input.context.targetFacts.maximumObjectSizeBytes)) {
    diagnostics.push(
      aggregateTypeDiagnostic(
        input.owner.instanceId,
        "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
        "Aggregate size exceeds target maximum object size.",
        String(sizeBytes),
      ),
    );
  }

  if (exceedsMaximum(aggregateAlignment, input.context.targetFacts.maximumAlignmentBytes)) {
    diagnostics.push(
      aggregateTypeDiagnostic(
        input.owner.instanceId,
        "LAYOUT_FIELD_ALIGNMENT_OVERFLOW",
        "Aggregate alignment exceeds target maximum.",
        String(aggregateAlignment),
      ),
    );
  }

  return {
    fieldFacts,
    paddingRanges,
    transitivePaddingRanges,
    sizeBytes,
    alignmentBytes: aggregateAlignment,
    diagnostics,
  };
}

function buildAggregateStorageFact(input: {
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly trailingPaddingBytes: bigint;
}): LayoutAggregateStorageFact {
  return {
    hiddenFields: [],
    paddingRanges: input.paddingRanges,
    transitivePaddingRanges: input.transitivePaddingRanges,
    trailingPaddingBytes: input.trailingPaddingBytes,
    paddingExposurePolicy: "fieldwiseCopyOnlyUntilInitialized",
  };
}

interface InternalAggregateLayoutInput extends ComputeSourceAggregateLayoutInput {
  readonly context?: AggregateLayoutContext;
}

interface AggregateLayoutComputation {
  readonly typeFact: LayoutTypeFact;
  readonly fieldFacts: readonly LayoutFieldFact[];
}

function buildFreshAggregateLayoutContext(input: {
  readonly targetFacts: TargetLayoutFacts;
  readonly primitiveFacts: LayoutTypeFactTable;
  readonly nestedSourceTypes?: readonly ComputeSourceAggregateNestedType[];
  readonly sourceTypeKeys: ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }>;
  readonly precomputedTypeFacts?: ReadonlyMap<string, LayoutTypeFact>;
}): AggregateLayoutContext {
  const nestedSourceTypes = new Map<string, ComputeSourceAggregateNestedType>();
  for (const nested of input.nestedSourceTypes ?? []) {
    nestedSourceTypes.set(String(nested.instanceId), nested);
  }

  const computedFacts = new Map<string, LayoutTypeFact>();
  for (const [cacheKey, typeFact] of input.precomputedTypeFacts ?? []) {
    computedFacts.set(cacheKey, typeFact);
  }

  return {
    targetFacts: input.targetFacts,
    primitiveFacts: input.primitiveFacts,
    nestedSourceTypes,
    sourceTypeKeys: input.sourceTypeKeys,
    computedFacts,
    activeStack: new Set<string>(),
  };
}

function computeSourceAggregateLayoutInternal(
  input: InternalAggregateLayoutInput & {
    readonly owner: LayoutTypeKey & { readonly kind: "source" };
    readonly sourceKind: SourceItemKind;
    readonly targetFacts: TargetLayoutFacts;
    readonly primitiveFacts: LayoutTypeFactTable;
  },
): LayoutBuilderResult<AggregateLayoutComputation> {
  const ownerKey = typeLayoutOwnerKey(input.owner.instanceId);
  const sourceOrigin = input.sourceOrigin;

  if (UNSUPPORTED_SOURCE_KINDS.has(input.sourceKind)) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          layoutUnsupportedSourceKindDiagnosticCode(input.sourceKind),
          `Source kind '${input.sourceKind}' has no by-value runtime representation.`,
          input.sourceKind,
          sourceOrigin,
        ),
      ],
    };
  }

  const context: AggregateLayoutContext =
    input.context ??
    buildFreshAggregateLayoutContext({
      targetFacts: input.targetFacts,
      primitiveFacts: input.primitiveFacts,
      nestedSourceTypes: input.nestedSourceTypes,
      sourceTypeKeys: input.sourceTypeKeys ?? new Map(),
      precomputedTypeFacts: input.precomputedTypeFacts,
    });

  if (input.fields.length === 0) {
    const representation = zeroSizedRepresentation(input.sourceKind);
    const typeFact: LayoutTypeFact = {
      key: input.owner,
      sizeBytes: 0n,
      alignmentBytes: 1n,
      strideBytes: 0n,
      representation,
      sourceOrigin,
    };
    context.computedFacts.set(layoutTypeKeyCacheKey(input.owner), typeFact);
    return {
      kind: "ok",
      ownerKey,
      dependencies: [],
      value: { typeFact, fieldFacts: [] },
      diagnostics: [],
    };
  }

  const ownerCacheKey = layoutTypeKeyCacheKey(input.owner);
  if (context.activeStack.has(ownerCacheKey)) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        aggregateTypeDiagnostic(
          input.owner.instanceId,
          "LAYOUT_RECURSIVE_TYPE_LAYOUT",
          "Source type layout depends on itself by value.",
          ownerCacheKey,
          sourceOrigin,
        ),
      ],
    };
  }

  context.activeStack.add(ownerCacheKey);
  const layout = buildFieldFacts({
    owner: input.owner,
    fields: input.fields,
    sourceOrigin,
    context,
  });
  context.activeStack.delete(ownerCacheKey);

  const hasErrorDiagnostic = layout.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (hasErrorDiagnostic) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: layout.diagnostics,
    };
  }

  const trailingPaddingBytes =
    layout.sizeBytes > 0n
      ? layout.sizeBytes -
        (layout.fieldFacts.length === 0
          ? 0n
          : layout.fieldFacts[layout.fieldFacts.length - 1]!.offsetBytes +
            layout.fieldFacts[layout.fieldFacts.length - 1]!.sizeBytes)
      : 0n;

  const typeFact: LayoutTypeFact = {
    key: input.owner,
    sizeBytes: layout.sizeBytes,
    alignmentBytes: layout.alignmentBytes,
    strideBytes: layout.sizeBytes,
    representation: { kind: "aggregate", sourceKind: input.sourceKind },
    aggregateStorage: buildAggregateStorageFact({
      paddingRanges: layout.paddingRanges,
      transitivePaddingRanges: layout.transitivePaddingRanges,
      trailingPaddingBytes,
    }),
    sourceOrigin,
  };

  context.computedFacts.set(ownerCacheKey, typeFact);

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: { typeFact, fieldFacts: layout.fieldFacts },
    diagnostics: layout.diagnostics,
  };
}

export function computeSourceAggregateLayout(
  input: ComputeSourceAggregateLayoutInput,
): LayoutBuilderResult<SourceAggregateLayoutValue> {
  const owner = input.owner;
  const sourceKind = input.sourceKind;
  const sourceOrigin = input.sourceOrigin;
  const ownerKey = typeLayoutOwnerKey(owner.instanceId);

  let primitiveFacts = input.primitiveFacts;
  const diagnostics: LayoutDiagnostic[] = [];

  if (primitiveFacts === undefined) {
    if (input.target === undefined) {
      return {
        kind: "error",
        ownerKey,
        dependencies: [],
        diagnostics: [
          layoutDiagnostic({
            severity: "error",
            code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
            message: "Aggregate layout requires target surface or primitive facts.",
            ownerKey: String(ownerKey),
            rootCauseKey: String(ownerKey),
            stableDetail: "missing-target",
          }),
        ],
      };
    }
    const primitiveResult = seedPrimitiveTypeFacts(input.target);
    if (primitiveResult.kind === "error") {
      return {
        kind: "error",
        ownerKey,
        dependencies: primitiveResult.dependencies,
        diagnostics: primitiveResult.diagnostics,
      };
    }
    primitiveFacts = primitiveResult.value.types;
    diagnostics.push(...primitiveResult.diagnostics);
  }

  if (input.targetFacts === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
          message: "Aggregate layout requires target layout facts.",
          ownerKey: String(ownerKey),
          rootCauseKey: String(ownerKey),
          stableDetail: "missing-target-facts",
        }),
      ],
    };
  }

  const layoutResult = computeSourceAggregateLayoutInternal({
    ...input,
    owner,
    sourceKind,
    sourceOrigin,
    targetFacts: input.targetFacts,
    primitiveFacts,
  });

  if (layoutResult.kind === "error") {
    return {
      kind: "error",
      ownerKey,
      dependencies: layoutResult.dependencies,
      diagnostics: [...diagnostics, ...layoutResult.diagnostics],
    };
  }

  const fieldTable = layoutDeterministicTable({
    entries: layoutResult.value.fieldFacts,
    keyOf: (entry) => ({ owner: entry.owner, fieldId: entry.fieldId }),
    keyString: layoutFieldKeyString,
  });

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      typeFact: layoutResult.value.typeFact,
      fieldFacts: fieldTable.entries(),
    },
    diagnostics: [...diagnostics, ...layoutResult.diagnostics],
  };
}

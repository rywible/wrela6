import type { MonoInstanceId } from "../mono/ids";
import type { MonoFieldRecord, MonoTypeInstance, MonoValidatedBuffer } from "../mono/mono-hir";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { validatedBufferRootCauseKey, validatedBufferValueStorageOwnerKey } from "./layout-owners";
import { alignLayoutBytes, resolveCheckedTypeToLayoutKey } from "./aggregate-layout";
import type {
  LayoutAggregateStorageFact,
  LayoutFieldFact,
  LayoutHiddenStorageField,
  LayoutPaddingRange,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  LayoutValidatedBufferValueStorageFact,
  TargetLayoutFacts,
} from "./layout-program";
import { seedPrimitiveTypeFacts } from "./primitive-layout";
import type { LayoutTargetSurface } from "./target-layout";
import { normalizeTargetFactsFromSurface, layoutTypeKeyFromPrimitiveRef } from "./target-facts";

export interface ComputeValidatedBufferValueStorageInput {
  readonly buffer: MonoValidatedBuffer;
  readonly typeInstance: MonoTypeInstance;
  readonly target: LayoutTargetSurface;
  readonly targetFacts?: TargetLayoutFacts;
  readonly primitiveFacts?: LayoutTypeFactTable;
  readonly sourceOrigin?: string;
}

export interface ValidatedBufferValueStorageValue {
  readonly ownerTypeFact: LayoutTypeFact;
  readonly valueStorage: LayoutValidatedBufferValueStorageFact;
  readonly parameterFieldFacts: readonly LayoutFieldFact[];
}

function valueStorageDiagnostic(
  instanceId: MonoInstanceId,
  input: {
    readonly code: string;
    readonly message: string;
    readonly stableDetail: string;
    readonly sourceOrigin?: string;
  },
): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: String(validatedBufferValueStorageOwnerKey(instanceId)),
    rootCauseKey: validatedBufferRootCauseKey(instanceId),
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  });
}

function layoutTypeKeyStableDetail(key: LayoutTypeKey): string {
  switch (key.kind) {
    case "source":
      return String(key.instanceId);
    case "core":
      return String(key.coreTypeId);
    case "target":
      return String(key.targetTypeId);
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function layoutForPrimitiveKey(
  key: LayoutTypeKey,
  primitiveFacts: LayoutTypeFactTable,
): LayoutTypeFact | undefined {
  return primitiveFacts.get(key);
}

function buildHiddenStorageFields(input: {
  readonly handle: LayoutTargetSurface["validatedBufferHandle"];
  readonly primitiveFacts: LayoutTypeFactTable;
  readonly instanceId: MonoInstanceId;
  readonly sourceOrigin: string;
}): {
  readonly hiddenFields: readonly LayoutHiddenStorageField[];
  readonly parameterFieldsStartOffsetBytes: bigint;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const pointerTypeKey = layoutTypeKeyFromPrimitiveRef(input.handle.pointerType);
  const lengthTypeKey = layoutTypeKeyFromPrimitiveRef(input.handle.lengthType);
  const pointerLayout = layoutForPrimitiveKey(pointerTypeKey, input.primitiveFacts);
  const lengthLayout = layoutForPrimitiveKey(lengthTypeKey, input.primitiveFacts);
  const diagnostics: LayoutDiagnostic[] = [];

  if (pointerLayout === undefined) {
    diagnostics.push(
      valueStorageDiagnostic(input.instanceId, {
        code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
        message: "Validated-buffer source pointer type has no primitive layout fact.",
        stableDetail: `pointer:${layoutTypeKeyStableDetail(pointerTypeKey)}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
  }
  if (lengthLayout === undefined) {
    diagnostics.push(
      valueStorageDiagnostic(input.instanceId, {
        code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
        message: "Validated-buffer source length type has no primitive layout fact.",
        stableDetail: `length:${layoutTypeKeyStableDetail(lengthTypeKey)}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
  }

  if (pointerLayout === undefined || lengthLayout === undefined) {
    return { hiddenFields: [], parameterFieldsStartOffsetBytes: 0n, diagnostics };
  }

  const sourcePointer: LayoutHiddenStorageField = {
    name: input.handle.pointerFieldName,
    type: pointerTypeKey,
    offsetBytes: 0n,
    sizeBytes: pointerLayout.sizeBytes,
    alignmentBytes: pointerLayout.alignmentBytes,
  };

  const lengthOffset = alignLayoutBytes(sourcePointer.sizeBytes, lengthLayout.alignmentBytes);
  const sourceLength: LayoutHiddenStorageField = {
    name: input.handle.lengthFieldName,
    type: lengthTypeKey,
    offsetBytes: lengthOffset,
    sizeBytes: lengthLayout.sizeBytes,
    alignmentBytes: lengthLayout.alignmentBytes,
  };

  const afterHiddenFields = sourceLength.offsetBytes + sourceLength.sizeBytes;
  return {
    hiddenFields: [sourcePointer, sourceLength],
    parameterFieldsStartOffsetBytes: afterHiddenFields,
    diagnostics,
  };
}

function buildParameterFieldFacts(input: {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly parameterFields: readonly MonoFieldRecord[];
  readonly startOffsetBytes: bigint;
  readonly primitiveFacts: LayoutTypeFactTable;
  readonly targetFacts: TargetLayoutFacts;
  readonly instanceId: MonoInstanceId;
  readonly sourceOrigin: string;
}): {
  readonly fieldFacts: readonly LayoutFieldFact[];
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly parameterFieldsStartOffsetBytes: bigint;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const diagnostics: LayoutDiagnostic[] = [];
  const paddingRanges: LayoutPaddingRange[] = [];
  const transitivePaddingRanges: LayoutPaddingRange[] = [];
  const fieldFacts: LayoutFieldFact[] = [];

  let offset = input.startOffsetBytes;
  let aggregateAlignment = 1n;
  let parameterFieldsStartOffsetBytes = input.startOffsetBytes;

  for (const [index, field] of input.parameterFields.entries()) {
    const fieldTypeKey = resolveCheckedTypeToLayoutKey(field.type);
    if (fieldTypeKey === undefined) {
      diagnostics.push(
        valueStorageDiagnostic(input.instanceId, {
          code: "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
          message: `Validated-buffer parameter field '${field.name}' has unsupported type representation.`,
          stableDetail: field.name,
          sourceOrigin: field.sourceOrigin,
        }),
      );
      continue;
    }

    const fieldLayout = layoutForPrimitiveKey(fieldTypeKey, input.primitiveFacts);
    if (fieldLayout === undefined) {
      diagnostics.push(
        valueStorageDiagnostic(input.instanceId, {
          code: "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
          message: `Validated-buffer parameter field '${field.name}' has no layout fact.`,
          stableDetail: field.name,
          sourceOrigin: field.sourceOrigin,
        }),
      );
      continue;
    }

    if (fieldLayout.representation.kind === "never") {
      diagnostics.push(
        valueStorageDiagnostic(input.instanceId, {
          code: "LAYOUT_FORBIDDEN_NEVER_STORAGE",
          message: `Validated-buffer parameter field '${field.name}' stores forbidden Never type.`,
          stableDetail: field.name,
          sourceOrigin: field.sourceOrigin,
        }),
      );
      continue;
    }

    const fieldOffset = alignLayoutBytes(offset, fieldLayout.alignmentBytes);
    if (index === 0) {
      parameterFieldsStartOffsetBytes = fieldOffset;
    }

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

    if (fieldOffset + fieldLayout.sizeBytes > input.targetFacts.maximumObjectSizeBytes) {
      diagnostics.push(
        valueStorageDiagnostic(input.instanceId, {
          code: "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
          message: "Validated-buffer wrapper size exceeds target maximum object size.",
          stableDetail: field.name,
          sourceOrigin: field.sourceOrigin,
        }),
      );
      continue;
    }

    fieldFacts.push({
      owner: input.owner,
      fieldId: field.fieldId,
      fieldName: field.name,
      fieldType: fieldTypeKey,
      offsetBytes: fieldOffset,
      sizeBytes: fieldLayout.sizeBytes,
      alignmentBytes: fieldLayout.alignmentBytes,
      index,
      paddingBeforeBytes: paddingBefore,
      sourceOrigin: field.sourceOrigin,
    });

    offset = fieldOffset + fieldLayout.sizeBytes;
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

  return {
    fieldFacts,
    paddingRanges,
    transitivePaddingRanges,
    sizeBytes,
    alignmentBytes: aggregateAlignment,
    parameterFieldsStartOffsetBytes,
    diagnostics,
  };
}

function buildAggregateStorageFact(input: {
  readonly hiddenFields: readonly LayoutHiddenStorageField[];
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly trailingPaddingBytes: bigint;
}): LayoutAggregateStorageFact {
  return {
    hiddenFields: input.hiddenFields,
    paddingRanges: input.paddingRanges,
    transitivePaddingRanges: input.transitivePaddingRanges,
    trailingPaddingBytes: input.trailingPaddingBytes,
    paddingExposurePolicy: "fieldwiseCopyOnlyUntilInitialized",
  };
}

function computeValidatedBufferValueStorageInternal(
  input: ComputeValidatedBufferValueStorageInput,
): LayoutBuilderResult<ValidatedBufferValueStorageValue> {
  const ownerKey = validatedBufferValueStorageOwnerKey(input.buffer.instanceId);
  const sourceOrigin = input.sourceOrigin ?? input.buffer.sourceOrigin;
  if (sourceOrigin === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        valueStorageDiagnostic(input.buffer.instanceId, {
          code: "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
          message: "Validated-buffer value storage requires a source origin.",
          stableDetail: "missing-source-origin",
        }),
      ],
    };
  }
  const owner: LayoutTypeKey & { readonly kind: "source" } = {
    kind: "source",
    instanceId: input.buffer.instanceId,
  };

  if (input.typeInstance.sourceKind !== "validatedBuffer") {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        valueStorageDiagnostic(input.buffer.instanceId, {
          code: "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
          message: "Validated-buffer value storage requires a validated-buffer type instance.",
          stableDetail: input.typeInstance.sourceKind,
          sourceOrigin,
        }),
      ],
    };
  }

  let primitiveFacts = input.primitiveFacts;
  const diagnostics: LayoutDiagnostic[] = [];

  if (primitiveFacts === undefined) {
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

  const targetFacts = input.targetFacts ?? normalizeTargetFactsFromSurface(input.target);

  const hiddenResult = buildHiddenStorageFields({
    handle: input.target.validatedBufferHandle,
    primitiveFacts,
    instanceId: input.buffer.instanceId,
    sourceOrigin,
  });
  diagnostics.push(...hiddenResult.diagnostics);

  if (hiddenResult.hiddenFields.length !== 2) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  const parameterLayout = buildParameterFieldFacts({
    owner,
    parameterFields: input.buffer.parameterFields,
    startOffsetBytes: hiddenResult.parameterFieldsStartOffsetBytes,
    primitiveFacts,
    targetFacts,
    instanceId: input.buffer.instanceId,
    sourceOrigin,
  });
  diagnostics.push(...parameterLayout.diagnostics);

  const hasErrorDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasErrorDiagnostic) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  const hiddenFields = hiddenResult.hiddenFields;
  const [sourcePointer, sourceLength] = hiddenFields;

  const aggregateAlignment = [
    sourcePointer!.alignmentBytes,
    sourceLength!.alignmentBytes,
    parameterLayout.alignmentBytes,
  ].reduce((left, right) => (right > left ? right : left), 1n);

  const wrapperSizeBytes = alignLayoutBytes(parameterLayout.sizeBytes, aggregateAlignment);
  const trailingPaddingBytes = wrapperSizeBytes - parameterLayout.sizeBytes;
  const paddingRanges = [...parameterLayout.paddingRanges];
  const transitivePaddingRanges = [...parameterLayout.transitivePaddingRanges];
  if (trailingPaddingBytes > 0n) {
    const trailingRange: LayoutPaddingRange = {
      offsetBytes: parameterLayout.sizeBytes,
      sizeBytes: trailingPaddingBytes,
      kind: "trailing",
    };
    paddingRanges.push(trailingRange);
    transitivePaddingRanges.push(trailingRange);
  }

  const ownerTypeFact: LayoutTypeFact = {
    key: owner,
    sizeBytes: wrapperSizeBytes,
    alignmentBytes: aggregateAlignment,
    strideBytes: wrapperSizeBytes,
    representation: { kind: "aggregate", sourceKind: "validatedBuffer" },
    aggregateStorage: buildAggregateStorageFact({
      hiddenFields,
      paddingRanges,
      transitivePaddingRanges,
      trailingPaddingBytes,
    }),
    sourceOrigin,
  };

  const valueStorage: LayoutValidatedBufferValueStorageFact = {
    sourcePointer: sourcePointer!,
    sourceLength: sourceLength!,
    parameterFieldsStartOffsetBytes: parameterLayout.parameterFieldsStartOffsetBytes,
  };

  if (
    ownerTypeFact.aggregateStorage?.hiddenFields[0] !== valueStorage.sourcePointer ||
    ownerTypeFact.aggregateStorage.hiddenFields[1] !== valueStorage.sourceLength
  ) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        valueStorageDiagnostic(input.buffer.instanceId, {
          code: "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
          message: "Validated-buffer value storage must reference aggregate hidden field objects.",
          stableDetail: "hidden-field-identity",
          sourceOrigin,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      ownerTypeFact,
      valueStorage,
      parameterFieldFacts: parameterLayout.fieldFacts,
    },
    diagnostics,
  };
}

export function computeValidatedBufferValueStorage(
  input: ComputeValidatedBufferValueStorageInput,
): LayoutBuilderResult<ValidatedBufferValueStorageValue> {
  return computeValidatedBufferValueStorageInternal(input);
}

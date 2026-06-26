import type { MonoInstanceId } from "../mono/ids";
import type {
  MonoLayoutExpression,
  MonoValidatedBuffer,
  MonoValidatedBufferLayoutField,
  MonomorphizedHirProgram,
} from "../mono/mono-hir";
import type { FieldId } from "../semantic/ids";
import { fieldId } from "../semantic/ids";
import { computeWireTypeFact, type ComputeWireTypeFactInput } from "./validated-buffer-wire";
import { resolveCheckedTypeToLayoutKey } from "./aggregate-layout";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import type {
  LayoutReadRequirement,
  LayoutTerm,
  LayoutTermUnit,
  LayoutValidatedBufferFieldFact,
  LayoutWireReadPolicy,
  TargetLayoutFacts,
} from "./layout-program";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type { LayoutTargetSurface } from "./target-layout";
import type { LayoutFieldWireMetadata } from "./layout-field-value-facts";
import {
  validatedBufferFieldOwnerKey,
  validatedBufferRootCauseKey,
  validatedBufferRootOwnerKey,
} from "./layout-owners";
import {
  compareLayoutTermOrder,
  normalizeAffineLayoutTerm,
  translateLayoutTerm,
} from "./validated-buffer-terms";

const SOURCE_LENGTH_TERM_FIELD_ID = fieldId(0);

export function layoutFieldWireByFieldIdFromBuffer(
  buffer: MonoValidatedBuffer,
): Map<FieldId, LayoutFieldWireMetadata> {
  const wireByFieldId = new Map<FieldId, LayoutFieldWireMetadata>();
  for (const layoutField of buffer.layoutFields) {
    wireByFieldId.set(layoutField.field.fieldId, {
      wireEncoding: layoutField.wireEncoding,
      layoutWireEndian: layoutField.layoutWireEndian,
    });
  }
  return wireByFieldId;
}

export interface ComputeValidatedBufferFieldFactsInput {
  readonly buffer: MonoValidatedBuffer;
  readonly target: LayoutTargetSurface;
  readonly program: MonomorphizedHirProgram;
  readonly targetFacts: TargetLayoutFacts;
  readonly typeResolver: LayoutTypeResolver;
  readonly sourceOrigin?: string;
}

export interface ValidatedBufferFieldFactsValue {
  readonly layoutFields: readonly LayoutValidatedBufferFieldFact[];
  readonly fixedEndBytes?: bigint;
  readonly sourceLengthTerm: LayoutTerm;
}

export interface ValidateLayoutFieldDependenciesInput {
  readonly expression: MonoLayoutExpression;
  readonly fieldId: FieldId;
  readonly instanceId: MonoInstanceId;
  readonly parameterFieldIds: ReadonlySet<string>;
  readonly availableLayoutFieldIds: ReadonlySet<string>;
  readonly availableDerivedFieldIds: ReadonlySet<string>;
  readonly sourceOrigin: string;
}

export interface LayoutFieldInterval {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly offset: LayoutTerm;
  readonly end: LayoutTerm;
  readonly instanceId: MonoInstanceId;
  readonly sourceOrigin: string;
}

export interface ValidateLayoutFieldIntervalsInput {
  readonly intervals: readonly LayoutFieldInterval[];
  readonly targetFacts: TargetLayoutFacts;
}

export interface ValidateLayoutFieldIntervalsValue {
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly intervalRequirementsByFieldId: ReadonlyMap<FieldId, readonly LayoutReadRequirement[]>;
}

export interface BuildLayoutReadRequirementsInput {
  readonly fieldId: FieldId;
  readonly end: LayoutTerm;
  readonly isFixed: boolean;
  readonly translationRequirements: readonly LayoutReadRequirement[];
  readonly dependencyFieldIds: readonly FieldId[];
}

export function validatedBufferFieldRootCauseKey(instanceId: MonoInstanceId): string {
  return validatedBufferRootCauseKey(instanceId);
}

function fieldDiagnostic(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
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
    ownerKey: String(validatedBufferFieldOwnerKey(instanceId, fieldIdValue)),
    rootCauseKey: validatedBufferFieldRootCauseKey(instanceId),
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  });
}

function fieldIdKey(fieldIdValue: FieldId): string {
  return String(fieldIdValue);
}

function collectFieldValueDependencies(expression: MonoLayoutExpression): readonly {
  readonly fieldId: FieldId;
  readonly fieldKind: "parameter" | "layout" | "derived";
}[] {
  switch (expression.kind) {
    case "integerLiteral":
    case "sourceLength":
      return [];
    case "fieldValue":
      return [{ fieldId: expression.fieldId, fieldKind: expression.fieldKind }];
    case "add":
    case "subtract":
    case "multiply":
      return [
        ...collectFieldValueDependencies(expression.left),
        ...collectFieldValueDependencies(expression.right),
      ];
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}

export function validateDerivedFieldDependencies(input: {
  readonly expression: MonoLayoutExpression;
  readonly instanceId: MonoInstanceId;
  readonly fieldId: FieldId;
  readonly sourceOrigin: string;
  readonly parameterFieldIds: ReadonlySet<string>;
  readonly availableLayoutFieldIds: ReadonlySet<string>;
  readonly availableDerivedFieldIds: ReadonlySet<string>;
}): readonly LayoutDiagnostic[] {
  return validateLayoutFieldDependencies({
    expression: input.expression,
    fieldId: input.fieldId,
    instanceId: input.instanceId,
    sourceOrigin: input.sourceOrigin,
    parameterFieldIds: input.parameterFieldIds,
    availableLayoutFieldIds: input.availableLayoutFieldIds,
    availableDerivedFieldIds: input.availableDerivedFieldIds,
  });
}

export function validateLayoutFieldDependencies(
  input: ValidateLayoutFieldDependenciesInput,
): readonly LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const seen = new Set<string>();

  for (const dependency of collectFieldValueDependencies(input.expression)) {
    const key = fieldIdKey(dependency.fieldId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    switch (dependency.fieldKind) {
      case "parameter":
        if (!input.parameterFieldIds.has(key)) {
          diagnostics.push(
            fieldDiagnostic(input.instanceId, input.fieldId, {
              code: "LAYOUT_FIELD_FORWARD_DEPENDENCY",
              message: "Layout field references an unavailable parameter field.",
              stableDetail: `parameter:${key}`,
              sourceOrigin: input.sourceOrigin,
            }),
          );
        }
        break;
      case "layout":
        if (!input.availableLayoutFieldIds.has(key)) {
          diagnostics.push(
            fieldDiagnostic(input.instanceId, input.fieldId, {
              code: "LAYOUT_FIELD_FORWARD_DEPENDENCY",
              message: "Layout field depends on a later or missing layout field.",
              stableDetail: `layout:${key}`,
              sourceOrigin: input.sourceOrigin,
            }),
          );
        }
        break;
      case "derived":
        if (!input.availableDerivedFieldIds.has(key)) {
          diagnostics.push(
            fieldDiagnostic(input.instanceId, input.fieldId, {
              code: "LAYOUT_FIELD_FORWARD_DEPENDENCY",
              message: "Layout field depends on a later or missing derived field.",
              stableDetail: `derived:${key}`,
              sourceOrigin: input.sourceOrigin,
            }),
          );
        }
        break;
      default: {
        const unreachable: never = dependency.fieldKind;
        return unreachable;
      }
    }
  }

  return diagnostics;
}

function isConstantTerm(
  term: LayoutTerm,
): term is Extract<LayoutTerm, { readonly kind: "constant" }> {
  return term.kind === "constant";
}

function constantIntervalsOverlap(left: LayoutFieldInterval, right: LayoutFieldInterval): boolean {
  if (
    !isConstantTerm(left.offset) ||
    !isConstantTerm(left.end) ||
    !isConstantTerm(right.offset) ||
    !isConstantTerm(right.end)
  ) {
    return false;
  }

  const leftStart = left.offset.value;
  const leftEnd = left.end.value;
  const rightStart = right.offset.value;
  const rightEnd = right.end.value;
  return !(leftEnd <= rightStart || rightEnd <= leftStart);
}

export function validateLayoutFieldIntervals(
  input: ValidateLayoutFieldIntervalsInput,
): ValidateLayoutFieldIntervalsValue {
  const diagnostics: LayoutDiagnostic[] = [];
  const intervalRequirementsByFieldId = new Map<FieldId, LayoutReadRequirement[]>();

  for (let laterIndex = 1; laterIndex < input.intervals.length; laterIndex += 1) {
    const later = input.intervals[laterIndex]!;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = input.intervals[earlierIndex]!;
      const intervalResult = validateIntervalPair(earlier, later, input.targetFacts);
      if (intervalResult.kind === "error") {
        diagnostics.push(intervalResult.diagnostic);
        continue;
      }
      if (intervalResult.kind === "constraint") {
        const existing = intervalRequirementsByFieldId.get(later.fieldId) ?? [];
        intervalRequirementsByFieldId.set(later.fieldId, [...existing, intervalResult.requirement]);
      }
    }
  }

  return { diagnostics, intervalRequirementsByFieldId };
}

type ValidateIntervalPairResult =
  | { readonly kind: "ok" }
  | { readonly kind: "constraint"; readonly requirement: LayoutReadRequirement }
  | { readonly kind: "error"; readonly diagnostic: LayoutDiagnostic };

function validateIntervalPair(
  earlier: LayoutFieldInterval,
  later: LayoutFieldInterval,
  targetFacts: TargetLayoutFacts,
): ValidateIntervalPairResult {
  if (constantIntervalsOverlap(earlier, later)) {
    return {
      kind: "error",
      diagnostic: fieldDiagnostic(later.instanceId, later.fieldId, {
        code: "LAYOUT_FIELD_OVERLAP",
        message: "Validated-buffer layout field intervals overlap.",
        stableDetail: `${String(earlier.fieldId)}:${String(later.fieldId)}:constant-overlap`,
        sourceOrigin: later.sourceOrigin,
      }),
    };
  }

  const order = compareLayoutTermOrder(earlier.end, later.offset);
  if (order.kind === "ordered") {
    if (order.order === "before" || order.order === "equal") {
      return { kind: "ok" };
    }
    return {
      kind: "error",
      diagnostic: fieldDiagnostic(later.instanceId, later.fieldId, {
        code: "LAYOUT_FIELD_OVERLAP",
        message: "Validated-buffer layout field intervals overlap.",
        stableDetail: `${String(earlier.fieldId)}:${String(later.fieldId)}:structural-overlap`,
        sourceOrigin: later.sourceOrigin,
      }),
    };
  }

  const allConstant =
    isConstantTerm(earlier.offset) &&
    isConstantTerm(earlier.end) &&
    isConstantTerm(later.offset) &&
    isConstantTerm(later.end);
  if (allConstant) {
    return { kind: "ok" };
  }

  const earlierEndAffine = normalizeAffineLayoutTerm(earlier.end);
  const laterOffsetAffine = normalizeAffineLayoutTerm(later.offset);
  if (earlierEndAffine.kind === "ok" && laterOffsetAffine.kind === "ok") {
    return {
      kind: "constraint",
      requirement: {
        kind: "rangeConstraint",
        left: earlier.end,
        relation: "<=",
        right: later.offset,
        width: targetFacts.sizeType,
      },
    };
  }

  return {
    kind: "error",
    diagnostic: fieldDiagnostic(later.instanceId, later.fieldId, {
      code: "LAYOUT_FIELD_AMBIGUOUS_ORDER",
      message: "Validated-buffer layout field interval order cannot be proven.",
      stableDetail: `${String(earlier.fieldId)}:${String(later.fieldId)}:ambiguous`,
      sourceOrigin: later.sourceOrigin,
    }),
  };
}

export function buildLayoutReadRequirements(
  input: BuildLayoutReadRequirementsInput,
): readonly LayoutReadRequirement[] {
  const requirements: LayoutReadRequirement[] = [...input.translationRequirements];

  for (const dependencyFieldId of input.dependencyFieldIds) {
    requirements.push({
      kind: "fieldAvailable",
      fieldId: dependencyFieldId,
    });
  }

  requirements.push({
    kind: "layoutFits",
    end: input.end,
  });

  if (!input.isFixed) {
    requirements.push({
      kind: "payloadEnd",
      end: input.end,
    });
  }

  return requirements;
}

function constantTerm(value: bigint, unit: LayoutTermUnit): LayoutTerm {
  return {
    kind: "constant",
    value,
    unit,
    range: {
      minimum: value,
      maximum: value,
      provenance: "constant",
    },
  };
}

function addTerms(left: LayoutTerm, right: LayoutTerm, unit: LayoutTermUnit): LayoutTerm {
  if (isConstantTerm(left) && isConstantTerm(right)) {
    return constantTerm(left.value + right.value, unit);
  }
  return {
    kind: "add",
    left,
    right,
    unit,
    range: {
      minimum: left.range.minimum + right.range.minimum,
      maximum: left.range.maximum + right.range.maximum,
      provenance: "arithmetic",
    },
  };
}

function multiplyTerms(left: LayoutTerm, right: LayoutTerm, unit: LayoutTermUnit): LayoutTerm {
  if (isConstantTerm(left) && isConstantTerm(right)) {
    return constantTerm(left.value * right.value, unit);
  }
  return {
    kind: "multiply",
    left,
    right,
    unit,
    range: {
      minimum: left.range.minimum * right.range.minimum,
      maximum: left.range.maximum * right.range.maximum,
      provenance: "arithmetic",
    },
  };
}

function isFixedField(offset: LayoutTerm, byteLength: LayoutTerm): boolean {
  return isConstantTerm(offset) && isConstantTerm(byteLength);
}

function wireEncodingInput(
  layoutField: MonoValidatedBufferLayoutField,
): Pick<ComputeWireTypeFactInput, "layoutWireEndian" | "wireEncoding"> {
  return {
    layoutWireEndian: layoutField.layoutWireEndian,
    wireEncoding: layoutField.wireEncoding,
  };
}

function layoutFieldDependencyFieldIds(
  layoutField: MonoValidatedBufferLayoutField,
): readonly FieldId[] {
  const dependencies = new Set<string>();
  const fieldIds: FieldId[] = [];

  for (const expression of [layoutField.offset, layoutField.length]) {
    if (expression === undefined) {
      continue;
    }
    for (const dependency of collectFieldValueDependencies(expression)) {
      if (dependency.fieldKind === "parameter") {
        continue;
      }
      const key = fieldIdKey(dependency.fieldId);
      if (dependencies.has(key)) {
        continue;
      }
      dependencies.add(key);
      fieldIds.push(dependency.fieldId);
    }
  }

  return fieldIds;
}

function layoutDerivedFieldDeclarationOrder(buffer: MonoValidatedBuffer): readonly FieldId[] {
  if (buffer.layoutDerivedFieldOrder.length > 0) {
    return buffer.layoutDerivedFieldOrder;
  }
  return [
    ...buffer.layoutFields.map((field) => field.field.fieldId),
    ...buffer.derivedFields.map((field) => field.field.fieldId),
  ];
}

function derivedFieldIdsAvailableBeforeLayoutField(
  buffer: MonoValidatedBuffer,
  beforeFieldId: FieldId,
): ReadonlySet<string> {
  const derivedIds = new Set(buffer.derivedFields.map((field) => fieldIdKey(field.field.fieldId)));
  const available = new Set<string>();
  for (const fieldIdValue of layoutDerivedFieldDeclarationOrder(buffer)) {
    if (fieldIdValue === beforeFieldId) {
      break;
    }
    if (derivedIds.has(fieldIdKey(fieldIdValue))) {
      available.add(fieldIdKey(fieldIdValue));
    }
  }
  return available;
}

export function layoutFieldIdsBefore(
  buffer: MonoValidatedBuffer,
  beforeFieldId: FieldId,
): ReadonlySet<string> {
  const layoutIds = new Set(buffer.layoutFields.map((field) => fieldIdKey(field.field.fieldId)));
  const available = new Set<string>();
  for (const fieldIdValue of layoutDerivedFieldDeclarationOrder(buffer)) {
    if (fieldIdValue === beforeFieldId) {
      break;
    }
    if (layoutIds.has(fieldIdKey(fieldIdValue))) {
      available.add(fieldIdKey(fieldIdValue));
    }
  }
  return available;
}

export function derivedFieldIdsBefore(
  buffer: MonoValidatedBuffer,
  beforeFieldId: FieldId,
): ReadonlySet<string> {
  const derivedIds = new Set(buffer.derivedFields.map((field) => fieldIdKey(field.field.fieldId)));
  const available = new Set<string>();
  for (const fieldIdValue of layoutDerivedFieldDeclarationOrder(buffer)) {
    if (fieldIdValue === beforeFieldId) {
      break;
    }
    if (derivedIds.has(fieldIdKey(fieldIdValue))) {
      available.add(fieldIdKey(fieldIdValue));
    }
  }
  return available;
}

function computeValidatedBufferFieldFactsInternal(
  input: ComputeValidatedBufferFieldFactsInput,
): LayoutBuilderResult<ValidatedBufferFieldFactsValue> {
  const instanceId = input.buffer.instanceId;
  const ownerKey = validatedBufferRootOwnerKey(instanceId);
  const targetFacts = input.targetFacts;
  const diagnostics: LayoutDiagnostic[] = [];
  const typeResolver = input.typeResolver;

  const bufferSourceOrigin = input.sourceOrigin ?? input.buffer.sourceOrigin;
  if (bufferSourceOrigin === undefined) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_INVALID_LAYOUT_TERM",
          message: "Validated-buffer field facts require a source origin.",
          ownerKey: String(ownerKey),
          rootCauseKey: validatedBufferFieldRootCauseKey(instanceId),
          stableDetail: "missing-source-origin",
        }),
      ],
    };
  }

  const layoutFieldWireByFieldId = layoutFieldWireByFieldIdFromBuffer(input.buffer);
  const layoutTermProgram = input.program;

  const sourceLengthResult = translateLayoutTerm({
    expression: {
      kind: "sourceLength",
      width: { kind: "targetSize" },
      sourceOrigin: bufferSourceOrigin,
    },
    unit: "byteLength",
    targetFacts,
    instanceId,
    fieldId: SOURCE_LENGTH_TERM_FIELD_ID,
    program: layoutTermProgram,
    typeResolver,
    layoutFieldWireByFieldId,
    rootCauseKey: validatedBufferFieldRootCauseKey(instanceId),
  });
  if (sourceLengthResult.kind === "error") {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics: [...diagnostics, ...sourceLengthResult.diagnostics],
    };
  }
  diagnostics.push(...sourceLengthResult.diagnostics);

  const parameterFieldIds = new Set(
    input.buffer.parameterFields.map((field) => fieldIdKey(field.fieldId)),
  );
  const availableLayoutFieldIds = new Set<string>();

  const layoutFields: LayoutValidatedBufferFieldFact[] = [];
  const intervals: LayoutFieldInterval[] = [];
  let fixedEndBytes: bigint | undefined;

  for (const layoutField of input.buffer.layoutFields) {
    const fieldIdValue = layoutField.field.fieldId;
    const sourceOrigin = layoutField.sourceOrigin ?? bufferSourceOrigin;
    const availableDerivedFieldIds = derivedFieldIdsAvailableBeforeLayoutField(
      input.buffer,
      fieldIdValue,
    );

    const dependencyExpressions = [layoutField.offset, layoutField.length].filter(
      (expression): expression is MonoLayoutExpression => expression !== undefined,
    );
    for (const expression of dependencyExpressions) {
      diagnostics.push(
        ...validateLayoutFieldDependencies({
          expression,
          fieldId: fieldIdValue,
          instanceId,
          parameterFieldIds,
          availableLayoutFieldIds,
          availableDerivedFieldIds,
          sourceOrigin,
        }),
      );
    }

    const offsetResult = translateLayoutTerm({
      expression: layoutField.offset,
      unit: "byteOffset",
      targetFacts,
      instanceId,
      fieldId: fieldIdValue,
      program: layoutTermProgram,
      typeResolver,
      layoutFieldWireByFieldId,
      rootCauseKey: validatedBufferFieldRootCauseKey(instanceId),
    });
    if (offsetResult.kind === "error") {
      diagnostics.push(...offsetResult.diagnostics);
      availableLayoutFieldIds.add(fieldIdKey(fieldIdValue));
      continue;
    }
    diagnostics.push(...offsetResult.diagnostics);

    let elementCount: LayoutTerm;
    let elementCountRequirements: readonly LayoutReadRequirement[] = [];
    if (layoutField.length === undefined) {
      elementCount = constantTerm(1n, "elementCount");
    } else {
      const elementCountResult = translateLayoutTerm({
        expression: layoutField.length,
        unit: "elementCount",
        targetFacts,
        instanceId,
        fieldId: fieldIdValue,
        program: layoutTermProgram,
        typeResolver,
        layoutFieldWireByFieldId,
        rootCauseKey: validatedBufferFieldRootCauseKey(instanceId),
      });
      if (elementCountResult.kind === "error") {
        diagnostics.push(...elementCountResult.diagnostics);
        availableLayoutFieldIds.add(fieldIdKey(fieldIdValue));
        continue;
      }
      diagnostics.push(...elementCountResult.diagnostics);
      elementCount = elementCountResult.value.term;
      elementCountRequirements = elementCountResult.value.requirements;
    }

    const elementType =
      typeResolver !== undefined
        ? typeResolver.get(layoutField.field.type)
        : resolveCheckedTypeToLayoutKey(layoutField.field.type);
    if (elementType === undefined) {
      diagnostics.push(
        fieldDiagnostic(instanceId, fieldIdValue, {
          code: "LAYOUT_INVALID_LAYOUT_TERM",
          message: "Validated-buffer layout field type cannot be resolved.",
          stableDetail: layoutField.field.name,
          sourceOrigin,
        }),
      );
      availableLayoutFieldIds.add(fieldIdKey(fieldIdValue));
      continue;
    }

    const wireResult = computeWireTypeFact({
      fieldId: fieldIdValue,
      type: layoutField.field.type,
      ...wireEncodingInput(layoutField),
      target: input.target,
      sourceOrigin,
    });
    if (wireResult.kind === "error") {
      diagnostics.push(...wireResult.diagnostics);
      availableLayoutFieldIds.add(fieldIdKey(fieldIdValue));
      continue;
    }
    diagnostics.push(...wireResult.diagnostics);

    const wire = wireResult.value.wire;
    const readPolicy: LayoutWireReadPolicy = wireResult.value.readPolicy;
    const strideTerm = constantTerm(wire.wireStrideBytes, "byteLength");
    const byteLength = multiplyTerms(elementCount, strideTerm, "byteLength");
    const end = addTerms(offsetResult.value.term, byteLength, "byteOffset");
    const isFixed = isFixedField(offsetResult.value.term, byteLength);

    const translationRequirements = [
      ...offsetResult.value.requirements,
      ...elementCountRequirements,
    ];
    const dependencyFieldIds = layoutFieldDependencyFieldIds(layoutField);
    const readRequires = buildLayoutReadRequirements({
      fieldId: fieldIdValue,
      end,
      isFixed,
      translationRequirements,
      dependencyFieldIds,
    });

    if (isFixed && isConstantTerm(end)) {
      fixedEndBytes =
        fixedEndBytes === undefined
          ? end.value
          : end.value > fixedEndBytes
            ? end.value
            : fixedEndBytes;
    }

    const fieldFact: LayoutValidatedBufferFieldFact = {
      fieldId: fieldIdValue,
      name: layoutField.field.name,
      elementType,
      elementValueSizeBytes: wire.wireSizeBytes,
      wire,
      offset: offsetResult.value.term,
      elementCount,
      byteLength,
      end,
      readPolicy,
      readRequires,
      sourceOrigin,
    };

    layoutFields.push(fieldFact);
    intervals.push({
      fieldId: fieldIdValue,
      name: layoutField.field.name,
      offset: offsetResult.value.term,
      end,
      instanceId,
      sourceOrigin,
    });
    availableLayoutFieldIds.add(fieldIdKey(fieldIdValue));
  }

  const intervalValidation = validateLayoutFieldIntervals({ intervals, targetFacts });
  diagnostics.push(...intervalValidation.diagnostics);

  const layoutFieldsWithIntervalRequirements = layoutFields.map((fieldFact) => {
    const intervalRequirements = intervalValidation.intervalRequirementsByFieldId.get(
      fieldFact.fieldId,
    );
    if (intervalRequirements === undefined || intervalRequirements.length === 0) {
      return fieldFact;
    }
    return {
      ...fieldFact,
      readRequires: [...fieldFact.readRequires, ...intervalRequirements],
    };
  });

  const hasErrorDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasErrorDiagnostic) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      layoutFields: layoutFieldsWithIntervalRequirements,
      ...(fixedEndBytes !== undefined ? { fixedEndBytes } : {}),
      sourceLengthTerm: sourceLengthResult.value.term,
    },
    diagnostics,
  };
}

export function computeValidatedBufferFieldFacts(
  input: ComputeValidatedBufferFieldFactsInput,
): LayoutBuilderResult<ValidatedBufferFieldFactsValue> {
  return computeValidatedBufferFieldFactsInternal(input);
}

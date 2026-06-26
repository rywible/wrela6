import type { MonoInstanceId } from "../mono/ids";
import type { MonoLayoutExpression, MonoCheckedType } from "../mono/mono-hir";
import type { MonomorphizedHirProgram } from "../mono/mono-hir";
import type { FieldId } from "../semantic/ids";
import type { LayoutOwnerKey, LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { validatedBufferRootCauseKey, validatedBufferTermOwnerKey } from "./layout-owners";
import type {
  LayoutIntegerRange,
  LayoutReadRequirement,
  LayoutTerm,
  LayoutTermUnit,
  LayoutTypeKey,
  TargetLayoutFacts,
} from "./layout-program";
import type { LayoutTargetSurface } from "./target-layout";
import { normalizeTargetFactsFromSurface } from "./target-facts";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import {
  buildLayoutEnumDiscriminantLookup,
  integerRangeForFieldValueType,
  integerRangeForWireEncoding,
  type LayoutEnumDiscriminantLookup,
  type LayoutFieldWireMetadata,
  wireIntegerEncodingForLayoutField,
} from "./layout-field-value-facts";

export interface TranslateLayoutTermInput {
  readonly expression: MonoLayoutExpression;
  readonly unit: LayoutTermUnit;
  readonly instanceId: MonoInstanceId;
  readonly fieldId: FieldId;
  readonly program?: MonomorphizedHirProgram;
  readonly enumDiscriminantLookup?: LayoutEnumDiscriminantLookup;
  readonly target?: LayoutTargetSurface;
  readonly targetFacts?: TargetLayoutFacts;
  readonly rootCauseKey?: string;
  readonly typeResolver?: LayoutTypeResolver;
  readonly derivedFieldRangeByFieldId?: ReadonlyMap<FieldId, LayoutIntegerRange>;
  readonly layoutFieldWireByFieldId?: ReadonlyMap<FieldId, LayoutFieldWireMetadata>;
}

export interface LayoutTermTranslationValue {
  readonly term: LayoutTerm;
  readonly requirements: readonly LayoutReadRequirement[];
}

export interface AffineNormalizedLayoutTerm {
  readonly constant: bigint;
  readonly coefficients: ReadonlyMap<string, bigint>;
  readonly unit: LayoutTermUnit;
}

export type LayoutTermOrder =
  | { readonly kind: "ordered"; readonly order: "before" | "equal" | "after" }
  | { readonly kind: "ambiguous" };

export function translateLayoutTerm(
  input: TranslateLayoutTermInput,
): LayoutBuilderResult<LayoutTermTranslationValue> {
  const targetFacts =
    input.targetFacts ??
    (input.target !== undefined ? normalizeTargetFactsFromSurface(input.target) : undefined);
  if (targetFacts === undefined) {
    return layoutTermError(
      [],
      "Missing target facts for layout term translation.",
      validatedBufferTermOwnerKey(input.instanceId, input.fieldId),
      validatedBufferRootCauseKey(input.instanceId),
    );
  }

  const instanceId = input.instanceId;
  const layoutFieldId = input.fieldId;
  const ownerKey = validatedBufferTermOwnerKey(instanceId, layoutFieldId);
  const rootCauseKey = input.rootCauseKey ?? validatedBufferRootCauseKey(instanceId);
  const requirements: LayoutReadRequirement[] = [];
  const diagnostics: LayoutDiagnostic[] = [];

  const enumDiscriminantLookup =
    input.enumDiscriminantLookup ??
    (input.program !== undefined ? buildLayoutEnumDiscriminantLookup(input.program) : undefined);

  const termResult = translateExpression({
    expression: input.expression,
    unit: input.unit,
    enumDiscriminantLookup,
    targetFacts,
    typeResolver: input.typeResolver,
    derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
    layoutFieldWireByFieldId: input.layoutFieldWireByFieldId,
    ownerKey,
    rootCauseKey,
    requirements,
    diagnostics,
  });

  if (
    termResult === undefined ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
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
      term: termResult,
      requirements,
    },
    diagnostics,
  };
}

export function normalizeAffineLayoutTerm(
  term: LayoutTerm,
):
  | { readonly kind: "ok"; readonly value: AffineNormalizedLayoutTerm }
  | { readonly kind: "error" } {
  const normalized = normalizeAffineTerm(term);
  if (normalized === undefined) {
    return { kind: "error" };
  }
  return {
    kind: "ok",
    value: {
      constant: normalized.constant,
      coefficients: normalized.coefficients,
      unit: termUnit(term),
    },
  };
}

export function compareLayoutTermOrder(left: LayoutTerm, right: LayoutTerm): LayoutTermOrder {
  if (left.unit !== right.unit) {
    return { kind: "ambiguous" };
  }

  const leftAffine = normalizeAffineTerm(left);
  const rightAffine = normalizeAffineTerm(right);
  if (leftAffine === undefined || rightAffine === undefined) {
    return { kind: "ambiguous" };
  }

  const difference = subtractAffineForms(rightAffine, leftAffine);
  if (isNonNegativeAffineForm(difference)) {
    if (
      difference.constant === 0n &&
      [...difference.coefficients.values()].every((value) => value === 0n)
    ) {
      return { kind: "ordered", order: "equal" };
    }
    return { kind: "ordered", order: "before" };
  }

  if (isNonPositiveAffineForm(difference)) {
    if (
      difference.constant === 0n &&
      [...difference.coefficients.values()].every((value) => value === 0n)
    ) {
      return { kind: "ordered", order: "equal" };
    }
    return { kind: "ordered", order: "after" };
  }

  return { kind: "ambiguous" };
}

interface AffineForm {
  readonly constant: bigint;
  readonly coefficients: Map<string, bigint>;
}

interface TranslateExpressionContext {
  readonly expression: MonoLayoutExpression;
  readonly unit: LayoutTermUnit;
  readonly enumDiscriminantLookup?: LayoutEnumDiscriminantLookup;
  readonly targetFacts: TargetLayoutFacts;
  readonly typeResolver?: LayoutTypeResolver;
  readonly derivedFieldRangeByFieldId?: ReadonlyMap<FieldId, LayoutIntegerRange>;
  readonly layoutFieldWireByFieldId?: ReadonlyMap<FieldId, LayoutFieldWireMetadata>;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly requirements: LayoutReadRequirement[];
  readonly diagnostics: LayoutDiagnostic[];
}

function translateExpression(context: TranslateExpressionContext): LayoutTerm | undefined {
  const { expression } = context;

  switch (expression.kind) {
    case "integerLiteral":
      return translateIntegerLiteral(context, expression.value);
    case "sourceLength":
      return translateSourceLength(context);
    case "fieldValue":
      return translateFieldValue(context, expression);
    case "add":
    case "subtract":
    case "multiply":
      return translateArithmetic(context, expression);
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}

function translateIntegerLiteral(context: TranslateExpressionContext, value: bigint): LayoutTerm {
  return {
    kind: "constant",
    value,
    unit: context.unit,
    range: constantRange(value),
  };
}

function translateSourceLength(context: TranslateExpressionContext): LayoutTerm {
  return {
    kind: "sourceLength",
    unit: "byteLength",
    type: context.targetFacts.sizeType,
    range: sourceLengthRange(context.targetFacts),
  };
}

function translateFieldValue(
  context: TranslateExpressionContext,
  expression: Extract<MonoLayoutExpression, { readonly kind: "fieldValue" }>,
): LayoutTerm | undefined {
  const layoutType = resolveMonoTypeToLayoutKey(expression.type, context.typeResolver);
  if (layoutType === undefined) {
    context.diagnostics.push(
      layoutTermDiagnostic({
        code: "LAYOUT_INVALID_LAYOUT_TERM",
        message: "Layout term field value type cannot be resolved to a layout type key.",
        ownerKey: context.ownerKey,
        rootCauseKey: context.rootCauseKey,
        sourceOrigin: expression.sourceOrigin,
        stableDetail: `${expression.sourceOrigin}:fieldValue`,
      }),
    );
    return undefined;
  }

  if (expression.fieldKind === "derived") {
    const derivedRange = context.derivedFieldRangeByFieldId?.get(expression.fieldId);
    const layoutRange =
      derivedRange ??
      integerRangeForFieldValueType({
        enumDiscriminantLookup: context.enumDiscriminantLookup,
        type: expression.type,
        targetFacts: context.targetFacts,
      });
    return {
      kind: "derivedValue",
      fieldId: expression.fieldId,
      type: layoutType,
      unit: context.unit,
      range: layoutRange,
    };
  }

  if (expression.fieldKind === "layout") {
    const encoding = wireIntegerEncodingForLayoutField({
      fieldId: expression.fieldId,
      type: expression.type,
      targetFacts: context.targetFacts,
      layoutFieldWireByFieldId: context.layoutFieldWireByFieldId ?? new Map(),
    });
    if (encoding === undefined) {
      context.diagnostics.push(
        layoutTermDiagnostic({
          code: "LAYOUT_INVALID_LAYOUT_TERM",
          message: "Layout term layout field value is missing wire encoding.",
          ownerKey: context.ownerKey,
          rootCauseKey: context.rootCauseKey,
          sourceOrigin: expression.sourceOrigin,
          stableDetail: `${expression.sourceOrigin}:fieldValue`,
        }),
      );
      return undefined;
    }
    return {
      kind: "fieldValue",
      fieldId: expression.fieldId,
      source: "layout",
      type: layoutType,
      unit: context.unit,
      encoding,
      range: integerRangeForWireEncoding(encoding),
    };
  }

  return {
    kind: "fieldValue",
    fieldId: expression.fieldId,
    source: "parameter",
    type: layoutType,
    unit: context.unit,
    range: integerRangeForFieldValueType({
      enumDiscriminantLookup: context.enumDiscriminantLookup,
      type: expression.type,
      targetFacts: context.targetFacts,
    }),
  };
}

type MonoLayoutArithmeticExpression = Extract<
  MonoLayoutExpression,
  { readonly kind: "add" | "subtract" | "multiply" }
>;

function translateArithmetic(
  context: TranslateExpressionContext,
  expression: MonoLayoutArithmeticExpression,
): LayoutTerm | undefined {
  const left = translateExpression({ ...context, expression: expression.left });
  if (left === undefined) {
    return undefined;
  }
  const right = translateExpression({ ...context, expression: expression.right });
  if (right === undefined) {
    return undefined;
  }

  switch (expression.kind) {
    case "multiply":
      return translateMultiply(context, expression, left, right);
    case "add":
      return translateAdd(context, expression, left, right);
    case "subtract":
      return translateSubtract(context, expression, left, right);
  }
}

function translateMultiply(
  context: TranslateExpressionContext,
  expression: MonoLayoutArithmeticExpression,
  left: LayoutTerm,
  right: LayoutTerm,
): LayoutTerm | undefined {
  const constantFactor = nonNegativeConstantFactor(left, right);
  if (constantFactor === undefined) {
    context.diagnostics.push(
      layoutTermDiagnostic({
        code: "LAYOUT_INVALID_LAYOUT_TERM",
        message: "Layout multiplication requires one non-negative constant operand.",
        ownerKey: context.ownerKey,
        rootCauseKey: context.rootCauseKey,
        sourceOrigin: expression.sourceOrigin,
        stableDetail: `${expression.sourceOrigin}:multiply`,
      }),
    );
    return undefined;
  }

  const scaled = constantFactor.side === "left" ? right : left;
  const range = multiplyRange(scaled.range, constantFactor.value);
  const term: LayoutTerm = {
    kind: "multiply",
    left: constantFactor.side === "left" ? left : right,
    right: constantFactor.side === "left" ? right : left,
    unit: context.unit,
    range,
  };

  maybePushOverflowRequirement(context, term, range, expression.sourceOrigin);
  return term;
}

function translateAdd(
  context: TranslateExpressionContext,
  expression: MonoLayoutArithmeticExpression,
  left: LayoutTerm,
  right: LayoutTerm,
): LayoutTerm {
  const range = addRange(left.range, right.range);
  const term: LayoutTerm = {
    kind: "add",
    left,
    right,
    unit: context.unit,
    range,
  };

  maybePushOverflowRequirement(context, term, range, expression.sourceOrigin);
  return term;
}

function translateSubtract(
  context: TranslateExpressionContext,
  expression: MonoLayoutArithmeticExpression,
  left: LayoutTerm,
  right: LayoutTerm,
): LayoutTerm {
  const range = subtractRange(left.range, right.range);
  const term: LayoutTerm = {
    kind: "subtract",
    left,
    right,
    unit: context.unit,
    range,
  };

  maybePushSubtractRangeConstraint(context, left, right);
  maybePushOverflowRequirement(context, term, range, expression.sourceOrigin);
  return term;
}

function maybePushSubtractRangeConstraint(
  context: TranslateExpressionContext,
  left: LayoutTerm,
  right: LayoutTerm,
): void {
  if (left.range.minimum >= right.range.maximum) {
    return;
  }

  context.requirements.push({
    kind: "rangeConstraint",
    left: right,
    relation: "<=",
    right: left,
    width: context.targetFacts.sizeType,
  });
}

function maybePushOverflowRequirement(
  context: TranslateExpressionContext,
  term: LayoutTerm,
  range: LayoutIntegerRange,
  sourceOrigin: string,
): void {
  if (range.maximum <= context.targetFacts.maximumObjectSizeBytes) {
    return;
  }

  context.requirements.push({
    kind: "noUnsignedOverflow",
    expression: term,
    width: context.targetFacts.sizeType,
  });

  context.diagnostics.push(
    layoutTermDiagnostic({
      code: "LAYOUT_TERM_ARITHMETIC_OVERFLOW",
      message: "Layout term arithmetic may overflow the target size type.",
      ownerKey: context.ownerKey,
      rootCauseKey: context.rootCauseKey,
      sourceOrigin,
      stableDetail: `${sourceOrigin}:${term.kind}`,
      severity: "note",
    }),
  );
}

function normalizeAffineTerm(term: LayoutTerm): AffineForm | undefined {
  switch (term.kind) {
    case "constant":
      return { constant: term.value, coefficients: new Map() };
    case "sourceLength":
      return {
        constant: 0n,
        coefficients: new Map([["sourceLength", 1n]]),
      };
    case "fieldValue":
      return {
        constant: 0n,
        coefficients: new Map([[fieldSymbolKey(term.source, term.fieldId), 1n]]),
      };
    case "derivedValue":
      return {
        constant: 0n,
        coefficients: new Map([[fieldSymbolKey("derived", term.fieldId), 1n]]),
      };
    case "add": {
      const left = normalizeAffineTerm(term.left);
      const right = normalizeAffineTerm(term.right);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return addAffineForms(left, right);
    }
    case "subtract": {
      const left = normalizeAffineTerm(term.left);
      const right = normalizeAffineTerm(term.right);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return subtractAffineForms(left, right);
    }
    case "multiply": {
      const constantFactor = nonNegativeConstantFactor(term.left, term.right);
      if (constantFactor === undefined) {
        return undefined;
      }
      const scaled = constantFactor.side === "left" ? term.right : term.left;
      const scaledAffine = normalizeAffineTerm(scaled);
      if (scaledAffine === undefined) {
        return undefined;
      }
      return scaleAffineForm(scaledAffine, constantFactor.value);
    }
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

function addAffineForms(left: AffineForm, right: AffineForm): AffineForm {
  return {
    constant: left.constant + right.constant,
    coefficients: mergeCoefficients(left.coefficients, right.coefficients, 1n, 1n),
  };
}

function subtractAffineForms(left: AffineForm, right: AffineForm): AffineForm {
  return {
    constant: left.constant - right.constant,
    coefficients: mergeCoefficients(left.coefficients, right.coefficients, 1n, -1n),
  };
}

function scaleAffineForm(form: AffineForm, factor: bigint): AffineForm {
  const coefficients = new Map<string, bigint>();
  for (const [symbol, coefficient] of form.coefficients) {
    coefficients.set(symbol, coefficient * factor);
  }
  return {
    constant: form.constant * factor,
    coefficients,
  };
}

function mergeCoefficients(
  left: Map<string, bigint>,
  right: Map<string, bigint>,
  leftScale: bigint,
  rightScale: bigint,
): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const [symbol, coefficient] of left) {
    merged.set(symbol, coefficient * leftScale);
  }
  for (const [symbol, coefficient] of right) {
    merged.set(symbol, (merged.get(symbol) ?? 0n) + coefficient * rightScale);
  }
  return merged;
}

function isNonNegativeAffineForm(form: AffineForm): boolean {
  if (form.constant < 0n) {
    return false;
  }
  for (const coefficient of form.coefficients.values()) {
    if (coefficient < 0n) {
      return false;
    }
  }
  return true;
}

function isNonPositiveAffineForm(form: AffineForm): boolean {
  if (form.constant > 0n) {
    return false;
  }
  for (const coefficient of form.coefficients.values()) {
    if (coefficient > 0n) {
      return false;
    }
  }
  return true;
}

function nonNegativeConstantFactor(
  left: LayoutTerm,
  right: LayoutTerm,
): { readonly side: "left" | "right"; readonly value: bigint } | undefined {
  if (left.kind === "constant" && left.value >= 0n) {
    return { side: "left", value: left.value };
  }
  if (right.kind === "constant" && right.value >= 0n) {
    return { side: "right", value: right.value };
  }
  return undefined;
}

function constantRange(value: bigint): LayoutIntegerRange {
  return {
    minimum: value,
    maximum: value,
    provenance: "constant",
  };
}

function sourceLengthRange(targetFacts: TargetLayoutFacts): LayoutIntegerRange {
  return {
    minimum: 0n,
    maximum: targetFacts.maximumObjectSizeBytes,
    provenance: "sourceLength",
  };
}

function addRange(left: LayoutIntegerRange, right: LayoutIntegerRange): LayoutIntegerRange {
  return {
    minimum: left.minimum + right.minimum,
    maximum: left.maximum + right.maximum,
    provenance: "arithmetic",
  };
}

function subtractRange(left: LayoutIntegerRange, right: LayoutIntegerRange): LayoutIntegerRange {
  return {
    minimum: left.minimum - right.maximum,
    maximum: left.maximum - right.minimum,
    provenance: "arithmetic",
  };
}

function multiplyRange(range: LayoutIntegerRange, factor: bigint): LayoutIntegerRange {
  return {
    minimum: range.minimum * factor,
    maximum: range.maximum * factor,
    provenance: "arithmetic",
  };
}

function resolveMonoTypeToLayoutKey(
  type: MonoCheckedType,
  typeResolver?: LayoutTypeResolver,
): LayoutTypeKey | undefined {
  const resolved = typeResolver?.get(type);
  if (resolved !== undefined) {
    return resolved;
  }

  switch (type.kind) {
    case "core":
      return { kind: "core", coreTypeId: type.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: type.targetTypeId };
    case "source":
    case "applied":
    case "genericParameter":
    case "error":
      return undefined;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function fieldSymbolKey(source: "parameter" | "layout" | "derived", fieldIdValue: FieldId): string {
  return `${source}:${String(fieldIdValue)}`;
}

function termUnit(term: LayoutTerm): LayoutTermUnit {
  switch (term.kind) {
    case "constant":
    case "fieldValue":
    case "derivedValue":
    case "add":
    case "subtract":
    case "multiply":
      return term.unit;
    case "sourceLength":
      return term.unit;
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

function layoutTermDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly sourceOrigin: string;
  readonly stableDetail: string;
  readonly severity?: "error" | "warning" | "note";
}) {
  return layoutDiagnostic({
    severity: input.severity ?? "error",
    code: input.code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    sourceOrigin: input.sourceOrigin,
    stableDetail: input.stableDetail,
  });
}

function layoutTermError(
  diagnostics: LayoutDiagnostic[],
  message: string,
  ownerKey: LayoutOwnerKey,
  rootCauseKey: string,
): LayoutBuilderResult<LayoutTermTranslationValue> {
  return {
    kind: "error",
    ownerKey,
    dependencies: [],
    diagnostics: [
      ...diagnostics,
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_INVALID_LAYOUT_TERM",
        message,
        ownerKey,
        rootCauseKey,
        stableDetail: "missing-target-facts:invalid",
      }),
    ],
  };
}

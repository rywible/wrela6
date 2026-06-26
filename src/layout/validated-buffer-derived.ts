import type { MonoInstanceId } from "../mono/ids";
import type {
  MonoDerivedFieldCase,
  MonoLayoutExpression,
  MonomorphizedHirProgram,
} from "../mono/mono-hir";
import type { FieldId } from "../semantic/ids";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import type {
  LayoutDerivedCaseFact,
  LayoutIntegerRange,
  LayoutTerm,
  LayoutTermUnit,
  LayoutTypeKey,
  LayoutValidatedBufferDerivedFact,
  TargetLayoutFacts,
} from "./layout-program";
import type { LayoutTargetSurface } from "./target-layout";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import { normalizeTargetFactsFromSurface } from "./target-facts";
import type { LayoutFieldWireMetadata } from "./layout-field-value-facts";
import { validateDerivedFieldDependencies } from "./validated-buffer-fields";
import {
  derivedFieldFactsOwnerKey,
  validatedBufferDerivedOwnerKey,
  validatedBufferRootCauseKey,
} from "./layout-owners";
import { translateLayoutTerm } from "./validated-buffer-terms";

export interface DerivedFieldDependencyContext {
  readonly parameterFieldIds: ReadonlySet<string>;
  readonly availableLayoutFieldIds: ReadonlySet<string>;
  readonly availableDerivedFieldIds: ReadonlySet<string>;
}

export interface ComputeDerivedFieldFactsInput {
  readonly cases: readonly DerivedFieldCaseInput[];
  readonly source: MonoLayoutExpression;
  readonly fieldId: FieldId;
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly instanceId: MonoInstanceId;
  readonly sourceOrigin: string;
  readonly unit: LayoutTermUnit;
  readonly dependencyContext: DerivedFieldDependencyContext;
  readonly target?: LayoutTargetSurface;
  readonly targetFacts?: TargetLayoutFacts;
  readonly typeResolver?: LayoutTypeResolver;
  readonly program?: MonomorphizedHirProgram;
  readonly layoutFieldWireByFieldId?: ReadonlyMap<FieldId, LayoutFieldWireMetadata>;
  readonly derivedFieldRangeByFieldId?: ReadonlyMap<FieldId, LayoutIntegerRange>;
}
export interface DerivedFieldCaseInput {
  readonly condition: MonoLayoutExpression | { readonly kind: "otherwise" };
  readonly result: MonoLayoutExpression;
  readonly sourceOrigin?: string;
}

export interface DerivedFieldFactsValue {
  readonly fact: LayoutValidatedBufferDerivedFact;
  readonly resultRange: LayoutIntegerRange;
}

type Interval = readonly [minimum: bigint, maximum: bigint];

export function derivedFieldFactsRootCauseKey(instanceId: MonoInstanceId): string {
  return validatedBufferRootCauseKey(instanceId);
}

export function computeDerivedFieldFacts(
  input: ComputeDerivedFieldFactsInput,
): LayoutBuilderResult<DerivedFieldFactsValue> {
  const target = input.target;
  const targetFacts =
    input.targetFacts ??
    (target !== undefined ? normalizeTargetFactsFromSurface(target) : undefined);
  if (targetFacts === undefined) {
    return derivedFieldFactsError(input.instanceId, input.fieldId, [
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_INVALID_LAYOUT_TERM",
        message: "Missing target facts for derived field fact construction.",
        ownerKey: String(derivedFieldFactsOwnerKey(input.instanceId, input.fieldId)),
        rootCauseKey: derivedFieldFactsRootCauseKey(input.instanceId),
        stableDetail: "missing-target-facts",
      }),
    ]);
  }

  const instanceId = input.instanceId;
  const derivedFieldId = input.fieldId;
  const ownerKey = validatedBufferDerivedOwnerKey(instanceId, derivedFieldId);
  const rootCauseKey = derivedFieldFactsRootCauseKey(instanceId);
  const sourceOrigin = input.sourceOrigin;
  const unit = input.unit;
  const sourceExpression = input.source;
  const diagnostics: LayoutDiagnostic[] = [];

  const dependencyContext = input.dependencyContext;

  diagnostics.push(
    ...validateDerivedFieldDependencies({
      expression: sourceExpression,
      instanceId,
      fieldId: derivedFieldId,
      sourceOrigin,
      ...dependencyContext,
    }),
  );
  for (const caseRecord of input.cases) {
    if (caseRecord.condition.kind !== "otherwise") {
      diagnostics.push(
        ...validateDerivedFieldDependencies({
          expression: caseRecord.condition,
          instanceId,
          fieldId: derivedFieldId,
          sourceOrigin: caseRecord.sourceOrigin ?? sourceOrigin,
          ...dependencyContext,
        }),
      );
    }
    diagnostics.push(
      ...validateDerivedFieldDependencies({
        expression: caseRecord.result,
        instanceId,
        fieldId: derivedFieldId,
        sourceOrigin: caseRecord.sourceOrigin ?? sourceOrigin,
        ...dependencyContext,
      }),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  const layoutFieldWireByFieldId =
    input.layoutFieldWireByFieldId ?? new Map<FieldId, LayoutFieldWireMetadata>();

  const sourceTranslation = translateLayoutTerm({
    expression: sourceExpression,
    unit,
    targetFacts,
    instanceId,
    fieldId: derivedFieldId,
    rootCauseKey,
    program: input.program,
    typeResolver: input.typeResolver,
    layoutFieldWireByFieldId,
    derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
  });
  diagnostics.push(...sourceTranslation.diagnostics);

  if (sourceTranslation.kind !== "ok") {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  const sourceTerm = sourceTranslation.value.term;
  const sourceRange = termRange(sourceTerm);
  if (sourceRange === undefined) {
    diagnostics.push(
      derivedFieldDiagnostic(instanceId, derivedFieldId, {
        code: "LAYOUT_TERM_RANGE_MISSING",
        message: "Derived field source term is missing a finite integer range.",
        sourceOrigin,
        stableDetail: `${sourceOrigin}:source`,
      }),
    );
    return { kind: "error", ownerKey, dependencies: [], diagnostics };
  }

  const normalizedCases = normalizeDerivedFieldCases(input.cases, sourceOrigin);
  const otherwiseValidation = validateOtherwisePlacement(
    normalizedCases,
    instanceId,
    derivedFieldId,
  );
  if (otherwiseValidation.kind === "error") {
    diagnostics.push(...otherwiseValidation.diagnostics);
    return { kind: "error", ownerKey, dependencies: [], diagnostics };
  }

  const seenEqualityValues = new Set<string>();
  let remainingCoverage: Interval[] = [[sourceRange.minimum, sourceRange.maximum]];
  const caseFacts: LayoutDerivedCaseFact[] = [];
  const resultRanges: LayoutIntegerRange[] = [];
  let hasOtherwise = false;

  for (const caseRecord of normalizedCases) {
    if (caseRecord.condition.kind === "otherwise") {
      hasOtherwise = true;
      const resultTranslation = translateCaseResult({
        caseRecord,
        unit,
        targetFacts,
        instanceId,
        derivedFieldId,
        rootCauseKey,
        program: input.program,
        typeResolver: input.typeResolver,
        layoutFieldWireByFieldId,
        derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
        diagnostics,
      });
      if (resultTranslation === undefined) {
        continue;
      }
      resultRanges.push(termRange(resultTranslation)!);
      caseFacts.push({
        condition: { kind: "otherwise" },
        result: resultTranslation,
        sourceOrigin: caseRecord.sourceOrigin,
      });
      continue;
    }

    const conditionTranslation = translateLayoutTerm({
      expression: caseRecord.condition,
      unit,
      targetFacts,
      instanceId,
      fieldId: derivedFieldId,
      rootCauseKey,
      program: input.program,
      typeResolver: input.typeResolver,
      layoutFieldWireByFieldId,
      derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
    });
    diagnostics.push(...conditionTranslation.diagnostics);
    if (conditionTranslation.kind !== "ok") {
      continue;
    }

    const equalityValue = constantTermValue(conditionTranslation.value.term);
    if (equalityValue === undefined) {
      diagnostics.push(
        derivedFieldDiagnostic(instanceId, derivedFieldId, {
          code: "LAYOUT_INVALID_LAYOUT_TERM",
          message: "Derived case condition must be an equality constant value.",
          sourceOrigin: caseRecord.sourceOrigin,
          stableDetail: `${caseRecord.sourceOrigin}:case-condition`,
        }),
      );
      continue;
    }

    if (equalityValue < sourceRange.minimum || equalityValue > sourceRange.maximum) {
      diagnostics.push(
        derivedFieldDiagnostic(instanceId, derivedFieldId, {
          code: "LAYOUT_DERIVED_CASE_OUT_OF_RANGE",
          message: "Derived case equality value is outside the source term range.",
          sourceOrigin: caseRecord.sourceOrigin,
          stableDetail: `${caseRecord.sourceOrigin}:${equalityValue.toString()}`,
        }),
      );
      continue;
    }

    const equalityKey = equalityValue.toString();
    if (seenEqualityValues.has(equalityKey)) {
      diagnostics.push(
        derivedFieldDiagnostic(instanceId, derivedFieldId, {
          code: "LAYOUT_DERIVED_DUPLICATE_CASE",
          message: "Derived case equality value duplicates an earlier case.",
          sourceOrigin: caseRecord.sourceOrigin,
          stableDetail: `${caseRecord.sourceOrigin}:${equalityKey}`,
        }),
      );
      continue;
    }
    seenEqualityValues.add(equalityKey);
    remainingCoverage = subtractPointFromIntervals(remainingCoverage, equalityValue);

    const resultTranslation = translateCaseResult({
      caseRecord,
      unit,
      targetFacts,
      instanceId,
      derivedFieldId,
      rootCauseKey,
      program: input.program,
      typeResolver: input.typeResolver,
      layoutFieldWireByFieldId,
      derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
      diagnostics,
    });
    if (resultTranslation === undefined) {
      continue;
    }

    const resultRange = termRange(resultTranslation);
    if (resultRange === undefined) {
      diagnostics.push(
        derivedFieldDiagnostic(instanceId, derivedFieldId, {
          code: "LAYOUT_TERM_RANGE_MISSING",
          message: "Derived case result term is missing a finite integer range.",
          sourceOrigin: caseRecord.sourceOrigin,
          stableDetail: `${caseRecord.sourceOrigin}:case-result`,
        }),
      );
      continue;
    }

    resultRanges.push(resultRange);
    caseFacts.push({
      condition: {
        kind: "equals",
        value: conditionTranslation.value.term,
      },
      result: resultTranslation,
      sourceOrigin: caseRecord.sourceOrigin,
    });
  }

  if (!hasOtherwise && remainingCoverage.length > 0) {
    diagnostics.push(
      derivedFieldDiagnostic(instanceId, derivedFieldId, {
        code: "LAYOUT_DERIVED_CASE_NOT_TOTAL",
        message: "Derived case table does not completely cover the source term range.",
        sourceOrigin,
        stableDetail: `${sourceOrigin}:coverage-gap`,
      }),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { kind: "error", ownerKey, dependencies: [], diagnostics };
  }

  const resultRange = unionIntegerRanges(resultRanges);
  const fact: LayoutValidatedBufferDerivedFact = {
    fieldId: derivedFieldId,
    name: input.name,
    type: input.type,
    source: sourceTerm,
    cases: caseFacts,
    sourceOrigin,
  };

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: {
      fact,
      resultRange,
    },
    diagnostics,
  };
}

function normalizeDerivedFieldCases(
  cases: readonly DerivedFieldCaseInput[],
  derivedSourceOrigin: string,
): readonly MonoDerivedFieldCase[] {
  return cases.map((caseRecord, index) => ({
    condition: caseRecord.condition,
    result: caseRecord.result,
    sourceOrigin: caseRecord.sourceOrigin ?? `${derivedSourceOrigin}:case:${index}`,
  }));
}

function validateOtherwisePlacement(
  cases: readonly MonoDerivedFieldCase[],
  instanceId: MonoInstanceId,
  derivedFieldId: FieldId,
):
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const diagnostics: LayoutDiagnostic[] = [];
  let otherwiseCount = 0;

  for (let index = 0; index < cases.length; index += 1) {
    const caseRecord = cases[index]!;
    if (caseRecord.condition.kind !== "otherwise") {
      continue;
    }
    otherwiseCount += 1;
    if (index !== cases.length - 1) {
      diagnostics.push(
        derivedFieldDiagnostic(instanceId, derivedFieldId, {
          code: "LAYOUT_DERIVED_OTHERWISE_NOT_LAST",
          message: "Derived otherwise case must be the last case in source order.",
          sourceOrigin: caseRecord.sourceOrigin,
          stableDetail: `${caseRecord.sourceOrigin}:otherwise-not-last`,
        }),
      );
    }
  }

  if (otherwiseCount > 1) {
    diagnostics.push(
      derivedFieldDiagnostic(instanceId, derivedFieldId, {
        code: "LAYOUT_DERIVED_OTHERWISE_NOT_LAST",
        message: "Derived field allows at most one otherwise case.",
        sourceOrigin: cases.find((caseRecord) => caseRecord.condition.kind === "otherwise")
          ?.sourceOrigin,
        stableDetail: "multiple-otherwise",
      }),
    );
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  return { kind: "ok" };
}

function translateCaseResult(input: {
  readonly caseRecord: MonoDerivedFieldCase;
  readonly unit: LayoutTermUnit;
  readonly targetFacts: TargetLayoutFacts;
  readonly instanceId: MonoInstanceId;
  readonly derivedFieldId: FieldId;
  readonly rootCauseKey: string;
  readonly program?: MonomorphizedHirProgram;
  readonly typeResolver?: LayoutTypeResolver;
  readonly layoutFieldWireByFieldId: ReadonlyMap<FieldId, LayoutFieldWireMetadata>;
  readonly derivedFieldRangeByFieldId?: ReadonlyMap<FieldId, LayoutIntegerRange>;
  readonly diagnostics: LayoutDiagnostic[];
}): LayoutTerm | undefined {
  const resultTranslation = translateLayoutTerm({
    expression: input.caseRecord.result,
    unit: input.unit,
    targetFacts: input.targetFacts,
    instanceId: input.instanceId,
    fieldId: input.derivedFieldId,
    rootCauseKey: input.rootCauseKey,
    program: input.program,
    typeResolver: input.typeResolver,
    layoutFieldWireByFieldId: input.layoutFieldWireByFieldId,
    derivedFieldRangeByFieldId: input.derivedFieldRangeByFieldId,
  });
  input.diagnostics.push(...resultTranslation.diagnostics);
  if (resultTranslation.kind !== "ok") {
    return undefined;
  }
  return resultTranslation.value.term;
}

function derivedFieldDiagnostic(
  instanceId: MonoInstanceId,
  derivedFieldId: FieldId,
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
    ownerKey: String(derivedFieldFactsOwnerKey(instanceId, derivedFieldId)),
    rootCauseKey: derivedFieldFactsRootCauseKey(instanceId),
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
  });
}

function derivedFieldFactsError(
  instanceId: MonoInstanceId,
  derivedFieldId: FieldId,
  diagnostics: readonly LayoutDiagnostic[],
): LayoutBuilderResult<DerivedFieldFactsValue> {
  return {
    kind: "error",
    ownerKey: validatedBufferDerivedOwnerKey(instanceId, derivedFieldId),
    dependencies: [],
    diagnostics,
  };
}

function constantTermValue(term: LayoutTerm): bigint | undefined {
  if (term.kind !== "constant") {
    return undefined;
  }
  return term.value;
}

function termRange(term: LayoutTerm): LayoutIntegerRange | undefined {
  switch (term.kind) {
    case "constant":
    case "sourceLength":
    case "fieldValue":
    case "derivedValue":
    case "add":
    case "subtract":
    case "multiply":
      return term.range;
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

function subtractPointFromIntervals(intervals: Interval[], value: bigint): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals) {
    const [minimum, maximum] = interval;
    if (value < minimum || value > maximum) {
      result.push(interval);
      continue;
    }
    if (minimum < value) {
      result.push([minimum, value - 1n]);
    }
    if (value < maximum) {
      result.push([value + 1n, maximum]);
    }
  }
  return result;
}

function unionIntegerRanges(ranges: readonly LayoutIntegerRange[]): LayoutIntegerRange {
  if (ranges.length === 0) {
    return {
      minimum: 0n,
      maximum: 0n,
      provenance: "derivedCases",
    };
  }

  let minimum = ranges[0]!.minimum;
  let maximum = ranges[0]!.maximum;
  for (let index = 1; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    if (range.minimum < minimum) {
      minimum = range.minimum;
    }
    if (range.maximum > maximum) {
      maximum = range.maximum;
    }
  }

  return {
    minimum,
    maximum,
    provenance: "derivedCases",
  };
}

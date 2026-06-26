import type {
  HirFieldRecord,
  HirRequirement,
  HirValidatedBuffer,
  TypedHirProgram,
} from "../hir/hir";
import type { HirRequirementId } from "../hir/ids";
import type { FieldId } from "../semantic/ids";
import type { ConcreteResourceKind } from "../semantic/surface/resource-kind";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import type { MonoInstanceId } from "./ids";
import {
  instantiateMonoDerivedFieldCases,
  instantiateMonoLayoutExpression,
  type LayoutExpressionContext,
} from "./layout-expression-instantiator";
import { normalizeMonoCheckedType, type MonoTypeNormalizationContext } from "./instantiation-key";
import type {
  MonoCheckedType,
  MonoFieldRecord,
  MonoInstantiatedProofId,
  MonoLayoutExpression,
  MonoRequirement,
  MonoRequirementExpression,
  MonoValidatedBuffer,
  MonoValidatedBufferDerivedField,
  MonoValidatedBufferLayoutField,
} from "./mono-hir";
import {
  concretizeResourceKind,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import {
  substituteCheckedType,
  substituteRequirementExpression,
  type MonoSubstitution,
} from "./substitution";

type SubstituteValidatedBufferFieldsResult =
  | { readonly kind: "ok"; readonly fields: readonly MonoFieldRecord[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

type SubstituteValidatedBufferRequirementsResult =
  | { readonly kind: "ok"; readonly requirements: readonly MonoRequirement[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export type BuildMonoValidatedBufferResult =
  | { readonly kind: "ok"; readonly validatedBuffer: MonoValidatedBuffer }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function buildMonoFieldRecord(input: {
  readonly ownerTypeInstanceId: MonoInstanceId;
  readonly sourceField: HirFieldRecord;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
}): MonoFieldRecord {
  return {
    fieldId: input.sourceField.fieldId,
    ownerTypeInstanceId: input.ownerTypeInstanceId,
    name: input.sourceField.name,
    type: input.type,
    resourceKind: input.resourceKind,
    sourceOrigin: String(input.sourceField.sourceOrigin),
  };
}

function substituteValidatedBufferFieldRecords(input: {
  readonly sourceFields: readonly HirFieldRecord[];
  readonly ownerTypeInstanceId: MonoInstanceId;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly normalizationContext: MonoTypeNormalizationContext;
}): SubstituteValidatedBufferFieldsResult {
  const fields: MonoFieldRecord[] = [];
  for (const sourceField of input.sourceFields) {
    const substitutedResult = substituteCheckedType(sourceField.type, input.substitution);
    if (substitutedResult.diagnostics.length > 0) {
      return { kind: "error", diagnostics: substitutedResult.diagnostics };
    }
    const normalizedResult = normalizeMonoCheckedType(
      substitutedResult.type,
      input.normalizationContext,
    );
    if (normalizedResult.kind === "error") {
      return { kind: "error", diagnostics: normalizedResult.diagnostics };
    }
    const kindResult = concretizeResourceKind({
      kind: sourceField.resourceKind,
      ...(normalizedResult.type.kind === "applied" ? { appliedType: normalizedResult.type } : {}),
      ...(normalizedResult.type.kind === "target"
        ? { targetTypeId: normalizedResult.type.targetTypeId }
        : {}),
      context: input.context,
    });
    if (kindResult.kind === "error") {
      return { kind: "error", diagnostics: [kindResult.diagnostic] };
    }
    fields.push(
      buildMonoFieldRecord({
        ownerTypeInstanceId: input.ownerTypeInstanceId,
        sourceField,
        type: normalizedResult.type,
        resourceKind: kindResult.value,
      }),
    );
  }
  return { kind: "ok", fields };
}

function collectValidatedBufferSourceFieldRecords(input: {
  readonly sourceValidatedBuffer: HirValidatedBuffer;
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
}):
  | { readonly kind: "ok"; readonly fields: readonly HirFieldRecord[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] } {
  const sourceFields: HirFieldRecord[] = [];
  const seen = new Set<FieldId>();

  const appendField = (field: HirFieldRecord) => {
    if (seen.has(field.fieldId)) {
      return;
    }
    seen.add(field.fieldId);
    sourceFields.push(field);
  };

  for (const fieldId of input.sourceValidatedBuffer.parameterFields) {
    const sourceField = input.program.fields.get(fieldId);
    if (sourceField === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_HIR_FIELD",
            message: "Validated buffer field is missing from the HIR program.",
            ownerKey: `field:${fieldId}`,
            rootCauseKey: "source-field",
            stableDetail: `missing:${fieldId}`,
            sourceOrigin: String(input.substitution.sourceOrigin),
          }),
        ],
      };
    }
    appendField(sourceField);
  }

  for (const layoutField of input.sourceValidatedBuffer.layoutFields) {
    appendField(layoutField.field);
  }
  for (const derivedField of input.sourceValidatedBuffer.derivedFields) {
    appendField(derivedField.field);
  }

  return { kind: "ok", fields: sourceFields };
}

function monoTypeRequirementIdFor(
  instanceId: MonoInstanceId,
  hirRequirementId: HirRequirementId,
): MonoInstantiatedProofId<HirRequirementId> {
  return {
    owner: { kind: "type", instanceId },
    hirId: hirRequirementId,
    instanceId,
  };
}

function substituteValidatedBufferRequirements(input: {
  readonly requirements: readonly HirRequirement[];
  readonly instanceId: MonoInstanceId;
  readonly substitution: MonoSubstitution;
}): SubstituteValidatedBufferRequirementsResult {
  const requirements: MonoRequirement[] = [];
  for (const requirement of input.requirements) {
    const substitutionResult = substituteRequirementExpression(
      requirement.expression as MonoRequirementExpression,
      input.substitution,
    );
    if (substitutionResult.diagnostics.length > 0) {
      return { kind: "error", diagnostics: substitutionResult.diagnostics };
    }
    const requirementId = monoTypeRequirementIdFor(input.instanceId, requirement.requirementId.id);
    requirements.push({
      requirementId,
      owner: { kind: "type", typeInstanceId: input.instanceId },
      expression: substitutionResult.expression,
      sourceOrigin: String(requirement.sourceOrigin),
    });
  }
  return { kind: "ok", requirements };
}

export function buildMonoValidatedBuffer(input: {
  readonly sourceValidatedBuffer: HirValidatedBuffer;
  readonly instanceId: MonoInstanceId;
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly normalizationContext: MonoTypeNormalizationContext;
}): BuildMonoValidatedBufferResult {
  const sourceFieldRecordsResult = collectValidatedBufferSourceFieldRecords({
    sourceValidatedBuffer: input.sourceValidatedBuffer,
    program: input.program,
    substitution: input.substitution,
  });
  if (sourceFieldRecordsResult.kind === "error") {
    return { kind: "error", diagnostics: sourceFieldRecordsResult.diagnostics };
  }

  const substitutedFieldResult = substituteValidatedBufferFieldRecords({
    sourceFields: sourceFieldRecordsResult.fields,
    ownerTypeInstanceId: input.instanceId,
    substitution: input.substitution,
    context: input.context,
    normalizationContext: input.normalizationContext,
  });
  if (substitutedFieldResult.kind === "error") {
    return { kind: "error", diagnostics: substitutedFieldResult.diagnostics };
  }

  const fieldById = new Map<FieldId, MonoFieldRecord>();
  for (const field of substitutedFieldResult.fields) {
    fieldById.set(field.fieldId, field);
  }
  const parameterFields = input.sourceValidatedBuffer.parameterFields.flatMap((fieldId) => {
    const field = fieldById.get(fieldId);
    return field === undefined ? [] : [field];
  });
  if (parameterFields.length !== input.sourceValidatedBuffer.parameterFields.length) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_HIR_FIELD",
          message: "Validated buffer parameter field is missing after substitution.",
          ownerKey: `type:${input.sourceValidatedBuffer.typeId}`,
          rootCauseKey: "source-field",
          stableDetail: "missing-parameter-field",
          sourceOrigin: String(input.sourceValidatedBuffer.sourceOrigin),
        }),
      ],
    };
  }
  const layoutExpressionContext: LayoutExpressionContext = {
    program: input.program,
    fieldById,
  };
  const layoutFields: MonoValidatedBufferLayoutField[] = [];
  for (const layoutField of input.sourceValidatedBuffer.layoutFields) {
    const monoField = fieldById.get(layoutField.field.fieldId);
    if (monoField === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_HIR_FIELD",
            message: "Validated buffer layout field is missing from the HIR program.",
            ownerKey: `field:${layoutField.field.fieldId}`,
            rootCauseKey: "source-field",
            stableDetail: `missing:${layoutField.field.fieldId}`,
            sourceOrigin: String(layoutField.sourceOrigin),
          }),
        ],
      };
    }
    const offsetResult = instantiateMonoLayoutExpression({
      expression: layoutField.offset,
      context: layoutExpressionContext,
    });
    if (offsetResult.kind === "error") {
      return { kind: "error", diagnostics: offsetResult.diagnostics };
    }
    let length: MonoLayoutExpression | undefined;
    if (layoutField.length !== undefined) {
      const lengthResult = instantiateMonoLayoutExpression({
        expression: layoutField.length,
        context: layoutExpressionContext,
      });
      if (lengthResult.kind === "error") {
        return { kind: "error", diagnostics: lengthResult.diagnostics };
      }
      length = lengthResult.expression;
    }
    layoutFields.push({
      field: monoField,
      offset: offsetResult.expression,
      ...(length !== undefined ? { length } : {}),
      ...(layoutField.layoutWireEndian !== undefined
        ? { layoutWireEndian: layoutField.layoutWireEndian }
        : {}),
      ...(layoutField.wireEncoding !== undefined ? { wireEncoding: layoutField.wireEncoding } : {}),
      sourceOrigin: String(layoutField.sourceOrigin),
    });
    fieldById.set(monoField.fieldId, monoField);
  }
  const derivedFields: MonoValidatedBufferDerivedField[] = [];
  for (const derivedField of input.sourceValidatedBuffer.derivedFields) {
    const monoField = fieldById.get(derivedField.field.fieldId);
    if (monoField === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_HIR_FIELD",
            message: "Validated buffer derived field is missing from the HIR program.",
            ownerKey: `field:${derivedField.field.fieldId}`,
            rootCauseKey: "source-field",
            stableDetail: `missing:${derivedField.field.fieldId}`,
            sourceOrigin: String(derivedField.sourceOrigin),
          }),
        ],
      };
    }
    const sourceResult = instantiateMonoLayoutExpression({
      expression: derivedField.source,
      context: layoutExpressionContext,
    });
    if (sourceResult.kind === "error") {
      return { kind: "error", diagnostics: sourceResult.diagnostics };
    }
    const casesResult = instantiateMonoDerivedFieldCases({
      cases: derivedField.cases,
      context: layoutExpressionContext,
    });
    if (casesResult.kind === "error") {
      return { kind: "error", diagnostics: casesResult.diagnostics };
    }
    derivedFields.push({
      field: monoField,
      source: sourceResult.expression,
      cases: casesResult.cases,
      sourceOrigin: String(derivedField.sourceOrigin),
    });
    fieldById.set(monoField.fieldId, monoField);
  }
  const requirementsResult = substituteValidatedBufferRequirements({
    requirements: input.sourceValidatedBuffer.requirements,
    instanceId: input.instanceId,
    substitution: input.substitution,
  });
  if (requirementsResult.kind === "error") {
    return { kind: "error", diagnostics: requirementsResult.diagnostics };
  }
  return {
    kind: "ok",
    validatedBuffer: {
      instanceId: input.instanceId,
      typeId: input.sourceValidatedBuffer.typeId,
      itemId: input.sourceValidatedBuffer.itemId,
      parameterFields,
      layoutDerivedFieldOrder: input.sourceValidatedBuffer.layoutDerivedFieldOrder,
      layoutFields,
      derivedFields,
      requirements: requirementsResult.requirements,
      sourceOrigin: String(input.sourceValidatedBuffer.sourceOrigin),
    },
  };
}

import type {
  HirFieldRecord,
  HirRequirement,
  HirValidatedBuffer,
  TypedHirProgram,
} from "../hir/hir";
import type { HirRequirementId } from "../hir/ids";
import type { FieldId, ImageId, TypeId } from "../semantic/ids";
import type { ConcreteResourceKind } from "../semantic/surface/resource-kind";
import { concreteKind } from "../semantic/surface/resource-kind";
import { appliedType } from "../semantic/surface/type-model";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import type { MonoInstanceId } from "./ids";
import { checkInstanceEligibility } from "./instance-eligibility";
import {
  canonicalTypeInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "./instantiation-key";
import type {
  MonoCheckedType,
  MonoFieldRecord,
  MonoInstantiatedProofId,
  MonoRequirement,
  MonoRequirementExpression,
  MonoTypeInstance,
  MonoValidatedBuffer,
} from "./mono-hir";
import {
  concretizeResourceKind,
  type ConcretizeFieldKindsResult,
  type FieldKindProvider,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import {
  buildMonoSubstitution,
  substituteCheckedType,
  substituteRequirementExpression,
  type MonoSubstitution,
} from "./substitution";

export interface MonoTypeAncestry {
  readonly activeTypeKeys: ReadonlySet<string>;
  isInProgress(typeKey: string): boolean;
  enter(typeKey: string): MonoTypeAncestry;
  exit(): MonoTypeAncestry;
}

export interface InstantiateMonoTypeInput {
  readonly program: TypedHirProgram;
  readonly key: { readonly typeId: TypeId; readonly typeArguments: readonly MonoCheckedType[] };
  readonly source: { readonly kind: "image"; readonly imageId: ImageId };
  readonly ancestry: MonoTypeAncestry;
  readonly fieldKindProvider?: FieldKindProvider;
}

export type InstantiateMonoTypeResult =
  | {
      readonly kind: "ok";
      readonly instance: MonoTypeInstance;
      readonly substitution: MonoSubstitution;
      readonly validatedBuffer?: MonoValidatedBuffer;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoType(input: InstantiateMonoTypeInput): InstantiateMonoTypeResult {
  const sourceType = input.program.types.get(input.key.typeId);
  if (sourceType === undefined) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_REACHABLE_TYPE",
          message: "Reachable type is missing from the HIR program.",
          ownerKey: `type:${input.key.typeId}`,
          rootCauseKey: "source-type",
          stableDetail: `missing:${input.key.typeId}`,
          sourceOrigin: String(input.source.imageId),
        }),
      ],
    };
  }

  const instanceId = canonicalTypeInstanceId({
    typeId: input.key.typeId,
    typeArguments: input.key.typeArguments,
  });
  const canonicalKey = String(instanceId);

  if (input.ancestry.isInProgress(canonicalKey)) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_RECURSIVE_TYPE_CYCLE",
          message: "Recursive source type cycle.",
          ownerKey: `type:${input.key.typeId}`,
          rootCauseKey: "recursion",
          stableDetail: `cycle:${canonicalKey}`,
          sourceOrigin: String(sourceType.sourceOrigin),
        }),
      ],
    };
  }

  const substitutionResult = buildMonoSubstitution({
    ownerParameters: sourceType.declaredTypeParameters,
    ownerArguments: input.key.typeArguments,
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: sourceType.sourceOrigin,
  });
  if (substitutionResult.kind === "error") {
    return { kind: "error", diagnostics: substitutionResult.diagnostics };
  }
  const activeAncestry = input.ancestry.enter(canonicalKey);
  const provider =
    input.fieldKindProvider ??
    recursiveFieldKindProvider({
      program: input.program,
      source: input.source,
      ancestry: activeAncestry,
    });
  const concretizationContext: MonoResourceKindConcretizationContext = {
    program: input.program,
    substitution: substitutionResult.substitution,
    fieldKindProvider: provider,
    canonicalInstanceKey: canonicalKey,
  };
  const eligibilityResult = checkInstanceEligibility({
    owner: { kind: "type", typeId: input.key.typeId },
    parameters: sourceType.declaredTypeParameters,
    arguments: input.key.typeArguments,
    rules: input.program.monoClosure.instanceEligibilityRules,
    canonicalInstanceKey: canonicalKey,
    context: concretizationContext,
  });
  if (eligibilityResult.kind === "error") {
    return { kind: "error", diagnostics: eligibilityResult.diagnostics };
  }

  const normalizationContext: MonoTypeNormalizationContext = {
    targetTypeKinds: input.program.monoClosure.targetTypeKinds,
    constructorKindRules: input.program.monoClosure.constructorKindRules,
    sourceOrigin: sourceType.sourceOrigin,
  };

  const fieldInstances: MonoFieldRecord[] = [];
  for (const fieldId of sourceType.fieldIds) {
    const sourceField = input.program.fields.get(fieldId);
    if (sourceField === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_HIR_FIELD",
            message: "Source field is missing from the HIR program.",
            ownerKey: `type:${input.key.typeId}:field:${fieldId}`,
            rootCauseKey: "source-field",
            stableDetail: `missing:${fieldId}`,
            sourceOrigin: String(sourceType.sourceOrigin),
          }),
        ],
      };
    }
    const substitutedResult = substituteCheckedType(
      sourceField.type,
      substitutionResult.substitution,
    );
    if (substitutedResult.diagnostics.length > 0) {
      return { kind: "error", diagnostics: substitutedResult.diagnostics };
    }
    const normalizedResult = normalizeMonoCheckedType(substitutedResult.type, normalizationContext);
    if (normalizedResult.kind === "error") {
      return { kind: "error", diagnostics: normalizedResult.diagnostics };
    }
    const kindResult = concretizeResourceKind({
      kind: sourceField.resourceKind,
      ...(normalizedResult.type.kind === "applied" ? { appliedType: normalizedResult.type } : {}),
      ...(normalizedResult.type.kind === "target"
        ? { targetTypeId: normalizedResult.type.targetTypeId }
        : {}),
      context: concretizationContext,
    });
    if (kindResult.kind === "error") {
      return { kind: "error", diagnostics: [kindResult.diagnostic] };
    }
    fieldInstances.push(
      buildMonoFieldRecord({
        ownerTypeInstanceId: instanceId,
        sourceField,
        type: normalizedResult.type,
        resourceKind: kindResult.value,
      }),
    );
  }

  const normalizedTypeApplication = normalizeMonoCheckedType(
    appliedType({
      constructor: { kind: "source", typeId: input.key.typeId },
      arguments: input.key.typeArguments,
      resourceKind: concreteKind("Copy"),
    }),
    normalizationContext,
  );
  if (normalizedTypeApplication.kind === "error") {
    return { kind: "error", diagnostics: normalizedTypeApplication.diagnostics };
  }
  const typeResourceKindResult = concretizeResourceKind({
    kind: sourceType.resourceKind,
    appliedType: normalizedTypeApplication.type,
    context: concretizationContext,
  });
  if (typeResourceKindResult.kind === "error") {
    return { kind: "error", diagnostics: [typeResourceKindResult.diagnostic] };
  }
  const typeResourceKind: ConcreteResourceKind = typeResourceKindResult.value;

  const instance: MonoTypeInstance = {
    instanceId,
    sourceTypeId: sourceType.typeId,
    sourceItemId: sourceType.itemId,
    sourceKind: sourceType.sourceKind,
    typeArguments: input.key.typeArguments,
    fields: fieldInstances,
    resourceKind: typeResourceKind,
    sourceOrigin: String(sourceType.sourceOrigin),
  };

  const sourceValidatedBuffer = input.program.validatedBuffers.get(input.key.typeId);
  let validatedBuffer: MonoValidatedBuffer | undefined;
  if (sourceValidatedBuffer !== undefined) {
    const validatedBufferResult = buildMonoValidatedBuffer({
      sourceValidatedBuffer,
      instanceId,
      program: input.program,
      substitution: substitutionResult.substitution,
      context: concretizationContext,
      normalizationContext,
    });
    if (validatedBufferResult.kind === "error") {
      return { kind: "error", diagnostics: validatedBufferResult.diagnostics };
    }
    validatedBuffer = validatedBufferResult.validatedBuffer;
  }

  return {
    kind: "ok",
    instance,
    substitution: substitutionResult.substitution,
    ...(validatedBuffer !== undefined ? { validatedBuffer } : {}),
  };
}

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

type SubstituteValidatedBufferFieldsResult =
  | { readonly kind: "ok"; readonly fields: readonly MonoFieldRecord[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteValidatedBufferFields(input: {
  readonly fieldIds: readonly FieldId[];
  readonly ownerTypeInstanceId: MonoInstanceId;
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly normalizationContext: MonoTypeNormalizationContext;
}): SubstituteValidatedBufferFieldsResult {
  const fields: MonoFieldRecord[] = [];
  for (const fieldId of input.fieldIds) {
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

type SubstituteValidatedBufferRequirementsResult =
  | { readonly kind: "ok"; readonly requirements: readonly MonoRequirement[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

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

type BuildMonoValidatedBufferResult =
  | { readonly kind: "ok"; readonly validatedBuffer: MonoValidatedBuffer }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function buildMonoValidatedBuffer(input: {
  readonly sourceValidatedBuffer: HirValidatedBuffer;
  readonly instanceId: MonoInstanceId;
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly normalizationContext: MonoTypeNormalizationContext;
}): BuildMonoValidatedBufferResult {
  const parameterFieldsResult = substituteValidatedBufferFields({
    fieldIds: input.sourceValidatedBuffer.parameterFields,
    ownerTypeInstanceId: input.instanceId,
    program: input.program,
    substitution: input.substitution,
    context: input.context,
    normalizationContext: input.normalizationContext,
  });
  if (parameterFieldsResult.kind === "error") {
    return { kind: "error", diagnostics: parameterFieldsResult.diagnostics };
  }
  const layoutFieldsResult = substituteValidatedBufferFields({
    fieldIds: input.sourceValidatedBuffer.layoutFields,
    ownerTypeInstanceId: input.instanceId,
    program: input.program,
    substitution: input.substitution,
    context: input.context,
    normalizationContext: input.normalizationContext,
  });
  if (layoutFieldsResult.kind === "error") {
    return { kind: "error", diagnostics: layoutFieldsResult.diagnostics };
  }
  const derivedFieldsResult = substituteValidatedBufferFields({
    fieldIds: input.sourceValidatedBuffer.derivedFields,
    ownerTypeInstanceId: input.instanceId,
    program: input.program,
    substitution: input.substitution,
    context: input.context,
    normalizationContext: input.normalizationContext,
  });
  if (derivedFieldsResult.kind === "error") {
    return { kind: "error", diagnostics: derivedFieldsResult.diagnostics };
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
      parameterFields: parameterFieldsResult.fields,
      layoutFields: layoutFieldsResult.fields,
      derivedFields: derivedFieldsResult.fields,
      requirements: requirementsResult.requirements,
      sourceOrigin: String(input.sourceValidatedBuffer.sourceOrigin),
    },
  };
}

export function recursiveFieldKindProvider(input: {
  readonly program: TypedHirProgram;
  readonly source: { readonly kind: "image"; readonly imageId: ImageId };
  readonly ancestry: MonoTypeAncestry;
}): FieldKindProvider {
  return {
    fieldKindsForType(fieldInput): ConcretizeFieldKindsResult {
      const result = instantiateMonoType({
        program: input.program,
        key: {
          typeId: fieldInput.typeId,
          typeArguments: fieldInput.typeArguments,
        },
        source: input.source,
        ancestry: input.ancestry,
      });
      if (result.kind === "error") {
        return { kind: "error", diagnostics: result.diagnostics };
      }
      return {
        kind: "ok",
        fieldKinds: result.instance.fields.map((field) => field.resourceKind),
      };
    },
  };
}

export function monoTypeAncestry(
  active: ReadonlySet<string> = new Set<string>(),
): MonoTypeAncestry {
  const enter = (typeKey: string): MonoTypeAncestry => {
    const next = new Set(active);
    next.add(typeKey);
    return monoTypeAncestry(next);
  };
  return {
    activeTypeKeys: active,
    isInProgress: (typeKey) => active.has(typeKey),
    enter,
    exit: () => monoTypeAncestry(active),
  };
}

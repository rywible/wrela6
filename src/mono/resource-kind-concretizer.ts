import type { TypedHirProgram } from "../hir/hir";
import type { HirOriginId } from "../hir/ids";
import type { TargetTypeId, TypeId } from "../semantic/ids";
import {
  type CheckedResourceKind,
  type ConcreteResourceKind,
  joinConcreteResourceKinds,
} from "../semantic/surface/resource-kind";
import type { TypeConstructorId } from "../semantic/surface/type-model";
import { type MonoDiagnostic, monoDiagnostic } from "./diagnostics";
import { monoAppliedArgumentTypes, normalizeMonoCheckedType } from "./instantiation-key";
import type { MonoCheckedType } from "./mono-hir";
import { type MonoSubstitution, parameterKeyString } from "./substitution";

export interface FieldKindProvider {
  fieldKindsForType(input: {
    readonly typeId: TypeId;
    readonly typeArguments: readonly MonoCheckedType[];
    readonly sourceOrigin: HirOriginId;
  }): ConcretizeFieldKindsResult;
}

export type ConcretizeFieldKindsResult =
  | {
      readonly kind: "ok";
      readonly fieldKinds: readonly ConcreteResourceKind[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export interface MonoResourceKindConcretizationContext {
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly fieldKindProvider: FieldKindProvider;
  readonly canonicalInstanceKey: string;
}

export interface ConcretizeResourceKindInput {
  readonly kind: CheckedResourceKind;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}

export type ConcretizeResourceKindResult =
  | { readonly kind: "ok"; readonly value: ConcreteResourceKind }
  | { readonly kind: "error"; readonly diagnostic: MonoDiagnostic };

export function concretizeResourceKind(
  input: ConcretizeResourceKindInput,
): ConcretizeResourceKindResult {
  switch (input.kind.kind) {
    case "concrete":
      return { kind: "ok", value: input.kind.value };
    case "parametric":
      return concretizeParametricKind({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        context: input.context,
      });
    case "derived":
      return concretizeDerivedKind({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
        context: input.context,
      });
    case "error":
      return {
        kind: "error",
        diagnostic: monoDiagnostic({
          severity: "error",
          code: "MONO_UNRESOLVED_RESOURCE_KIND",
          message: "Cannot concretize an error resource kind",
          ownerKey: input.context.canonicalInstanceKey,
          rootCauseKey: "resource-kind",
          stableDetail: "error-kind",
          sourceOrigin: String(input.context.substitution.sourceOrigin),
        }),
      };
  }
}

function concretizeParametricKind(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "parametric" }>;
  readonly appliedType?: MonoCheckedType;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  const key = parameterKeyString(input.kind.parameter);
  const replacement = input.context.substitution.map.get(key);
  const appliedReplacement =
    replacement ??
    appliedSourceTypeArgumentForParameter({
      parameter: input.kind.parameter,
      appliedType: input.appliedType,
      context: input.context,
    });
  if (appliedReplacement === undefined) {
    return {
      kind: "error",
      diagnostic: monoDiagnostic({
        severity: "error",
        code: "MONO_UNRESOLVED_TYPE_PARAMETER",
        message: "Unresolved type parameter during kind concretization",
        ownerKey: key,
        rootCauseKey: "substitution",
        stableDetail: `unresolved:${key}`,
        sourceOrigin: String(input.context.substitution.sourceOrigin),
      }),
    };
  }
  return concretizeMonoCheckedType({
    type: appliedReplacement,
    context: input.context,
  });
}

function appliedSourceTypeArgumentForParameter(input: {
  readonly parameter: Extract<CheckedResourceKind, { readonly kind: "parametric" }>["parameter"];
  readonly appliedType?: MonoCheckedType;
  readonly context: MonoResourceKindConcretizationContext;
}): MonoCheckedType | undefined {
  if (input.parameter.owner.kind !== "item") return undefined;
  if (input.appliedType?.kind !== "applied") return undefined;
  if (input.appliedType.constructor.kind !== "source") return undefined;
  const typeRecord = input.context.program.types.get(input.appliedType.constructor.typeId);
  if (typeRecord?.itemId !== input.parameter.owner.itemId) return undefined;
  return monoAppliedArgumentTypes(input.appliedType)[input.parameter.index];
}

function concretizeMonoCheckedType(input: {
  readonly type: MonoCheckedType;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  switch (input.type.kind) {
    case "applied":
      return concretizeResourceKind({
        kind: input.type.resourceKind,
        appliedType: input.type,
        context: input.context,
      });
    case "core":
      if (input.type.coreTypeId === "Never") {
        return { kind: "ok", value: "Never" };
      }
      return { kind: "ok", value: "Copy" };
    case "source": {
      const record = input.context.program.monoClosure.sourceTypeKinds.get(input.type.typeId);
      if (record === undefined) {
        return missingConstructorRuleDiagnostic({
          ownerKey: `source:${input.type.typeId}`,
          sourceOrigin: String(input.context.substitution.sourceOrigin),
          stableDetail: `source-type-kind:${input.type.typeId}`,
        });
      }
      if (record.kind.kind === "concrete") {
        return { kind: "ok", value: record.kind.value };
      }
      return concretizeResourceKind({
        kind: record.kind,
        appliedType: input.type,
        context: input.context,
      });
    }
    case "target": {
      const record = input.context.program.monoClosure.targetTypeKinds.get(input.type.targetTypeId);
      if (record === undefined) {
        return missingTargetTypeKindDiagnostic({
          ownerKey: `target:${input.type.targetTypeId}`,
          sourceOrigin: String(input.context.substitution.sourceOrigin),
          stableDetail: `target-type:${input.type.targetTypeId}`,
        });
      }
      if (!isConcreteResourceKind(record.kind)) {
        return invalidTargetTypeKindDiagnostic({
          ownerKey: `target:${input.type.targetTypeId}`,
          sourceOrigin: String(input.context.substitution.sourceOrigin),
          stableDetail: `target-type-kind:${input.type.targetTypeId}`,
        });
      }
      return { kind: "ok", value: record.kind };
    }
    case "genericParameter":
      return {
        kind: "error",
        diagnostic: monoDiagnostic({
          severity: "error",
          code: "MONO_UNRESOLVED_TYPE_PARAMETER",
          message: "Cannot concretize a substituted type that still carries a generic parameter",
          ownerKey: parameterKeyString(input.type.parameter),
          rootCauseKey: "substitution",
          stableDetail: `unresolved-substituted:${parameterKeyString(input.type.parameter)}`,
          sourceOrigin: String(input.context.substitution.sourceOrigin),
        }),
      };
    case "error":
      return {
        kind: "error",
        diagnostic: monoDiagnostic({
          severity: "error",
          code: "MONO_UNRESOLVED_RESOURCE_KIND",
          message: "Cannot concretize a substituted error type",
          ownerKey: input.context.canonicalInstanceKey,
          rootCauseKey: "resource-kind",
          stableDetail: "error-substituted-type",
          sourceOrigin: String(input.context.substitution.sourceOrigin),
        }),
      };
  }
}

export function concretizeMonoCheckedTypeResourceKind(input: {
  readonly type: MonoCheckedType;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  return concretizeMonoCheckedType(input);
}

function concretizeDerivedKind(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "derived" }>;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  switch (input.kind.rule) {
    case "join":
      return concretizeJoinRule({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
        context: input.context,
      });
    case "appliedConstructor":
      return concretizeAppliedConstructorRule({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
        context: input.context,
      });
    case "fieldAggregation":
      return concretizeFieldAggregationRule({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
        context: input.context,
      });
    case "targetDeclared":
      return concretizeTargetDeclaredRule({
        kind: input.kind,
        ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
        ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
        context: input.context,
      });
  }
}

function concretizeJoinRule(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "derived" }>;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  const concretes: ConcreteResourceKind[] = [];
  for (const argument of input.kind.arguments) {
    const result = concretizeResourceKind({
      kind: argument,
      ...(input.appliedType !== undefined ? { appliedType: input.appliedType } : {}),
      ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
      context: input.context,
    });
    if (result.kind === "error") return result;
    concretes.push(result.value);
  }
  return { kind: "ok", value: joinConcreteResourceKinds(concretes) };
}

function concretizeAppliedConstructorRule(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "derived" }>;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  if (input.appliedType === undefined || input.appliedType.kind !== "applied") {
    return missingConstructorRuleDiagnostic({
      ownerKey: input.context.canonicalInstanceKey,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: "appliedConstructor-without-applied-type",
    });
  }
  const rule = input.context.program.monoClosure.constructorKindRules.get(
    input.appliedType.constructor,
  );
  if (rule === undefined) {
    return missingConstructorRuleDiagnostic({
      ownerKey: constructorOwnerKey(input.appliedType.constructor),
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `constructor:${constructorKey(input.appliedType.constructor)}`,
    });
  }
  if (rule.resultKind === undefined) {
    return missingConstructorRuleDiagnostic({
      ownerKey: constructorOwnerKey(input.appliedType.constructor),
      sourceOrigin: String(rule.sourceOrigin),
      stableDetail: `constructor-result:${constructorKey(input.appliedType.constructor)}`,
    });
  }
  if (rule.resultKind.kind === "concrete") {
    return { kind: "ok", value: rule.resultKind.value };
  }
  return concretizeResourceKind({
    kind: rule.resultKind,
    appliedType: input.appliedType,
    ...(input.targetTypeId !== undefined ? { targetTypeId: input.targetTypeId } : {}),
    context: input.context,
  });
}

function concretizeFieldAggregationRule(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "derived" }>;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  if (input.appliedType === undefined || input.appliedType.kind !== "applied") {
    return missingConstructorRuleDiagnostic({
      ownerKey: input.context.canonicalInstanceKey,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: "fieldAggregation-without-applied-type",
    });
  }
  if (input.appliedType.constructor.kind !== "source") {
    return missingConstructorRuleDiagnostic({
      ownerKey: constructorOwnerKey(input.appliedType.constructor),
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `fieldAggregation-non-source:${input.appliedType.constructor.kind}`,
    });
  }
  const normalizedArguments = normalizeFieldAggregationArguments({
    appliedType: input.appliedType,
    context: input.context,
  });
  if (normalizedArguments.kind === "error") {
    const diagnostic = normalizedArguments.diagnostics[0];
    if (diagnostic !== undefined) return { kind: "error", diagnostic };
    return missingConstructorRuleDiagnostic({
      ownerKey: input.context.canonicalInstanceKey,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `fieldAggregation-argument-normalization:${input.appliedType.constructor.typeId}`,
    });
  }
  const result = input.context.fieldKindProvider.fieldKindsForType({
    typeId: input.appliedType.constructor.typeId,
    typeArguments: normalizedArguments.arguments,
    sourceOrigin: input.context.substitution.sourceOrigin,
  });
  if (result.kind === "error") {
    const diagnostic = result.diagnostics[0];
    if (diagnostic !== undefined) return { kind: "error", diagnostic };
    return missingConstructorRuleDiagnostic({
      ownerKey: input.context.canonicalInstanceKey,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `fieldAggregation-empty-diagnostics:${input.appliedType.constructor.typeId}`,
    });
  }
  return { kind: "ok", value: joinConcreteResourceKinds(result.fieldKinds) };
}

function normalizeFieldAggregationArguments(input: {
  readonly appliedType: Extract<MonoCheckedType, { readonly kind: "applied" }>;
  readonly context: MonoResourceKindConcretizationContext;
}):
  | { readonly kind: "ok"; readonly arguments: readonly MonoCheckedType[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] } {
  const diagnostics: MonoDiagnostic[] = [];
  const normalized: MonoCheckedType[] = [];
  for (const argument of input.appliedType.arguments) {
    const result = normalizeMonoCheckedType(argument, {
      targetTypeKinds: input.context.program.monoClosure.targetTypeKinds,
      constructorKindRules: input.context.program.monoClosure.constructorKindRules,
      sourceOrigin: input.context.substitution.sourceOrigin,
    });
    if (result.kind === "error") {
      diagnostics.push(...result.diagnostics);
    } else {
      normalized.push(result.type);
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  return { kind: "ok", arguments: normalized };
}

function concretizeTargetDeclaredRule(input: {
  readonly kind: Extract<CheckedResourceKind, { readonly kind: "derived" }>;
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeResourceKindResult {
  const targetTypeId = targetTypeIdForTargetDeclared(input);
  if (targetTypeId === undefined) {
    return missingTargetTypeKindDiagnostic({
      ownerKey: input.context.canonicalInstanceKey,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: "targetDeclared-without-target-type-id",
    });
  }
  const record = input.context.program.monoClosure.targetTypeKinds.get(targetTypeId);
  if (record === undefined) {
    return missingTargetTypeKindDiagnostic({
      ownerKey: `target:${targetTypeId}`,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `target:${targetTypeId}`,
    });
  }
  if (!isConcreteResourceKind(record.kind)) {
    return invalidTargetTypeKindDiagnostic({
      ownerKey: `target:${targetTypeId}`,
      sourceOrigin: String(input.context.substitution.sourceOrigin),
      stableDetail: `target-type-kind:${targetTypeId}`,
    });
  }
  return { kind: "ok", value: record.kind };
}

function targetTypeIdForTargetDeclared(input: {
  readonly appliedType?: MonoCheckedType;
  readonly targetTypeId?: TargetTypeId;
}): TargetTypeId | undefined {
  if (input.targetTypeId !== undefined) return input.targetTypeId;
  if (input.appliedType?.kind === "target") return input.appliedType.targetTypeId;
  if (input.appliedType?.kind === "applied" && input.appliedType.constructor.kind === "target") {
    return input.appliedType.constructor.targetTypeId;
  }
  return undefined;
}

function isConcreteResourceKind(value: unknown): value is ConcreteResourceKind {
  switch (value) {
    case "Copy":
    case "Affine":
    case "Linear":
    case "UniqueEdgeRoot":
    case "EdgePath":
    case "Stream":
    case "ValidatedBuffer":
    case "PrivateState":
    case "SealedPlatformToken":
    case "Never":
      return true;
    default:
      return false;
  }
}

function missingConstructorRuleDiagnostic(input: {
  readonly ownerKey: string;
  readonly sourceOrigin: string;
  readonly stableDetail: string;
}): ConcretizeResourceKindResult {
  return {
    kind: "error",
    diagnostic: monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_CONSTRUCTOR_KIND_RULE",
      message: "Cannot concretize a resource kind without a constructor kind rule",
      ownerKey: input.ownerKey,
      rootCauseKey: "constructor-kind-rule",
      stableDetail: input.stableDetail,
      sourceOrigin: input.sourceOrigin,
    }),
  };
}

function missingTargetTypeKindDiagnostic(input: {
  readonly ownerKey: string;
  readonly sourceOrigin: string;
  readonly stableDetail: string;
}): ConcretizeResourceKindResult {
  return {
    kind: "error",
    diagnostic: monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_TARGET_TYPE_KIND",
      message: "Cannot concretize a target type kind without HIR target type kind data",
      ownerKey: input.ownerKey,
      rootCauseKey: "target-type-kind",
      stableDetail: input.stableDetail,
      sourceOrigin: input.sourceOrigin,
    }),
  };
}

function invalidTargetTypeKindDiagnostic(input: {
  readonly ownerKey: string;
  readonly sourceOrigin: string;
  readonly stableDetail: string;
}): ConcretizeResourceKindResult {
  return {
    kind: "error",
    diagnostic: monoDiagnostic({
      severity: "error",
      code: "MONO_UNRESOLVED_RESOURCE_KIND",
      message: "Cannot concretize a non-concrete target type kind",
      ownerKey: input.ownerKey,
      rootCauseKey: "resource-kind",
      stableDetail: input.stableDetail,
      sourceOrigin: input.sourceOrigin,
    }),
  };
}

function constructorKey(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${constructor.typeId}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}

function constructorOwnerKey(constructor: TypeConstructorId): string {
  return `constructor:${constructorKey(constructor)}`;
}

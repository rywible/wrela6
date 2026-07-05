import type { HirFunction, TypedHirProgram } from "../hir/hir";
import {
  type HirExpressionId,
  type HirLocalId,
  type HirRequirementId,
  type HirStatementId,
} from "../hir/ids";
import type { FunctionId, ImageId, TypeId } from "../semantic/ids";
import type {
  CheckedFunctionSignature,
  CheckedParameter,
  CheckedReceiver,
} from "../semantic/surface/checked-program";
import type {
  CheckedResourceKind,
  ConcreteResourceKind,
  TypeParameterKey,
} from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { instantiatedHirId, instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import { checkInstanceEligibility } from "./instance-eligibility";
import {
  canonicalFunctionInstanceId,
  canonicalTypeInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "./instantiation-key";
import {
  type MonoCheckedType,
  type MonoExpressionId,
  type MonoFunctionInstance,
  type MonoFunctionSignature,
  type MonoInstantiatedProofId,
  type MonoLocal,
  type MonoLocalId,
  type MonoLocalTable,
  type MonoParameter,
  type MonoProofExpressionId,
  type MonoProofOwner,
  type MonoReceiver,
  type MonoRequirement,
  type MonoRequirementExpression,
  type MonoRequirementOwner,
  type MonoStatementId,
} from "./mono-hir";
import {
  concretizeResourceKind,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import {
  buildMonoSubstitution,
  substituteCheckedType,
  substituteRequirementExpression,
  type MonoSubstitution,
} from "./substitution";
import { monoTypeAncestry, recursiveFieldKindProvider } from "./type-instantiator";
import { firstHirOriginId } from "./required-origin";
export interface InstantiateMonoFunctionShellInput {
  readonly program: TypedHirProgram;
  readonly key: {
    readonly functionId: FunctionId;
    readonly ownerTypeId?: TypeId;
    readonly ownerTypeArguments: readonly MonoCheckedType[];
    readonly functionTypeArguments: readonly MonoCheckedType[];
  };
  readonly source: { readonly kind: "image"; readonly imageId: ImageId };
}

export type InstantiateMonoFunctionShellResult =
  | {
      readonly kind: "ok";
      readonly instance: MonoFunctionInstance;
      readonly substitution: MonoSubstitution;
      readonly remap: MonoFunctionRemap;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export interface MonoFunctionRemap {
  readonly instanceId: MonoInstanceId;
  readonly localRemap: ReadonlyMap<HirLocalId, MonoLocalId>;
  readonly expressionRemap: ReadonlyMap<HirExpressionId, MonoExpressionId>;
  readonly statementRemap: ReadonlyMap<HirStatementId, MonoStatementId>;
  readonly requirementIdRemap: ReadonlyMap<
    HirRequirementId,
    MonoInstantiatedProofId<HirRequirementId>
  >;
  readonly proofExpressionIdRemap: ReadonlyMap<number, MonoProofExpressionId>;
}

export function instantiateMonoFunctionShell(
  input: InstantiateMonoFunctionShellInput,
): InstantiateMonoFunctionShellResult {
  const sourceFunction = input.program.functions.get(input.key.functionId);
  if (sourceFunction === undefined) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_REACHABLE_FUNCTION",
          message: "Reachable function is missing from the HIR program.",
          ownerKey: `function:${input.key.functionId}`,
          rootCauseKey: "source-function",
          stableDetail: `missing:${input.key.functionId}`,
          sourceOrigin: String(input.source.imageId),
        }),
      ],
    };
  }

  const ownerTypeMismatch = validateOwnerTypeId({
    sourceFunction,
    key: input.key,
  });
  if (ownerTypeMismatch !== undefined) {
    return { kind: "error", diagnostics: [ownerTypeMismatch] };
  }

  if (sourceFunction.bodyStatus === "bodylessRecovery") {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_REACHABLE_HIR_RECOVERY",
          message: "Reachable HIR bodyless recovery function cannot be monomorphized.",
          ownerKey: `function:${input.key.functionId}`,
          rootCauseKey: "hir-recovery",
          stableDetail: `bodyless:${input.key.functionId}`,
          sourceOrigin: String(sourceFunction.sourceOrigin),
        }),
      ],
    };
  }

  const ownerParameters = ownerParametersForFunction(input.program, sourceFunction);
  const functionParameters: readonly TypeParameterKey[] = sourceFunction.declaredTypeParameters;
  const substitutionResult = buildMonoSubstitution({
    ownerParameters,
    ownerArguments: input.key.ownerTypeArguments,
    functionParameters,
    functionArguments: input.key.functionTypeArguments,
    sourceOrigin: sourceFunction.sourceOrigin,
  });
  if (substitutionResult.kind === "error") {
    return { kind: "error", diagnostics: substitutionResult.diagnostics };
  }

  const instanceId = canonicalFunctionInstanceId({
    functionId: input.key.functionId,
    ownerTypeId: input.key.ownerTypeId,
    ownerTypeArguments: input.key.ownerTypeArguments,
    functionTypeArguments: input.key.functionTypeArguments,
  });
  const concretizationContext = createConcretizationContext({
    program: input.program,
    substitution: substitutionResult.substitution,
    canonicalInstanceKey: String(instanceId),
    source: input.source,
  });
  const ownerEligibilityResult =
    input.key.ownerTypeId !== undefined
      ? checkInstanceEligibility({
          owner: { kind: "type", typeId: input.key.ownerTypeId },
          parameters: ownerParameters,
          arguments: input.key.ownerTypeArguments,
          rules: input.program.monoClosure.instanceEligibilityRules,
          canonicalInstanceKey: String(instanceId),
          context: concretizationContext,
        })
      : { kind: "ok" as const };
  if (ownerEligibilityResult.kind === "error") {
    return { kind: "error", diagnostics: ownerEligibilityResult.diagnostics };
  }
  const functionEligibilityResult = checkInstanceEligibility({
    owner: { kind: "function", functionId: input.key.functionId },
    parameters: functionParameters,
    arguments: input.key.functionTypeArguments,
    rules: input.program.monoClosure.instanceEligibilityRules,
    canonicalInstanceKey: String(instanceId),
    context: concretizationContext,
  });
  if (functionEligibilityResult.kind === "error") {
    return { kind: "error", diagnostics: functionEligibilityResult.diagnostics };
  }

  const substitutedSignature = substituteSignature({
    signature: sourceFunction.signature,
    substitution: substitutionResult.substitution,
    context: concretizationContext,
  });
  if (substitutedSignature.kind === "error") {
    return { kind: "error", diagnostics: substitutedSignature.diagnostics };
  }

  const localsResult = substituteLocals({
    sourceFunction,
    instanceId,
    substitution: substitutionResult.substitution,
    context: concretizationContext,
  });
  if (localsResult.kind === "error") {
    return { kind: "error", diagnostics: localsResult.diagnostics };
  }

  const requirementsResult = substituteRequirements({
    sourceFunction,
    instanceId,
    substitution: substitutionResult.substitution,
  });
  if (requirementsResult.kind === "error") {
    return { kind: "error", diagnostics: requirementsResult.diagnostics };
  }

  const ownerTypeInstanceId =
    input.key.ownerTypeId !== undefined
      ? canonicalTypeInstanceId({
          typeId: input.key.ownerTypeId,
          typeArguments: input.key.ownerTypeArguments,
        })
      : undefined;

  const instance: MonoFunctionInstance = {
    instanceId,
    sourceFunctionId: input.key.functionId,
    sourceItemId: sourceFunction.itemId,
    ...(ownerTypeInstanceId !== undefined ? { ownerTypeInstanceId } : {}),
    ownerTypeArguments: input.key.ownerTypeArguments,
    functionTypeArguments: input.key.functionTypeArguments,
    signature: substitutedSignature.signature,
    bodyStatus: sourceFunction.bodyStatus,
    locals: localsResult.table,
    declaredRequirements: requirementsResult.requirements,
    sourceOrigin: String(sourceFunction.sourceOrigin),
    hirSourceOrigin: sourceFunction.sourceOrigin,
  };

  const remap: MonoFunctionRemap = {
    instanceId,
    localRemap: localsResult.remap,
    expressionRemap: new Map(),
    statementRemap: new Map(),
    requirementIdRemap: requirementsResult.idRemap,
    proofExpressionIdRemap: new Map(),
  };

  return {
    kind: "ok",
    instance,
    substitution: substitutionResult.substitution,
    remap,
  };
}

function validateOwnerTypeId(input: {
  readonly sourceFunction: HirFunction;
  readonly key: InstantiateMonoFunctionShellInput["key"];
}): MonoDiagnostic | undefined {
  if (input.sourceFunction.ownerTypeId === input.key.ownerTypeId) return undefined;
  return monoDiagnostic({
    severity: "error",
    code: "MONO_OWNER_TYPE_ID_MISMATCH",
    message: "Mono function key owner type id does not match HIR function owner type id.",
    ownerKey: `function:${input.key.functionId}`,
    rootCauseKey: "owner-type-id",
    stableDetail: `expected:${input.sourceFunction.ownerTypeId ?? "none"}:got:${
      input.key.ownerTypeId ?? "none"
    }`,
    sourceOrigin: String(input.sourceFunction.sourceOrigin),
  });
}

export function ownerParametersForFunction(
  program: TypedHirProgram,
  sourceFunction: HirFunction,
): readonly TypeParameterKey[] {
  const ownerTypeId = sourceFunction.ownerTypeId;
  if (ownerTypeId === undefined) return [];
  return program.types.get(ownerTypeId)?.declaredTypeParameters ?? [];
}

function substituteSignature(input: {
  readonly signature: CheckedFunctionSignature;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
}):
  | { readonly kind: "ok"; readonly signature: MonoFunctionSignature }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] } {
  const sig = input.signature;
  const diagnostics: MonoDiagnostic[] = [];
  const receiverResult =
    sig.receiver !== undefined
      ? substituteReceiver(sig.receiver, input.substitution, input.context)
      : undefined;
  if (receiverResult?.kind === "error") diagnostics.push(...receiverResult.diagnostics);

  const parameters: MonoParameter[] = [];
  for (const parameter of sig.parameters) {
    const result = substituteParameter(parameter, input.substitution, input.context);
    if (result.kind === "error") {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    parameters.push(result.parameter);
  }

  const returnType = substituteSignatureCheckedType({
    type: sig.returnType,
    substitution: input.substitution,
    program: input.context.program,
    canonicalInstanceKey: input.context.canonicalInstanceKey,
  });
  if (returnType.kind === "error") diagnostics.push(...returnType.diagnostics);
  const returnKind =
    returnType.kind === "ok"
      ? concretizeSignatureKind({
          type: returnType.type,
          kind: sig.returnKind,
          context: input.context,
        })
      : undefined;
  if (returnKind?.kind === "error") diagnostics.push(...returnKind.diagnostics);

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  if (returnType.kind !== "ok" || returnKind?.kind !== "ok") {
    return { kind: "error", diagnostics };
  }

  return {
    kind: "ok",
    signature: {
      functionId: sig.functionId,
      itemId: sig.itemId,
      ...(sig.ownerItemId !== undefined ? { ownerItemId: sig.ownerItemId } : {}),
      ...(receiverResult?.kind === "ok" ? { receiver: receiverResult.receiver } : {}),
      parameters,
      returnType: returnType.type,
      returnKind: returnKind!.value,
      modifiers: sig.modifiers,
      sourceSpan: sig.sourceSpan,
    },
  };
}

type SubstituteReceiverResult =
  | { readonly kind: "ok"; readonly receiver: MonoReceiver }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteReceiver(
  receiver: CheckedReceiver,
  substitution: MonoSubstitution,
  context: MonoResourceKindConcretizationContext,
): SubstituteReceiverResult {
  const type = substituteSignatureCheckedType({
    type: receiver.type,
    substitution,
    program: context.program,
    canonicalInstanceKey: context.canonicalInstanceKey,
  });
  if (type.kind === "error") return type;
  const resourceKind = concretizeSignatureKind({
    type: type.type,
    kind: receiver.resourceKind,
    context,
  });
  if (resourceKind.kind === "error") return resourceKind;
  return {
    kind: "ok",
    receiver: {
      parameterId: receiver.parameterId,
      ownerItemId: receiver.ownerItemId,
      type: type.type,
      resourceKind: resourceKind.value,
      mode: receiver.mode,
      ...(receiver.referenceKey !== undefined ? { referenceKey: receiver.referenceKey } : {}),
    },
  };
}

type SubstituteParameterResult =
  | { readonly kind: "ok"; readonly parameter: MonoParameter }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteParameter(
  parameter: CheckedParameter,
  substitution: MonoSubstitution,
  context: MonoResourceKindConcretizationContext,
): SubstituteParameterResult {
  const type = substituteSignatureCheckedType({
    type: parameter.type,
    substitution,
    program: context.program,
    canonicalInstanceKey: context.canonicalInstanceKey,
  });
  if (type.kind === "error") return type;
  const resourceKind = concretizeSignatureKind({
    type: type.type,
    kind: parameter.resourceKind,
    context,
  });
  if (resourceKind.kind === "error") return resourceKind;
  return {
    kind: "ok",
    parameter: {
      parameterId: parameter.parameterId,
      name: parameter.name,
      type: type.type,
      mode: parameter.mode,
      resourceKind: resourceKind.value,
      ...(parameter.referenceKey !== undefined ? { referenceKey: parameter.referenceKey } : {}),
      sourceSpan: parameter.sourceSpan,
    },
  };
}

type SubstituteSignatureTypeResult =
  | { readonly kind: "ok"; readonly type: MonoCheckedType }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteSignatureCheckedType(input: {
  readonly type: CheckedType;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly canonicalInstanceKey: string;
}): SubstituteSignatureTypeResult {
  const result = substituteCheckedType(input.type, input.substitution);
  if (result.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: withSignatureRelatedInformation(result.diagnostics, input.canonicalInstanceKey),
    };
  }
  const normalized = normalizeMonoCheckedType(
    result.type,
    createNormalizationContext(input.program),
  );
  if (normalized.kind === "error") {
    return {
      kind: "error",
      diagnostics: withSignatureRelatedInformation(
        normalized.diagnostics,
        input.canonicalInstanceKey,
      ),
    };
  }
  return { kind: "ok", type: normalized.type };
}

function withSignatureRelatedInformation(
  diagnostics: readonly MonoDiagnostic[],
  canonicalInstanceKey: string,
): readonly MonoDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    relatedInformation: [
      ...(diagnostic.relatedInformation ?? []),
      {
        message: `Mono function signature: ${canonicalInstanceKey}`,
        canonicalInstanceKey,
      },
    ],
  }));
}

type ConcretizeSignatureKindResult =
  | { readonly kind: "ok"; readonly value: ConcreteResourceKind }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function concretizeSignatureKind(input: {
  readonly type: MonoCheckedType;
  readonly kind: CheckedResourceKind;
  readonly context: MonoResourceKindConcretizationContext;
}): ConcretizeSignatureKindResult {
  const kindResult = concretizeResourceKind({
    kind: input.kind,
    ...(input.type.kind === "applied" ? { appliedType: input.type } : {}),
    ...(input.type.kind === "target" ? { targetTypeId: input.type.targetTypeId } : {}),
    context: input.context,
  });
  if (kindResult.kind === "error") {
    return { kind: "error", diagnostics: [kindResult.diagnostic] };
  }
  return { kind: "ok", value: kindResult.value };
}

type SubstituteLocalsResult =
  | {
      readonly kind: "ok";
      readonly table: MonoLocalTable;
      readonly remap: ReadonlyMap<HirLocalId, MonoLocalId>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteLocals(input: {
  readonly sourceFunction: HirFunction;
  readonly instanceId: MonoInstanceId;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
}): SubstituteLocalsResult {
  const locals = input.sourceFunction.locals.entries();
  const entries: MonoLocal[] = [];
  const remap = new Map<HirLocalId, MonoLocalId>();
  const normalizationContext = createNormalizationContext(input.context.program);

  for (const local of locals) {
    const monoLocalId = monoLocalIdFor(input.instanceId, local.localId);
    remap.set(local.localId, monoLocalId);

    const typeResult = substituteCheckedType(local.type, input.substitution);
    if (typeResult.diagnostics.length > 0) {
      return { kind: "error", diagnostics: typeResult.diagnostics };
    }
    const brandResult = brandMonoCheckedType(typeResult.type, normalizationContext);
    if (brandResult.kind === "error") {
      return { kind: "error", diagnostics: brandResult.diagnostics };
    }
    const monoType = brandResult.type;

    const kindResult = concretizeResourceKind({
      kind: local.resourceKind,
      ...(monoType.kind === "applied" ? { appliedType: monoType } : {}),
      ...(monoType.kind === "target" ? { targetTypeId: monoType.targetTypeId } : {}),
      context: input.context,
    });
    if (kindResult.kind === "error") {
      return { kind: "error", diagnostics: [kindResult.diagnostic] };
    }

    entries.push({
      localId: monoLocalId,
      name: local.name,
      type: monoType,
      resourceKind: kindResult.value,
      mode: local.mode,
      introducedBy: local.introducedBy,
      sourceOrigin: String(local.sourceOrigin),
      ...(local.parameterId !== undefined ? { parameterId: local.parameterId } : {}),
    });
  }

  return { kind: "ok", table: monoLocalTable(entries), remap };
}

type BrandMonoCheckedTypeResult =
  | { readonly kind: "ok"; readonly type: MonoCheckedType }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function brandMonoCheckedType(
  type: CheckedType,
  context: MonoTypeNormalizationContext,
): BrandMonoCheckedTypeResult {
  const result = normalizeMonoCheckedType(type, context);
  if (result.kind === "error") {
    return {
      kind: "error",
      diagnostics: result.diagnostics,
    };
  }
  return { kind: "ok", type: result.type };
}

type SubstituteRequirementsResult =
  | {
      readonly kind: "ok";
      readonly requirements: readonly MonoRequirement[];
      readonly idRemap: ReadonlyMap<HirRequirementId, MonoInstantiatedProofId<HirRequirementId>>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substituteRequirements(input: {
  readonly sourceFunction: HirFunction;
  readonly instanceId: MonoInstanceId;
  readonly substitution: MonoSubstitution;
}): SubstituteRequirementsResult {
  const requirements: MonoRequirement[] = [];
  const idRemap = new Map<HirRequirementId, MonoInstantiatedProofId<HirRequirementId>>();

  for (const requirement of input.sourceFunction.declaredRequirements) {
    const substitutionResult = substituteRequirementExpression(
      requirement.expression as MonoRequirementExpression,
      input.substitution,
    );
    if (substitutionResult.diagnostics.length > 0) {
      return { kind: "error", diagnostics: substitutionResult.diagnostics };
    }

    const requirementId = monoRequirementIdFor(input.instanceId, requirement.requirementId.id);
    idRemap.set(requirement.requirementId.id, requirementId);
    const owner = monoRequirementOwnerFor(input.instanceId);
    requirements.push({
      requirementId,
      owner,
      expression: substitutionResult.expression,
      sourceOrigin: String(requirement.sourceOrigin),
    });
  }

  return { kind: "ok", requirements, idRemap };
}

function monoRequirementOwnerFor(instanceId: MonoInstanceId): MonoRequirementOwner {
  return { kind: "function", functionInstanceId: instanceId };
}

function monoRequirementIdFor(
  instanceId: MonoInstanceId,
  hirRequirementId: HirRequirementId,
): MonoInstantiatedProofId<HirRequirementId> {
  const proofOwner: MonoProofOwner = { kind: "function", instanceId };
  return {
    owner: proofOwner,
    hirId: hirRequirementId,
    instanceId,
  };
}

export function monoLocalIdFor(instanceId: MonoInstanceId, hirLocalId: HirLocalId): MonoLocalId {
  return instantiatedHirId(instanceId, hirLocalId);
}

export function monoExpressionIdFor(
  instanceId: MonoInstanceId,
  hirExpressionId: HirExpressionId,
): MonoExpressionId {
  return instantiatedHirId(instanceId, hirExpressionId);
}

export function monoStatementIdFor(
  instanceId: MonoInstanceId,
  hirStatementId: HirStatementId,
): MonoStatementId {
  return instantiatedHirId(instanceId, hirStatementId);
}

function monoLocalTable(entries: readonly MonoLocal[]): MonoLocalTable {
  const sorted = [...entries].sort((left, right) =>
    instantiatedHirIdKey(left.localId) < instantiatedHirIdKey(right.localId)
      ? -1
      : instantiatedHirIdKey(left.localId) > instantiatedHirIdKey(right.localId)
        ? 1
        : 0,
  );
  const lookup = new Map<string, MonoLocal>();
  for (const entry of sorted) {
    lookup.set(instantiatedHirIdKey(entry.localId), entry);
  }
  return {
    get: (key) => lookup.get(instantiatedHirIdKey(key)),
    entries: () => sorted,
  };
}

export function createConcretizationContext(input: {
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly canonicalInstanceKey: string;
  readonly source: { readonly kind: "image"; readonly imageId: ImageId };
}): MonoResourceKindConcretizationContext {
  return {
    program: input.program,
    substitution: input.substitution,
    fieldKindProvider: recursiveFieldKindProvider({
      program: input.program,
      source: input.source,
      ancestry: monoTypeAncestry(),
    }),
    canonicalInstanceKey: input.canonicalInstanceKey,
  };
}

export function createNormalizationContext(program: TypedHirProgram): MonoTypeNormalizationContext {
  return {
    targetTypeKinds: program.monoClosure.targetTypeKinds,
    constructorKindRules: program.monoClosure.constructorKindRules,
    sourceOrigin: firstHirOriginId(program),
  };
}

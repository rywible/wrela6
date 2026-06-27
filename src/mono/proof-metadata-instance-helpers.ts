import type {
  HirExpression,
  HirFactContent,
  HirPlaceProjection,
  HirPlaceRoot,
  HirResourcePlace,
} from "../hir/hir";
import type { HirExpressionId, HirLocalId, HirProofOwner } from "../hir/ids";
import type { FunctionId, ImageId } from "../semantic/ids";
import {
  type CheckedResourceKind,
  type ConcreteResourceKind,
} from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { instantiatedHirId, instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import { normalizeMonoCheckedType } from "./instantiation-key";
import type {
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFactContent,
  MonoFunctionInstance,
  MonoLocalId,
  MonoPlaceProjection,
  MonoPlaceRoot,
  MonoProofOwner,
  MonoRequirement,
  MonoRequirementOwner,
  MonoResourcePlace,
  MonoTypeInstance,
} from "./mono-hir";
import { ownersEqual } from "./proof-metadata-index";
import type { InstantiateMonoProofMetadataInput } from "./proof-metadata-instantiator";
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

export type ProofOwnerInstance =
  | MonoFunctionInstance
  | MonoTypeInstance
  | { readonly instanceId: MonoInstanceId };

export function lookupInstancesForOwner(input: {
  readonly owner: HirProofOwner;
  readonly functionInstanceByCanonicalKey: ReadonlyMap<string, MonoFunctionInstance>;
  readonly typeInstanceByCanonicalKey: ReadonlyMap<string, MonoTypeInstance>;
  readonly imageInstanceId: MonoInstanceId;
  readonly canonicalInstanceKeys: ReadonlyMap<HirProofOwner, string>;
}): readonly ProofOwnerInstance[] {
  if (input.owner.kind === "image") {
    if (!hasCanonicalInstanceKeyForOwner(input.canonicalInstanceKeys, input.owner)) return [];
    return [{ instanceId: input.imageInstanceId } as MonoFunctionInstance];
  }
  if (input.owner.kind === "function") {
    const matches: MonoFunctionInstance[] = [];
    for (const instance of input.functionInstanceByCanonicalKey.values()) {
      if (instance.sourceFunctionId === input.owner.functionId) {
        matches.push(instance);
      }
    }
    return matches;
  }
  const matches: MonoTypeInstance[] = [];
  for (const instance of input.typeInstanceByCanonicalKey.values()) {
    if (instance.sourceTypeId === input.owner.typeId) {
      matches.push(instance);
    }
  }
  return matches;
}

export function canonicalInstanceKeyForFunction(
  functionId: FunctionId,
  ownerTypeArguments: readonly MonoCheckedType[],
  functionTypeArguments: readonly MonoCheckedType[],
  ownerTypeInstanceId: MonoInstanceId | undefined,
  typeInstances: readonly MonoTypeInstance[],
): string {
  const ownerTypeSegment = ownerTypeInstanceId !== undefined ? String(ownerTypeInstanceId) : "none";
  return `fn:${functionId}|ownerType:${ownerTypeSegment}|owner:${serializeTypeList(
    ownerTypeArguments,
  )}|fn:${serializeTypeList(functionTypeArguments)}|types:${typeInstances
    .map((type) => String(type.instanceId))
    .join(",")}`;
}

export function canonicalInstanceKeyForType(
  typeId: import("../semantic/ids").TypeId,
  typeArguments: readonly MonoCheckedType[],
): string {
  return `type:${typeId}|args:${serializeTypeList(typeArguments)}`;
}

function serializeTypeList(types: readonly MonoCheckedType[]): string {
  return `<${types.map((type) => `${checkedTypeFingerprint(type).length}:${checkedTypeFingerprint(type)}`).join(",")}>`;
}

function hasCanonicalInstanceKeyForOwner(
  canonicalInstanceKeys: ReadonlyMap<HirProofOwner, string>,
  owner: HirProofOwner,
): boolean {
  for (const knownOwner of canonicalInstanceKeys.keys()) {
    if (ownersEqual(knownOwner, owner)) return true;
  }
  return false;
}

export function monoProofOwnerFor(
  instanceId: MonoInstanceId,
  owner: HirProofOwner,
): MonoProofOwner {
  if (owner.kind === "image") return { kind: "image", instanceId };
  return { kind: owner.kind, instanceId };
}

type SubstitutionForInstanceResult =
  | { readonly kind: "ok"; readonly substitution: MonoSubstitution }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substitutionForInstance(
  instance: ProofOwnerInstance,
  input: InstantiateMonoProofMetadataInput,
): SubstitutionForInstanceResult {
  if (isFunctionInstance(instance)) {
    const sourceFunction = input.program.functions.get(instance.sourceFunctionId);
    if (sourceFunction === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_REACHABLE_FUNCTION",
            message: "Cannot build proof metadata substitution for a missing function.",
            ownerKey: `function:${instance.sourceFunctionId}`,
            rootCauseKey: "source-function",
            stableDetail: `missing:${instance.sourceFunctionId}`,
            sourceOrigin: instance.sourceOrigin,
          }),
        ],
      };
    }
    const ownerParameters =
      sourceFunction.ownerTypeId !== undefined
        ? (input.program.types.get(sourceFunction.ownerTypeId)?.declaredTypeParameters ?? [])
        : [];
    return buildMonoSubstitution({
      ownerParameters,
      ownerArguments: instance.ownerTypeArguments,
      functionParameters: sourceFunction.declaredTypeParameters,
      functionArguments: instance.functionTypeArguments,
      sourceOrigin: sourceFunction.sourceOrigin,
    });
  }
  if (isTypeInstance(instance)) {
    const sourceType = input.program.types.get(instance.sourceTypeId);
    if (sourceType === undefined) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_MISSING_REACHABLE_TYPE",
            message: "Cannot build proof metadata substitution for a missing type.",
            ownerKey: `type:${instance.sourceTypeId}`,
            rootCauseKey: "source-type",
            stableDetail: `missing:${instance.sourceTypeId}`,
            sourceOrigin: instance.sourceOrigin,
          }),
        ],
      };
    }
    return buildMonoSubstitution({
      ownerParameters: sourceType.declaredTypeParameters,
      ownerArguments: instance.typeArguments,
      functionParameters: [],
      functionArguments: [],
      sourceOrigin: sourceType.sourceOrigin,
    });
  }
  return { kind: "ok", substitution: emptySubstitution(input) };
}

function emptySubstitution(input: InstantiateMonoProofMetadataInput): MonoSubstitution {
  return {
    map: new Map(),
    sourceOrigin: input.program.origins.originRecords()[0]?.originId ?? (0 as never),
  };
}

function isFunctionInstance(instance: ProofOwnerInstance): instance is MonoFunctionInstance {
  return "sourceFunctionId" in instance;
}

function isTypeInstance(instance: ProofOwnerInstance): instance is MonoTypeInstance {
  return "sourceTypeId" in instance;
}

export function remapLocalId(localId: HirLocalId, instance: ProofOwnerInstance): MonoLocalId {
  return instantiatedHirId(instance.instanceId, localId);
}

export function remapExpressionId(
  expressionId: HirExpressionId,
  instance: ProofOwnerInstance,
): MonoExpressionId {
  return instantiatedHirId(instance.instanceId, expressionId);
}

type LookupClonedExpressionResult =
  | { readonly kind: "ok"; readonly expression: MonoExpression }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function lookupClonedExpression(
  expression: HirExpression,
  instance: ProofOwnerInstance,
): LookupClonedExpressionResult {
  const expressionId = remapExpressionId(expression.expressionId, instance);
  const cloned = isFunctionInstance(instance)
    ? instance.bodyIndex?.expressions.get(expressionId)
    : undefined;
  if (cloned !== undefined) {
    return { kind: "ok", expression: cloned };
  }
  return {
    kind: "error",
    diagnostics: [
      monoDiagnostic({
        severity: "error",
        code: "MONO_DANGLING_PROOF_METADATA",
        message: "Proof metadata references an expression missing from the cloned mono body.",
        ownerKey: `proof-expression:${String(expression.expressionId)}`,
        rootCauseKey: "proof-metadata",
        stableDetail: `missing-expression:${instantiatedHirIdKey(expressionId)}`,
        sourceOrigin: String(expression.sourceOrigin),
      }),
    ],
  };
}

type ResourcePlaceInstantiation =
  | { readonly kind: "ok"; readonly place: MonoResourcePlace }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoResourcePlace(input: {
  readonly place: HirResourcePlace;
  readonly functionInstance: ProofOwnerInstance;
  readonly input: InstantiateMonoProofMetadataInput;
}): ResourcePlaceInstantiation {
  const { place, functionInstance } = input;
  const canonicalTypeResult = normalizeCheckedTypeForInstance(
    place.type,
    functionInstance,
    input.input,
  );
  if (canonicalTypeResult.kind === "error") return canonicalTypeResult;
  const concreteKind = concretizeKindForInstance(
    place.resourceKind,
    canonicalTypeResult.type,
    functionInstance,
    input.input,
  );
  if (concreteKind.kind === "error") return concreteKind;
  const root = instantiatePlaceRoot(place.root, functionInstance, place.placeId.owner);
  const projection: MonoPlaceProjection[] = place.projection.map(instantiatePlaceProjection);
  const localId =
    place.localId !== undefined ? remapLocalId(place.localId, functionInstance) : undefined;
  const monoPlace: MonoResourcePlace = {
    placeId: {
      owner: monoProofOwnerFor(functionInstance.instanceId, place.placeId.owner),
      hirId: place.placeId.id,
      instanceId: functionInstance.instanceId,
    },
    canonicalKey: place.canonicalKey,
    root,
    projection,
    type: canonicalTypeResult.type,
    resourceKind: concreteKind.value,
    sourceOrigin: String(place.sourceOrigin),
    kind: place.kind,
    ...(place.parameterId !== undefined ? { parameterId: place.parameterId } : {}),
    ...(localId !== undefined ? { localId } : {}),
    ...(place.fieldId !== undefined ? { fieldId: place.fieldId } : {}),
  };
  return { kind: "ok", place: monoPlace };
}

type CanonicalTypeResult =
  | { readonly kind: "ok"; readonly type: MonoCheckedType }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function normalizeCheckedTypeForInstance(
  type: CheckedType,
  instance: ProofOwnerInstance,
  input: InstantiateMonoProofMetadataInput,
): CanonicalTypeResult {
  if (type.kind === "error") {
    return unresolvedTypeDiagnostic(type);
  }
  const substitutionResult = substitutionForInstance(instance, input);
  if (substitutionResult.kind === "error") return substitutionResult;
  const substituted = substituteCheckedType(type, substitutionResult.substitution);
  if (substituted.diagnostics.length > 0) {
    return { kind: "error", diagnostics: substituted.diagnostics };
  }
  if (substituted.type.kind === "genericParameter" || substituted.type.kind === "error") {
    return unresolvedTypeDiagnostic(substituted.type);
  }
  const normalized = normalizeMonoCheckedType(
    substituted.type,
    monoNormalizationContextForInput(input),
  );
  if (normalized.kind === "error") return normalized;
  return { kind: "ok", type: normalized.type };
}

function unresolvedTypeDiagnostic(type: CheckedType): CanonicalTypeResult {
  return {
    kind: "error",
    diagnostics: [
      monoDiagnostic({
        severity: "error",
        code: "MONO_UNRESOLVED_TYPE_PARAMETER",
        message: "Cannot instantiate proof metadata with an unresolved or error type.",
        ownerKey: `type:${checkedTypeFingerprint(type)}`,
        rootCauseKey: "substitution",
        stableDetail: `unresolved:${checkedTypeFingerprint(type)}`,
      }),
    ],
  };
}

function monoNormalizationContextForInput(
  input: InstantiateMonoProofMetadataInput,
): import("./instantiation-key").MonoTypeNormalizationContext {
  return {
    targetTypeKinds: input.program.monoClosure.targetTypeKinds,
    constructorKindRules: input.program.monoClosure.constructorKindRules,
    sourceOrigin: input.program.origins.originRecords()[0]?.originId ?? (0 as never),
  };
}

type ConcreteKindResult =
  | { readonly kind: "ok"; readonly value: ConcreteResourceKind }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function concretizeKindForInstance(
  kind: CheckedResourceKind,
  type: MonoCheckedType,
  instance: ProofOwnerInstance,
  input: InstantiateMonoProofMetadataInput,
): ConcreteKindResult {
  const substitutionResult = substitutionForInstance(instance, input);
  if (substitutionResult.kind === "error") return substitutionResult;
  const context: MonoResourceKindConcretizationContext = {
    program: input.program,
    substitution: substitutionResult.substitution,
    fieldKindProvider: recursiveFieldKindProvider({
      program: input.program,
      source: input.source ?? sourceForProofMetadata(input),
      ancestry: monoTypeAncestry(),
    }),
    canonicalInstanceKey: String(instance.instanceId),
  };
  const result = concretizeResourceKind({
    kind,
    ...(type.kind === "applied" ? { appliedType: type } : {}),
    ...(type.kind === "target" ? { targetTypeId: type.targetTypeId } : {}),
    context,
  });
  if (result.kind === "error") {
    return { kind: "error", diagnostics: [result.diagnostic] };
  }
  return { kind: "ok", value: result.value };
}

function sourceForProofMetadata(input: InstantiateMonoProofMetadataInput): {
  readonly kind: "image";
  readonly imageId: ImageId;
} {
  const image = input.program.images.entries()[0];
  return { kind: "image", imageId: image?.imageId ?? (0 as ImageId) };
}

function instantiatePlaceRoot(
  root: HirPlaceRoot,
  instance: ProofOwnerInstance,
  owner: HirProofOwner,
): MonoPlaceRoot {
  switch (root.kind) {
    case "receiver":
      return { kind: "receiver", parameterId: root.parameterId };
    case "parameter":
      return { kind: "parameter", parameterId: root.parameterId };
    case "local":
      return { kind: "local", localId: remapLocalId(root.localId, instance) };
    case "temporary":
      return { kind: "temporary", ordinal: root.ordinal };
    case "imageDevice":
      return { kind: "imageDevice", imageId: root.imageId, fieldId: root.fieldId };
    case "validationPayload":
      return {
        kind: "validationPayload",
        validationId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: root.validationId.id,
          instanceId: instance.instanceId,
        },
      };
    case "error":
      return { kind: "error" };
  }
}

function instantiatePlaceProjection(projection: HirPlaceProjection): MonoPlaceProjection {
  switch (projection.kind) {
    case "field":
      return { kind: "field", fieldId: projection.fieldId };
    case "deref":
      return { kind: "deref" };
    case "variant":
      return { kind: "variant", name: projection.name };
  }
}

export function instantiateRequirement(input: {
  readonly requirement: import("../hir/hir").HirRequirement;
  readonly instance: ProofOwnerInstance;
  readonly input: InstantiateMonoProofMetadataInput;
}):
  | { readonly kind: "ok"; readonly requirement: MonoRequirement }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] } {
  const substitutionResult = substitutionForInstance(input.instance, input.input);
  if (substitutionResult.kind === "error") return substitutionResult;
  const expression = substituteRequirementExpression(
    input.requirement.expression as MonoRequirement["expression"],
    substitutionResult.substitution,
  );
  if (expression.diagnostics.length > 0) {
    return { kind: "error", diagnostics: expression.diagnostics };
  }
  return {
    kind: "ok",
    requirement: {
      requirementId: {
        owner: requirementOwnerFor(input.instance.instanceId, input.requirement.owner),
        hirId: input.requirement.requirementId.id,
        instanceId: input.instance.instanceId,
      },
      owner: requirementMonoOwnerFor(input.instance.instanceId, input.requirement.owner),
      expression: expression.expression,
      sourceOrigin: String(input.requirement.sourceOrigin),
    },
  };
}

function requirementOwnerFor(
  instanceId: MonoInstanceId,
  owner: import("../hir/hir").HirRequirementOwner,
): MonoProofOwner {
  if (owner.kind === "function") return { kind: "function", instanceId };
  return { kind: "type", instanceId };
}

function requirementMonoOwnerFor(
  instanceId: MonoInstanceId,
  owner: import("../hir/hir").HirRequirementOwner,
): MonoRequirementOwner {
  if (owner.kind === "type") return { kind: "type", typeInstanceId: instanceId };
  return { kind: "function", functionInstanceId: instanceId };
}

type FactContentInstantiation =
  | { readonly kind: "ok"; readonly content: MonoFactContent }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateFactContent(input: {
  readonly content: HirFactContent;
  readonly instance: ProofOwnerInstance;
  readonly input: InstantiateMonoProofMetadataInput;
}): FactContentInstantiation {
  if (input.content.kind === "predicateCall") {
    const argumentsResult = substitutePredicateArguments(input.content.arguments, input.instance);
    if (argumentsResult.kind === "error") return argumentsResult;
    let statePlace: MonoResourcePlace | undefined;
    if (input.content.statePlace !== undefined) {
      const placeResult = instantiateMonoResourcePlace({
        place: input.content.statePlace,
        functionInstance: input.instance,
        input: input.input,
      });
      if (placeResult.kind === "error") return placeResult;
      statePlace = placeResult.place;
    }
    return {
      kind: "ok",
      content: {
        kind: "predicateCall",
        predicateFunctionId: input.content.predicateFunctionId,
        ...(argumentsResult.arguments !== undefined
          ? { arguments: argumentsResult.arguments }
          : {}),
        ...(statePlace !== undefined ? { statePlace } : {}),
      },
    };
  }
  if (input.content.kind === "ensure") {
    return {
      kind: "ok",
      content: {
        kind: "ensure",
        expressionId: remapExpressionId(input.content.expressionId, input.instance),
      },
    };
  }
  if (input.content.kind === "platformEnsure") {
    return {
      kind: "ok",
      content: {
        kind: "platformEnsure",
        edgeId: {
          owner: monoProofOwnerFor(input.instance.instanceId, input.content.edgeId.owner),
          hirId: input.content.edgeId.id,
          instanceId: input.instance.instanceId,
        },
        fact: input.content.fact,
      },
    };
  }
  return {
    kind: "ok",
    content: {
      kind: "matchRefinement",
      scrutineeExpressionId: remapExpressionId(input.content.scrutineeExpressionId, input.instance),
      variantReferenceKey: input.content.variantReferenceKey,
      fieldBindingKeys: [...input.content.fieldBindingKeys],
    },
  };
}

type PredicateArgumentsResult =
  | { readonly kind: "ok"; readonly arguments: readonly MonoExpression[] | undefined }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function substitutePredicateArguments(
  arguments_: readonly HirExpression[] | undefined,
  instance: ProofOwnerInstance,
): PredicateArgumentsResult {
  if (arguments_ === undefined) return { kind: "ok", arguments: undefined };
  const expressions: MonoExpression[] = [];
  for (const argument of arguments_) {
    const result = lookupClonedExpression(argument, instance);
    if (result.kind === "error") return result;
    expressions.push(result.expression);
  }
  return { kind: "ok", arguments: expressions };
}

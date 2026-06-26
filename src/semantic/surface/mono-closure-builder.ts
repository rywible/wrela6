import type { ItemIndex, SourceItemKind } from "../item-index";
import type { TargetTypeId, TypeId } from "../ids";
import type { ResourceKindContext } from "./resource-kind-checker";
import type { SemanticTargetSurface } from "./platform-surface";
import type { CheckedSemanticProgram } from "./checked-program";
import type { CheckedImageSeed } from "./semantic-surface-checker";
import type { CheckedType } from "./type-model";
import {
  checkedConstructorKindRuleTableFromRecords,
  checkedExternalEntryRootTableFromRecords,
  checkedInstanceEligibilityRuleTableFromRecords,
  checkedMonoClosureFactsFromTables,
  checkedTargetTypeKindTableFromSpecs,
  type CheckedConstructorKindRule,
  type CheckedExternalEntryRoot,
  type CheckedMonoClosureFacts,
} from "./mono-closure";
import { concreteKind, type CheckedResourceKind, type ConcreteResourceKind } from "./resource-kind";

export function targetResourceKindContext(
  targetSurface: SemanticTargetSurface,
): ReadonlyMap<TargetTypeId, CheckedResourceKind> {
  return new Map(
    targetSurface.targetTypeKinds.map((kind) => [kind.targetTypeId, concreteKind(kind.kind)]),
  );
}

export function buildSemanticMonoClosureFacts(input: {
  readonly index: ItemIndex;
  readonly kindContext: ResourceKindContext;
  readonly targetSurface: SemanticTargetSurface;
  readonly image: CheckedImageSeed | undefined;
  readonly program: CheckedSemanticProgram;
}): CheckedMonoClosureFacts {
  const constructorKindRules = buildConstructorKindRules({
    index: input.index,
    kindContext: input.kindContext,
    certifiedPlatformBindings: certifiedPlatformTokenTypeIds({
      program: input.program,
    }),
    targetTypeIds: input.targetSurface.targetTypeKinds.map((kind) => kind.targetTypeId),
  });
  const targetTypeKinds = checkedTargetTypeKindTableFromSpecs(
    input.targetSurface.targetTypeKinds.map((kind) => ({
      targetTypeId: kind.targetTypeId,
      kind: kind.kind,
    })),
  );
  const externalEntryRoots = buildExternalEntryRoots({ image: input.image, index: input.index });
  return checkedMonoClosureFactsFromTables({
    targetTypeKinds,
    constructorKindRules: checkedConstructorKindRuleTableFromRecords(constructorKindRules),
    instanceEligibilityRules: checkedInstanceEligibilityRuleTableFromRecords([]),
    externalEntryRoots: checkedExternalEntryRootTableFromRecords(externalEntryRoots),
  });
}

function declarationKindToAppliedConstructorKind(input: {
  readonly kind: SourceItemKind;
  readonly modifiers: readonly string[];
  readonly hasCertifiedPlatformBinding: boolean;
}): { readonly rule: "appliedConstructor"; readonly value: ConcreteResourceKind } | undefined {
  if (input.hasCertifiedPlatformBinding) {
    return { rule: "appliedConstructor", value: "SealedPlatformToken" };
  }
  const modifiers = new Set(input.modifiers);
  if (input.kind === "class" && modifiers.has("private")) {
    return { rule: "appliedConstructor", value: "PrivateState" };
  }
  if (input.kind === "edgeClass" && modifiers.has("unique")) {
    return { rule: "appliedConstructor", value: "UniqueEdgeRoot" };
  }
  switch (input.kind) {
    case "stream":
      return { rule: "appliedConstructor", value: "Stream" };
    case "validatedBuffer":
      return { rule: "appliedConstructor", value: "ValidatedBuffer" };
    case "edgeClass":
      return { rule: "appliedConstructor", value: "EdgePath" };
    case "interface":
    case "enum":
    case "enumCase":
      return { rule: "appliedConstructor", value: "Copy" };
    case "class":
    case "dataclass":
      return undefined;
    case "function":
    case "image":
      return undefined;
  }
  return unreachableSourceItemKind(input.kind);
}

function unreachableSourceItemKind(kind: never): never {
  throw new Error(`Unhandled source item kind for constructor rule: ${kind}`);
}

function buildConstructorKindRules(input: {
  readonly index: ItemIndex;
  readonly kindContext: ResourceKindContext;
  readonly certifiedPlatformBindings: ReadonlySet<TypeId>;
  readonly targetTypeIds: readonly TargetTypeId[];
}): CheckedConstructorKindRule[] {
  const rules: CheckedConstructorKindRule[] = [];
  for (const coreType of input.kindContext.coreTypes.types) {
    rules.push({
      constructor: { kind: "core", coreTypeId: coreType.id },
      rule: "join",
    });
  }
  for (const targetTypeId of input.targetTypeIds) {
    rules.push({
      constructor: { kind: "target", targetTypeId },
      rule: "targetDeclared",
    });
  }
  for (const typeRecord of input.index.types()) {
    const item = input.index.item(typeRecord.itemId);
    if (item === undefined) continue;
    const appliedResult = declarationKindToAppliedConstructorKind({
      kind: item.kind,
      modifiers: item.modifiers,
      hasCertifiedPlatformBinding: input.certifiedPlatformBindings.has(typeRecord.id),
    });
    if (appliedResult !== undefined) {
      rules.push({
        constructor: { kind: "source", typeId: typeRecord.id },
        rule: appliedResult.rule,
        resultKind: concreteKind(appliedResult.value),
      });
      continue;
    }
    if (item.kind === "class" || item.kind === "dataclass") {
      rules.push({
        constructor: { kind: "source", typeId: typeRecord.id },
        rule: "fieldAggregation",
      });
    }
  }
  return rules;
}

function certifiedPlatformTokenTypeIds(input: {
  readonly program: CheckedSemanticProgram;
}): ReadonlySet<TypeId> {
  const typeIds = new Set<TypeId>();
  for (const binding of input.program.certifiedPlatformBindings.entries()) {
    const signature = input.program.functions.get(binding.functionId);
    if (signature?.returnKind.kind !== "concrete") continue;
    if (signature.returnKind.value !== "SealedPlatformToken") continue;
    const typeId = sourceTypeId(signature.returnType);
    if (typeId !== undefined) {
      typeIds.add(typeId);
    }
  }
  return typeIds;
}

function buildExternalEntryRoots(input: {
  readonly image: CheckedImageSeed | undefined;
  readonly index: ItemIndex;
}): readonly CheckedExternalEntryRoot[] {
  if (input.image === undefined) return [];
  if (input.image.entryFunctionId === undefined) return [];
  const entryFunction = input.index.function(input.image.entryFunctionId);
  if (entryFunction === undefined) return [];
  return [
    {
      functionId: input.image.entryFunctionId,
      itemId: entryFunction.itemId,
      ownerTypeArguments: [],
      functionTypeArguments: [],
      reason: "imageEntry",
    },
  ];
}

function sourceTypeId(type: CheckedType): TypeId | undefined {
  if (type.kind === "source") return type.typeId;
  if (type.kind === "applied" && type.constructor.kind === "source") {
    return type.constructor.typeId;
  }
  return undefined;
}

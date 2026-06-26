import type { FunctionId, ItemId, TargetTypeId, TypeId } from "../ids";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { TypeParameterKey } from "./resource-kind";
import type { CheckedResourceKind, ConcreteResourceKind } from "./resource-kind";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { TypeConstructorId } from "./type-model";
import type { CheckedType } from "./type-model";

export type CheckedMonoClosureSourceOrigin = number | string;

export interface CheckedTargetTypeKind {
  readonly targetTypeId: TargetTypeId;
  readonly kind: ConcreteResourceKind;
  readonly sourceOrigin?: CheckedMonoClosureSourceOrigin;
}

export interface CheckedTargetTypeKindTable {
  get(targetTypeId: TargetTypeId): CheckedTargetTypeKind | undefined;
  entries(): readonly CheckedTargetTypeKind[];
}

function checkedTargetTypeKindTable(
  records: readonly CheckedTargetTypeKind[],
): CheckedTargetTypeKindTable {
  const sorted = [...records].sort((left, right) =>
    compareCodeUnitStrings(String(left.targetTypeId), String(right.targetTypeId)),
  );
  const byId = new Map(sorted.map((record) => [record.targetTypeId, record]));
  return {
    get: (targetTypeId) => byId.get(targetTypeId),
    entries: () => [...sorted],
  };
}

export interface CheckedConstructorKindRule {
  readonly constructor: TypeConstructorId;
  readonly rule: "join" | "appliedConstructor" | "fieldAggregation" | "targetDeclared";
  readonly resultKind?: CheckedResourceKind;
  readonly sourceOrigin?: CheckedMonoClosureSourceOrigin;
}

export interface CheckedConstructorKindRuleTable {
  get(constructor: TypeConstructorId): CheckedConstructorKindRule | undefined;
  entries(): readonly CheckedConstructorKindRule[];
}

function constructorKeyString(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${String(constructor.typeId).padStart(12, "0")}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}

function checkedConstructorKindRuleTable(
  records: readonly CheckedConstructorKindRule[],
): CheckedConstructorKindRuleTable {
  const sorted = [...records].sort((left, right) =>
    compareCodeUnitStrings(
      constructorKeyString(left.constructor),
      constructorKeyString(right.constructor),
    ),
  );
  const byKey = new Map(sorted.map((record) => [constructorKeyString(record.constructor), record]));
  return {
    get: (constructor) => byKey.get(constructorKeyString(constructor)),
    entries: () => [...sorted],
  };
}

export type CheckedInstanceEligibilityOwner = TypeParameterOwner;

export interface CheckedInstanceEligibilityRule {
  readonly owner: CheckedInstanceEligibilityOwner;
  readonly parameter: TypeParameterKey;
  readonly allowedConcreteKinds: readonly ConcreteResourceKind[];
  readonly sourceOrigin?: CheckedMonoClosureSourceOrigin;
}

export interface CheckedInstanceEligibilityRuleTable {
  get(
    owner: CheckedInstanceEligibilityOwner,
    parameter: TypeParameterKey,
  ): CheckedInstanceEligibilityRule | undefined;
  entries(): readonly CheckedInstanceEligibilityRule[];
}

function eligibilityOwnerString(owner: CheckedInstanceEligibilityOwner): string {
  if (owner.kind === "item") return `item:${owner.itemId}`;
  return `function:${owner.functionId}`;
}

function parameterKeyString(parameter: TypeParameterKey): string {
  return `${eligibilityOwnerString(parameter.owner)}:${parameter.index}`;
}

function eligibilityRuleKeyString(
  owner: CheckedInstanceEligibilityOwner,
  parameter: TypeParameterKey,
): string {
  return `${eligibilityOwnerString(owner)}/${parameterKeyString(parameter)}`;
}

function checkedInstanceEligibilityRuleTable(
  records: readonly CheckedInstanceEligibilityRule[],
): CheckedInstanceEligibilityRuleTable {
  const sorted = [...records].sort((left, right) => {
    const leftKey = eligibilityRuleKeyString(left.owner, left.parameter);
    const rightKey = eligibilityRuleKeyString(right.owner, right.parameter);
    return compareCodeUnitStrings(leftKey, rightKey);
  });
  const byKey = new Map<string, CheckedInstanceEligibilityRule>();
  for (const record of sorted) {
    const key = eligibilityRuleKeyString(record.owner, record.parameter);
    if (!byKey.has(key)) {
      byKey.set(key, record);
    }
  }
  return {
    get: (owner, parameter) => byKey.get(eligibilityRuleKeyString(owner, parameter)),
    entries: () => [...sorted],
  };
}

export type CheckedExternalEntryRootReason =
  | "imageEntry"
  | "certifiedPlatformEntry"
  | "manualOverride";

export interface CheckedExternalEntryRoot {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly functionTypeArguments: readonly CheckedType[];
  readonly reason: CheckedExternalEntryRootReason;
  readonly sourceOrigin?: CheckedMonoClosureSourceOrigin;
}

export interface CheckedExternalEntryRootTable {
  get(functionId: FunctionId): CheckedExternalEntryRoot | undefined;
  entries(): readonly CheckedExternalEntryRoot[];
}

function checkedExternalEntryRootTable(
  records: readonly CheckedExternalEntryRoot[],
): CheckedExternalEntryRootTable {
  const sorted = [...records].sort((left, right) => {
    const cmp = (left.functionId as number) - (right.functionId as number);
    if (cmp !== 0) return cmp;
    return compareCodeUnitStrings(left.reason, right.reason);
  });
  const byFunction = new Map<FunctionId, CheckedExternalEntryRoot>();
  for (const record of sorted) {
    if (!byFunction.has(record.functionId)) {
      byFunction.set(record.functionId, record);
    }
  }
  return {
    get: (functionId) => byFunction.get(functionId),
    entries: () => [...sorted],
  };
}

export interface CheckedMonoClosureFacts {
  readonly targetTypeKinds: CheckedTargetTypeKindTable;
  readonly constructorKindRules: CheckedConstructorKindRuleTable;
  readonly instanceEligibilityRules: CheckedInstanceEligibilityRuleTable;
  readonly externalEntryRoots: CheckedExternalEntryRootTable;
}

export function checkedMonoClosureFactsEmpty(): CheckedMonoClosureFacts {
  return {
    targetTypeKinds: checkedTargetTypeKindTable([]),
    constructorKindRules: checkedConstructorKindRuleTable([]),
    instanceEligibilityRules: checkedInstanceEligibilityRuleTable([]),
    externalEntryRoots: checkedExternalEntryRootTable([]),
  };
}

export function checkedTargetTypeKindTableFromSpecs(
  specs: readonly {
    readonly targetTypeId: import("../ids").TargetTypeId;
    readonly kind: ConcreteResourceKind;
  }[],
): CheckedTargetTypeKindTable {
  const records: CheckedTargetTypeKind[] = specs.map((spec) => ({
    targetTypeId: spec.targetTypeId,
    kind: spec.kind,
  }));
  return checkedTargetTypeKindTable(records);
}

export function checkedConstructorKindRuleTableFromRecords(
  records: readonly CheckedConstructorKindRule[],
): CheckedConstructorKindRuleTable {
  return checkedConstructorKindRuleTable(records);
}

export function checkedInstanceEligibilityRuleTableFromRecords(
  records: readonly CheckedInstanceEligibilityRule[],
): CheckedInstanceEligibilityRuleTable {
  return checkedInstanceEligibilityRuleTable(records);
}

export function checkedExternalEntryRootTableFromRecords(
  records: readonly CheckedExternalEntryRoot[],
): CheckedExternalEntryRootTable {
  return checkedExternalEntryRootTable(records);
}

export function checkedMonoClosureFactsFromTables(input: {
  readonly targetTypeKinds: CheckedTargetTypeKindTable;
  readonly constructorKindRules: CheckedConstructorKindRuleTable;
  readonly instanceEligibilityRules: CheckedInstanceEligibilityRuleTable;
  readonly externalEntryRoots: CheckedExternalEntryRootTable;
}): CheckedMonoClosureFacts {
  return input;
}

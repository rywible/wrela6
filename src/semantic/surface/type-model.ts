import type { CoreTypeId, ItemId, TargetTypeId, TypeId } from "../ids";
import type { CheckedResourceKind, TypeParameterKey } from "./resource-kind";
import { resourceKindFingerprint } from "./resource-kind";

export type TypeConstructorId =
  | { readonly kind: "source"; readonly typeId: TypeId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export interface AppliedCheckedType {
  readonly kind: "applied";
  readonly constructor: TypeConstructorId;
  readonly arguments: readonly CheckedType[];
  readonly resourceKind: CheckedResourceKind;
}

export type CheckedType =
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "source"; readonly itemId: ItemId; readonly typeId: TypeId }
  | { readonly kind: "genericParameter"; readonly parameter: TypeParameterKey }
  | AppliedCheckedType
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId }
  | { readonly kind: "error" };

export function coreCheckedType(coreTypeId: CoreTypeId): CheckedType {
  return { kind: "core", coreTypeId };
}

export function sourceCheckedType(input: {
  readonly itemId: ItemId;
  readonly typeId: TypeId;
}): CheckedType {
  return { kind: "source", itemId: input.itemId, typeId: input.typeId };
}

export function genericParameterCheckedType(parameter: TypeParameterKey): CheckedType {
  return { kind: "genericParameter", parameter };
}

export function appliedType(input: {
  readonly constructor: TypeConstructorId;
  readonly arguments: readonly CheckedType[];
  readonly resourceKind: CheckedResourceKind;
}): CheckedType {
  return {
    kind: "applied",
    constructor: input.constructor,
    arguments: input.arguments,
    resourceKind: input.resourceKind,
  };
}

export function targetCheckedType(targetTypeId: TargetTypeId): CheckedType {
  return { kind: "target", targetTypeId };
}

export function errorCheckedType(): CheckedType {
  return { kind: "error" };
}

export function typeConstructorFingerprint(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${constructor.typeId}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}

export function checkedTypeFingerprint(type: CheckedType): string {
  switch (type.kind) {
    case "core":
      return `core:${type.coreTypeId}`;
    case "source":
      return `source:${type.itemId}:${type.typeId}`;
    case "genericParameter":
      return `genericParam:${type.parameter.owner.kind}:${
        type.parameter.owner.kind === "item"
          ? type.parameter.owner.itemId
          : type.parameter.owner.functionId
      }:${type.parameter.index}`;
    case "applied":
      return `applied:${typeConstructorFingerprint(type.constructor)}<${type.arguments
        .map(checkedTypeFingerprint)
        .join(",")}>:kind:${resourceKindFingerprint(type.resourceKind)}`;
    case "target":
      return `target:${type.targetTypeId}`;
    case "error":
      return "error";
  }
}

export function checkedTypesEqual(left: CheckedType, right: CheckedType): boolean {
  return checkedTypeFingerprint(left) === checkedTypeFingerprint(right);
}

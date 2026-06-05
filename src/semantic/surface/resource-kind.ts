import type { TypeParameterOwner } from "../item-index/item-records";

export type { TypeParameterOwner };

export type ConcreteResourceKind =
  | "Copy"
  | "Affine"
  | "Linear"
  | "UniqueEdgeRoot"
  | "EdgePath"
  | "Stream"
  | "ValidatedBuffer"
  | "PrivateState"
  | "SealedPlatformToken"
  | "Never";

export interface TypeParameterKey {
  readonly owner: TypeParameterOwner;
  readonly index: number;
}

export type ResourceKindDerivationRule =
  | "join"
  | "appliedConstructor"
  | "fieldAggregation"
  | "targetDeclared";

export type CheckedResourceKind =
  | { readonly kind: "concrete"; readonly value: ConcreteResourceKind }
  | { readonly kind: "parametric"; readonly parameter: TypeParameterKey }
  | {
      readonly kind: "derived";
      readonly rule: ResourceKindDerivationRule;
      readonly arguments: readonly CheckedResourceKind[];
    }
  | { readonly kind: "error" };

export function concreteKind(value: ConcreteResourceKind): CheckedResourceKind {
  return { kind: "concrete", value };
}

export function parametricKind(parameter: TypeParameterKey): CheckedResourceKind {
  return { kind: "parametric", parameter };
}

export function derivedKind(
  rule: ResourceKindDerivationRule,
  args: readonly CheckedResourceKind[],
): CheckedResourceKind {
  return { kind: "derived", rule, arguments: args };
}

export function errorKind(): CheckedResourceKind {
  return { kind: "error" };
}

export function isProofRelevantKind(kind: ConcreteResourceKind): boolean {
  switch (kind) {
    case "UniqueEdgeRoot":
    case "EdgePath":
    case "Stream":
    case "ValidatedBuffer":
    case "PrivateState":
    case "SealedPlatformToken":
      return true;
    default:
      return false;
  }
}

export function joinConcreteResourceKinds(
  kinds: readonly ConcreteResourceKind[],
): ConcreteResourceKind {
  let result: ConcreteResourceKind = "Copy";
  for (const kind of kinds) {
    if (kind === "Never") continue;
    if (kind === "Linear" || isProofRelevantKind(kind)) return "Linear";
    if (kind === "Affine") result = "Affine";
  }
  return result;
}

export function joinResourceKinds(kinds: readonly CheckedResourceKind[]): CheckedResourceKind {
  if (kinds.some((kind) => kind.kind === "error")) return errorKind();
  if (kinds.some((kind) => kind.kind === "parametric" || kind.kind === "derived")) {
    return derivedKind("join", kinds);
  }
  const concrete = kinds.map((kind) => (kind.kind === "concrete" ? kind.value : "Copy"));
  return concreteKind(joinConcreteResourceKinds(concrete));
}

export function resourceKindFingerprint(kind: CheckedResourceKind): string {
  switch (kind.kind) {
    case "concrete":
      return `concrete:${kind.value}`;
    case "parametric":
      return `parametric:${kind.parameter.owner.kind}:${
        kind.parameter.owner.kind === "item"
          ? kind.parameter.owner.itemId
          : kind.parameter.owner.functionId
      }:${kind.parameter.index}`;
    case "derived":
      return `derived:${kind.rule}:${kind.arguments.map(resourceKindFingerprint).join(",")}`;
    case "error":
      return "error";
  }
}

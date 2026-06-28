import {
  isProofRelevantKind,
  joinConcreteResourceKinds,
  type ConcreteResourceKind,
} from "../../semantic/surface/resource-kind";
import type { ProofCheckStructuredPlace } from "../kernel/state";
import type { ProofCheckConcreteResourceKind } from "../model/resource-kind";
export type { ProofCheckConcreteResourceKind } from "../model/resource-kind";

export type ProofCheckLiftType =
  | {
      readonly kind: "named";
      readonly typeName: string;
      readonly resourceKind: ProofCheckConcreteResourceKind;
    }
  | { readonly kind: "option"; readonly element: ProofCheckLiftType }
  | {
      readonly kind: "result";
      readonly okType: ProofCheckLiftType;
      readonly errorType: ProofCheckLiftType;
    }
  | { readonly kind: "tuple"; readonly elements: readonly ProofCheckLiftType[] }
  | { readonly kind: "list"; readonly element: ProofCheckLiftType }
  | {
      readonly kind: "map";
      readonly key: ProofCheckLiftType;
      readonly value: ProofCheckLiftType;
    }
  | {
      readonly kind: "aggregate";
      readonly typeName: string;
      readonly fields: readonly { readonly name: string; readonly type: ProofCheckLiftType }[];
      readonly checkedOwner: boolean;
    };

export type LiftProofCheckResourceKindResult =
  | { readonly kind: "ok"; readonly value: ProofCheckConcreteResourceKind }
  | { readonly kind: "error"; readonly reason: "hiddenResourceField" };

export type ProofCheckPlaceProjection =
  | { readonly kind: "field"; readonly fieldName: string }
  | { readonly kind: "tupleIndex"; readonly index: number }
  | { readonly kind: "optionSome" }
  | { readonly kind: "optionNone" }
  | { readonly kind: "resultOk" }
  | { readonly kind: "resultErr" }
  | { readonly kind: "listElement" }
  | { readonly kind: "mapValue" };

export interface ProofCheckStructuredPlacePath {
  readonly rootKey: string;
  readonly projections: readonly ProofCheckPlaceProjection[];
}

export type ProofCheckPlaceRelation =
  | { readonly kind: "same" }
  | { readonly kind: "ancestor" }
  | { readonly kind: "descendant" }
  | { readonly kind: "overlappingSibling" }
  | { readonly kind: "disjointField" }
  | { readonly kind: "unrelatedRoot" };

const PROOF_CHECK_CONCRETE_RESOURCE_KINDS = [
  "Copy",
  "Affine",
  "Linear",
  "UniqueEdgeRoot",
  "EdgePath",
  "Stream",
  "ValidatedBuffer",
  "PrivateState",
  "SealedPlatformToken",
  "Never",
] as const satisfies readonly ProofCheckConcreteResourceKind[];

export function proofCheckConcreteResourceKinds(): readonly ProofCheckConcreteResourceKind[] {
  return PROOF_CHECK_CONCRETE_RESOURCE_KINDS;
}

export function liftProofCheckResourceKind(
  type: ProofCheckLiftType,
): ProofCheckConcreteResourceKind {
  const result = liftProofCheckResourceKindResult(type);
  if (result.kind === "error") {
    throw new RangeError("Cannot lift resource kind for aggregate with hidden resource fields.");
  }
  return result.value;
}

export function liftProofCheckResourceKindResult(
  type: ProofCheckLiftType,
): LiftProofCheckResourceKindResult {
  switch (type.kind) {
    case "named":
      return { kind: "ok", value: type.resourceKind };
    case "option":
      return liftContainedResourceKinds([type.element]);
    case "result":
      return liftContainedResourceKinds([type.okType, type.errorType]);
    case "tuple":
      return liftContainedResourceKinds(type.elements);
    case "list":
      return liftContainedResourceKinds([type.element]);
    case "map":
      return liftContainedResourceKinds([type.value]);
    case "aggregate":
      return liftAggregateResourceKind(type);
  }
}

function liftContainedResourceKinds(
  types: readonly ProofCheckLiftType[],
): LiftProofCheckResourceKindResult {
  const lifted: ConcreteResourceKind[] = [];
  for (const containedType of types) {
    const result = liftProofCheckResourceKindResult(containedType);
    if (result.kind === "error") {
      return result;
    }
    lifted.push(result.value);
  }
  return { kind: "ok", value: joinConcreteResourceKinds(lifted) };
}

function liftAggregateResourceKind(
  type: Extract<ProofCheckLiftType, { readonly kind: "aggregate" }>,
): LiftProofCheckResourceKindResult {
  const lifted: ConcreteResourceKind[] = [];
  for (const field of type.fields) {
    const result = liftProofCheckResourceKindResult(field.type);
    if (result.kind === "error") {
      return result;
    }
    if (requiresCheckedOwnerSemantics(result.value) && !type.checkedOwner) {
      return { kind: "error", reason: "hiddenResourceField" };
    }
    lifted.push(result.value);
  }
  if (type.checkedOwner) {
    return { kind: "ok", value: joinConcreteResourceKinds(lifted) };
  }
  return { kind: "ok", value: "Copy" };
}

export function requiresCheckedOwnerSemantics(kind: ProofCheckConcreteResourceKind): boolean {
  switch (kind) {
    case "Copy":
    case "Never":
      return false;
    case "Affine":
    case "Linear":
    case "UniqueEdgeRoot":
    case "EdgePath":
    case "Stream":
    case "ValidatedBuffer":
    case "PrivateState":
    case "SealedPlatformToken":
      return true;
  }
}

export function parseProofCheckStructuredPlacePath(
  place: ProofCheckStructuredPlace,
): ProofCheckStructuredPlacePath {
  const segments = place.placeKey.split(".");
  const rootKey = segments[0] ?? place.placeKey;
  if (segments.length <= 1) {
    return { rootKey, projections: [] };
  }
  return {
    rootKey,
    projections: segments.slice(1).map(parseProofCheckPlaceProjectionSegment),
  };
}

function parseProofCheckPlaceProjectionSegment(segment: string): ProofCheckPlaceProjection {
  if (/^\d+$/.test(segment)) {
    return { kind: "tupleIndex", index: Number.parseInt(segment, 10) };
  }
  switch (segment) {
    case "some":
      return { kind: "optionSome" };
    case "none":
      return { kind: "optionNone" };
    case "ok":
      return { kind: "resultOk" };
    case "err":
      return { kind: "resultErr" };
    case "elem":
      return { kind: "listElement" };
    case "value":
      return { kind: "mapValue" };
    default:
      return { kind: "field", fieldName: segment };
  }
}

export function buildProofCheckStructuredPlace(input: {
  readonly rootKey: string;
  readonly projections?: readonly ProofCheckPlaceProjection[];
}): ProofCheckStructuredPlace {
  if (input.projections === undefined || input.projections.length === 0) {
    return { placeKey: input.rootKey };
  }
  return {
    placeKey: [input.rootKey, ...input.projections.map(projectionSegmentForPlaceKey)].join("."),
  };
}

function projectionSegmentForPlaceKey(projection: ProofCheckPlaceProjection): string {
  switch (projection.kind) {
    case "field":
      return projection.fieldName;
    case "tupleIndex":
      return String(projection.index);
    case "optionSome":
      return "some";
    case "optionNone":
      return "none";
    case "resultOk":
      return "ok";
    case "resultErr":
      return "err";
    case "listElement":
      return "elem";
    case "mapValue":
      return "value";
  }
}

export function compareProofCheckPlaces(
  left: ProofCheckStructuredPlace,
  right: ProofCheckStructuredPlace,
): ProofCheckPlaceRelation {
  const leftPath = parseProofCheckStructuredPlacePath(left);
  const rightPath = parseProofCheckStructuredPlacePath(right);

  if (leftPath.rootKey !== rightPath.rootKey) {
    return { kind: "unrelatedRoot" };
  }

  if (projectionsEqual(leftPath.projections, rightPath.projections)) {
    return { kind: "same" };
  }

  const sharedPrefixLength = sharedProjectionPrefixLength(
    leftPath.projections,
    rightPath.projections,
  );
  const leftRemainder = leftPath.projections.slice(sharedPrefixLength);
  const rightRemainder = rightPath.projections.slice(sharedPrefixLength);

  if (leftRemainder.length === 0 && rightRemainder.length > 0) {
    return { kind: "ancestor" };
  }
  if (rightRemainder.length === 0 && leftRemainder.length > 0) {
    return { kind: "descendant" };
  }

  const leftHead = leftRemainder[0];
  const rightHead = rightRemainder[0];
  if (leftHead === undefined || rightHead === undefined) {
    return { kind: "same" };
  }

  if (isDisjointSiblingProjection(leftHead, rightHead)) {
    return { kind: "disjointField" };
  }

  if (isOverlappingSiblingProjection(leftHead, rightHead)) {
    return { kind: "overlappingSibling" };
  }

  return { kind: "overlappingSibling" };
}

function projectionsEqual(
  left: readonly ProofCheckPlaceProjection[],
  right: readonly ProofCheckPlaceProjection[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((projection, index) =>
    projectionKeysEqual(projection, right[index] as ProofCheckPlaceProjection),
  );
}

function projectionKeysEqual(
  left: ProofCheckPlaceProjection,
  right: ProofCheckPlaceProjection,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "field":
      return right.kind === "field" && left.fieldName === right.fieldName;
    case "tupleIndex":
      return right.kind === "tupleIndex" && left.index === right.index;
    case "optionSome":
    case "optionNone":
    case "resultOk":
    case "resultErr":
    case "listElement":
    case "mapValue":
      return true;
  }
}

function sharedProjectionPrefixLength(
  left: readonly ProofCheckPlaceProjection[],
  right: readonly ProofCheckPlaceProjection[],
): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit) {
    const leftProjection = left[index];
    const rightProjection = right[index];
    if (
      leftProjection === undefined ||
      rightProjection === undefined ||
      !projectionKeysEqual(leftProjection, rightProjection)
    ) {
      break;
    }
    index += 1;
  }
  return index;
}

function isDisjointSiblingProjection(
  left: ProofCheckPlaceProjection,
  right: ProofCheckPlaceProjection,
): boolean {
  if (left.kind === "field" && right.kind === "field") {
    return left.fieldName !== right.fieldName;
  }
  if (left.kind === "tupleIndex" && right.kind === "tupleIndex") {
    return left.index !== right.index;
  }
  if (left.kind === "resultOk" && right.kind === "resultErr") {
    return true;
  }
  if (left.kind === "resultErr" && right.kind === "resultOk") {
    return true;
  }
  if (left.kind === "optionSome" && right.kind === "optionNone") {
    return true;
  }
  if (left.kind === "optionNone" && right.kind === "optionSome") {
    return true;
  }
  return false;
}

function isOverlappingSiblingProjection(
  left: ProofCheckPlaceProjection,
  right: ProofCheckPlaceProjection,
): boolean {
  if (left.kind === "listElement" || right.kind === "listElement") {
    return true;
  }
  if (left.kind === "mapValue" || right.kind === "mapValue") {
    return true;
  }
  return false;
}

export function isProofRelevantConcreteResourceKind(kind: ProofCheckConcreteResourceKind): boolean {
  return isProofRelevantKind(kind);
}

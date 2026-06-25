import { isProofRelevantKind, resourceKindFingerprint } from "../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import type { CheckedType } from "../semantic/surface/type-model";
import type { HirPlaceProjection, HirPlaceRoot, HirResourcePlace } from "./hir";
import type { HirOriginId } from "./ids";
import { ownedResourcePlaceId } from "./ids";
import type { HirProofOwner } from "./ids";

export interface PlaceForProjectionInput {
  readonly root: HirPlaceRoot;
  readonly projection: readonly HirPlaceProjection[];
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface TemporaryPlaceInput {
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
  readonly proofRelevant: boolean;
}

function ownerKey(owner: HirProofOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${owner.functionId}`;
    case "image":
      return `image:${owner.imageId}`;
    case "type":
      return `type:${owner.typeId}`;
  }
}

function rootKey(root: HirPlaceRoot): string {
  switch (root.kind) {
    case "receiver":
      return `receiver:${root.parameterId}`;
    case "parameter":
      return `parameter:${root.parameterId}`;
    case "local":
      return `local:${root.localId}`;
    case "temporary":
      return `temporary:${root.ordinal}`;
    case "imageDevice":
      return `imageDevice:${root.imageId}:${root.fieldId}`;
    case "validationPayload":
      return `validationPayload:${root.validationId.id}`;
    case "error":
      return "error:0";
  }
}

function projectionKey(projection: readonly HirPlaceProjection[]): string {
  if (projection.length === 0) return "";
  return projection
    .map((part) => {
      switch (part.kind) {
        case "field":
          return `field:${part.fieldId}`;
        case "deref":
          return "deref";
        case "variant":
          return `variant:${part.name}`;
      }
    })
    .join(".");
}

function placeKind(root: HirPlaceRoot): HirResourcePlace["kind"] {
  switch (root.kind) {
    case "receiver":
      return "receiver";
    case "parameter":
      return "parameter";
    case "local":
      return "local";
    case "temporary":
      return "temporary";
    case "imageDevice":
      return "imageDevice";
    case "validationPayload":
      return "validationPayload";
    case "error":
      return "error";
  }
}

function isProofRelevantResourceKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && isProofRelevantKind(kind.value);
}

export class HirResourcePlaceInterner {
  private readonly places = new Map<string, HirResourcePlace>();
  private nextTemporaryOrdinal = 0;

  constructor(private readonly owner: HirProofOwner) {}

  placeForProjection(input: PlaceForProjectionInput): HirResourcePlace {
    const canonicalKey = this.canonicalKey(input);
    const existing = this.places.get(canonicalKey);
    if (existing !== undefined) return existing;

    const place: HirResourcePlace = {
      placeId: ownedResourcePlaceId(this.owner, this.places.size),
      canonicalKey,
      root: input.root,
      projection: [...input.projection],
      type: input.type,
      resourceKind: input.resourceKind,
      sourceOrigin: input.sourceOrigin,
      kind: placeKind(input.root),
    };
    this.places.set(canonicalKey, place);
    return place;
  }

  temporaryForExpression(input: TemporaryPlaceInput): HirResourcePlace | undefined {
    if (!input.proofRelevant && !isProofRelevantResourceKind(input.resourceKind)) return undefined;
    const ordinal = this.nextTemporaryOrdinal;
    this.nextTemporaryOrdinal += 1;
    return this.placeForProjection({
      root: { kind: "temporary", ordinal },
      projection: [],
      type: input.type,
      resourceKind: input.resourceKind,
      sourceOrigin: input.sourceOrigin,
    });
  }

  entries(): readonly HirResourcePlace[] {
    return [...this.places.values()];
  }

  private canonicalKey(input: PlaceForProjectionInput): string {
    return [
      ownerKey(this.owner),
      `root:${rootKey(input.root)}`,
      `projection:${projectionKey(input.projection)}`,
      `type:${checkedTypeFingerprint(input.type)}`,
      `kind:${resourceKindFingerprint(input.resourceKind)}`,
    ].join("/");
  }
}

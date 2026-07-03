import type { ProofMirPlaceId } from "../../proof-mir/ids";
import type { ProofMirFunction, ProofMirPlaceRoot } from "../../proof-mir/model/graph";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckState, ProofCheckStructuredPlace } from "../kernel/state";
import {
  placeKeyForMirPlace,
  type ProofCheckPlaceResolver,
  tryResolveProofMirPlaceIdForPlaceKey,
} from "../kernel/registry/transition-helpers";
import {
  compareProofCheckPlaces,
  requiresCheckedOwnerSemantics,
  type ProofCheckConcreteResourceKind,
} from "./ownership-place-model";

export function isCopyResourceKind(kind: ProofCheckConcreteResourceKind): boolean {
  return kind === "Copy" || kind === "Never";
}

export function hiddenOwnedResourcePlaceKeys(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}): readonly string[] {
  const structuredDescendants = ownedStructuredDescendantPlaceKeys({
    state: input.state,
    place: input.place,
  });
  if (input.functionGraph === undefined) {
    return structuredDescendants;
  }

  const consumedPlaceId = tryResolveProofMirPlaceIdForPlaceKey(
    input.place.placeKey,
    input.placeResolver,
  );
  if (consumedPlaceId === undefined) {
    return structuredDescendants;
  }

  return [
    ...new Set([
      ...structuredDescendants,
      ...hiddenOwnedProjectionPlaceKeys({
        state: input.state,
        consumedPlaceId,
        functionGraph: input.functionGraph,
        placeResolver: input.placeResolver,
      }),
      ...hiddenOwnedTrailingParameterPlaceKeys({
        state: input.state,
        consumedPlaceId,
        functionGraph: input.functionGraph,
        placeResolver: input.placeResolver,
      }),
    ]),
  ].sort(compareCodeUnitStrings);
}

function structuredPlace(placeKey: string): ProofCheckStructuredPlace {
  return { placeKey };
}

function ownedStructuredDescendantPlaceKeys(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
}): readonly string[] {
  return [...input.state.places.entries()]
    .filter(([, placeState]) => placeState.lifecycle === "owned")
    .filter(([placeKey]) => {
      const relation = compareProofCheckPlaces(input.place, structuredPlace(placeKey));
      return relation.kind === "descendant";
    })
    .map(([placeKey]) => placeKey)
    .sort(compareCodeUnitStrings);
}

function hiddenOwnedProjectionPlaceKeys(input: {
  readonly state: ProofCheckState;
  readonly consumedPlaceId: ProofMirPlaceId;
  readonly functionGraph: ProofMirFunction;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const consumedPlace = input.functionGraph.places.get(input.consumedPlaceId);
  if (consumedPlace === undefined || consumedPlace.projection.length > 0) {
    return [];
  }
  const consumedRootKey = proofMirPlaceRootKey(consumedPlace.root);
  return input.functionGraph.places
    .entries()
    .filter((place) => place.placeId !== input.consumedPlaceId)
    .filter((place) => place.projection.length > 0)
    .filter((place) => proofMirPlaceRootKey(place.root) === consumedRootKey)
    .filter((place) =>
      requiresCheckedOwnerSemantics(place.resourceKind as ProofCheckConcreteResourceKind),
    )
    .filter((place) =>
      isPlaceOwnedInState({
        state: input.state,
        placeId: place.placeId,
        placeResolver: input.placeResolver,
      }),
    )
    .map((place) => placeKeyForMirPlace(place.placeId))
    .sort(compareCodeUnitStrings);
}

function hiddenOwnedTrailingParameterPlaceKeys(input: {
  readonly state: ProofCheckState;
  readonly consumedPlaceId: ProofMirPlaceId;
  readonly functionGraph: ProofMirFunction;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const consumedPlace = input.functionGraph.places.get(input.consumedPlaceId);
  if (
    consumedPlace === undefined ||
    consumedPlace.projection.length > 0 ||
    consumedPlace.root.kind !== "parameter" ||
    !isCopyResourceKind(consumedPlace.resourceKind as ProofCheckConcreteResourceKind)
  ) {
    return [];
  }
  const wrapperParameterId =
    consumedPlace.root.kind === "parameter" ? consumedPlace.root.parameterId : undefined;
  if (wrapperParameterId === undefined) {
    return [];
  }
  const wrapperIndex = input.functionGraph.signature.parameters.findIndex(
    (parameter) => String(parameter.parameterId) === String(wrapperParameterId),
  );
  if (wrapperIndex < 0) {
    return [];
  }

  const leaks: string[] = [];
  for (const [index, parameter] of input.functionGraph.signature.parameters.entries()) {
    if (index <= wrapperIndex) {
      continue;
    }
    if (!requiresCheckedOwnerSemantics(parameter.resourceKind as ProofCheckConcreteResourceKind)) {
      continue;
    }
    const parameterPlace = input.functionGraph.places
      .entries()
      .find(
        (place) =>
          place.root.kind === "parameter" &&
          String(place.root.parameterId) === String(parameter.parameterId),
      );
    if (parameterPlace === undefined) {
      continue;
    }
    if (
      isPlaceOwnedInState({
        state: input.state,
        placeId: parameterPlace.placeId,
        placeResolver: input.placeResolver,
      })
    ) {
      leaks.push(placeKeyForMirPlace(parameterPlace.placeId));
    }
  }
  return leaks.sort(compareCodeUnitStrings);
}

function isPlaceOwnedInState(input: {
  readonly state: ProofCheckState;
  readonly placeId: ProofMirPlaceId;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): boolean {
  const directKey = placeKeyForMirPlace(input.placeId);
  if (input.state.places.get(directKey)?.lifecycle === "owned") {
    return true;
  }
  if (input.placeResolver === undefined) {
    return false;
  }
  for (const [placeKey, placeId] of input.placeResolver.index.entries()) {
    if (String(placeId) !== String(input.placeId)) {
      continue;
    }
    if (input.state.places.get(placeKey)?.lifecycle === "owned") {
      return true;
    }
  }
  return false;
}

function proofMirPlaceRootKey(root: ProofMirPlaceRoot): string {
  switch (root.kind) {
    case "parameter":
      return `parameter:${String(root.parameterId)}`;
    case "receiver":
      return `receiver:${String(root.parameterId)}`;
    case "local":
      return `local:${String(root.localId)}`;
    case "temporary":
      return `temporary:${String(root.ordinal)}`;
    case "imageDevice":
      return `imageDevice:${String(root.imageId)}:${String(root.fieldId)}`;
    case "validationPayload":
      return `validationPayload:${String(root.validationId)}`;
    case "error":
      return "error";
    case "blockParameter":
      return `blockParameter:${String(root.valueId)}`;
    case "runtimeTemporary":
      return `runtimeTemporary:${String(root.valueId)}`;
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

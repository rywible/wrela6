import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirOwnedPlaceId,
  type ProofMirOwnedPlaceId,
  type ProofMirPlaceId,
} from "../../proof-mir/ids";
import type { ProofMirFunction, ProofMirPlaceRoot } from "../../proof-mir/model/graph";
import type { ProofMirLayoutTermReference } from "../../proof-mir/model/layout-bindings";
import {
  proofCheckPlaceBinderKey,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
} from "../model/fact-language";
import { mirPlaceKey } from "./mir-operation-metadata";

export function placeBinderForMirOwnedPlace(
  functionGraph: ProofMirFunction,
  ownedPlaceId: ProofMirOwnedPlaceId,
): ProofCheckPlaceBinder {
  const place = functionGraph.places.get(ownedPlaceId.placeId);
  if (place === undefined) {
    return { kind: "proofMirPlace", placeId: ownedPlaceId.placeId };
  }
  return placeBinderForMirPlaceRoot(functionGraph, place.root, ownedPlaceId.placeId);
}

function placeBinderForMirPlaceRoot(
  functionGraph: ProofMirFunction,
  root: ProofMirPlaceRoot,
  placeId: ProofMirPlaceId,
): ProofCheckPlaceBinder {
  switch (root.kind) {
    case "receiver":
      return { kind: "receiver" };
    case "parameter": {
      if (
        functionGraph.signature.receiver !== undefined &&
        String(functionGraph.signature.receiver.parameterId) === String(root.parameterId)
      ) {
        return { kind: "receiver" };
      }
      const index = functionGraph.signature.parameters.findIndex(
        (parameter) => String(parameter.parameterId) === String(root.parameterId),
      );
      return {
        kind: "parameter",
        index: index >= 0 ? index : 0,
        parameterId: root.parameterId,
      };
    }
    case "local":
    case "temporary":
    case "imageDevice":
    case "validationPayload":
    case "error":
    case "blockParameter":
    case "runtimeTemporary":
      return { kind: "proofMirPlace", placeId };
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

export function operandFromLayoutTermReference(
  term: ProofMirLayoutTermReference,
): ProofCheckOperandTerm {
  return { kind: "layoutTerm", term };
}

function registerPlaceBinderKeys(
  index: Map<string, ProofMirPlaceId>,
  binder: ProofCheckPlaceBinder,
  placeId: ProofMirPlaceId,
): void {
  index.set(proofCheckPlaceBinderKey(binder), placeId);
  if (binder.kind === "parameter") {
    index.set(`parameter:${binder.index}`, placeId);
  }
  if (binder.kind === "argument") {
    index.set(`argument:${binder.index}`, placeId);
  }
}

export function buildPlaceKeyToMirPlaceIdIndex(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
}): ReadonlyMap<string, ProofMirPlaceId> {
  const index = new Map<string, ProofMirPlaceId>();
  for (const place of input.functionGraph.places.entries()) {
    const placeId = place.placeId;
    index.set(mirPlaceKey(placeId), placeId);
    const binder = placeBinderForMirOwnedPlace(
      input.functionGraph,
      proofMirOwnedPlaceId(input.functionInstanceId, placeId),
    );
    registerPlaceBinderKeys(index, binder, placeId);
  }
  return index;
}

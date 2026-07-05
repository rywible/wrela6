import type {
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirPlace,
} from "../../../proof-mir/model/graph";
import { mirPlaceKey } from "../../domains/mir-operation-metadata";
import {
  layoutPatch,
  packetSourcePatch,
  placeStatePatch,
} from "../../domains/validation-state-patches";
import type { ProofCheckStatePatchEntry } from "../state-patch";
import type { ProofCheckTransition, ProofCheckTransitionResult } from "../transition-api";
import {
  identityTransition,
  patchTransition,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

function validatedBufferLayoutKeyForPlace(input: {
  readonly context: ProofCheckRegistryContext;
  readonly place: ProofMirPlace;
}): string | undefined {
  if (input.place.resourceKind !== "ValidatedBuffer" || input.place.projection.length > 0) {
    return undefined;
  }
  const typeId =
    input.place.type.kind === "source"
      ? input.place.type.typeId
      : input.place.type.kind === "applied" && input.place.type.constructor.kind === "source"
        ? input.place.type.constructor.typeId
        : undefined;
  if (typeId === undefined) return undefined;
  const expectedPrefix = `type:${String(typeId)}|`;
  const matches = input.context.input.mir.layout.validatedBuffers
    .entries()
    .filter((buffer) => String(buffer.instanceId).startsWith(expectedPrefix));
  return matches.length === 1 ? String(matches[0]!.instanceId) : undefined;
}

export function replaySwitchCaseEdgeEffects(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
}): ProofCheckTransitionResult {
  const patches: ProofCheckStatePatchEntry[] = [];
  for (const effect of input.edge.effects) {
    if (effect.kind !== "introducePlace") continue;
    const place = input.functionGraph.places.get(effect.placeId);
    if (place === undefined) continue;
    const placeKey = mirPlaceKey(effect.placeId);
    patches.push(placeStatePatch(placeKey, "owned", input.context.placeResolver));
    const layoutKey = validatedBufferLayoutKeyForPlace({ context: input.context, place });
    if (layoutKey !== undefined) {
      patches.push(layoutPatch(placeKey, layoutKey, input.context.placeResolver));
      patches.push(packetSourcePatch(placeKey, placeKey, input.context.placeResolver));
    }
  }
  if (patches.length === 0) return identityTransition(input.transition);
  return patchTransition(input.transition, input.context, { kind: "ok", patches });
}

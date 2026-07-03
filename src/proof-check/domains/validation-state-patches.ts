import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  canonicalProofCheckPlaceKey,
  proofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import type { CheckedActiveFact, CheckedPlaceState, CheckedValidationState } from "../kernel/state";

export function placeStatePatch(
  placeKey: string,
  lifecycle: CheckedPlaceState["lifecycle"],
  placeResolver?: ProofCheckPlaceResolver,
): ProofCheckStatePatchEntry {
  const canonicalPlaceKey = canonicalProofCheckPlaceKey(placeKey, placeResolver);
  return {
    kind: "placeState",
    place: proofMirPlaceIdForPlaceKey(canonicalPlaceKey, placeResolver),
    state: { placeKey: canonicalPlaceKey, lifecycle },
  };
}

export function validationPatch(
  validation: CheckedValidationState,
  action: "open" | "consume" | "close",
): ProofCheckStatePatchEntry {
  return { kind: "validation", action, validation };
}

export function layoutPatch(
  bufferKey: string,
  layoutKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): ProofCheckStatePatchEntry {
  const canonicalBufferKey = canonicalProofCheckPlaceKey(bufferKey, placeResolver);
  return {
    kind: "layout",
    layout: { bufferKey: canonicalBufferKey, layoutKey },
  };
}

export function packetSourcePatch(
  packetKey: string,
  sourceKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): ProofCheckStatePatchEntry {
  const canonicalPacketKey = canonicalProofCheckPlaceKey(packetKey, placeResolver);
  const canonicalSourceKey = canonicalProofCheckPlaceKey(sourceKey, placeResolver);
  return {
    kind: "packetSource",
    packetSource: { packetKey: canonicalPacketKey, sourceKey: canonicalSourceKey },
  };
}

export function factAddPatch(fact: CheckedActiveFact): ProofCheckStatePatchEntry {
  return { kind: "fact", action: "add", fact };
}

export function canonicalPlaceKeys(
  placeKeys: readonly string[] | undefined,
  placeResolver?: ProofCheckPlaceResolver,
): readonly string[] | undefined {
  if (placeKeys === undefined) {
    return undefined;
  }
  return [
    ...new Set(placeKeys.map((placeKey) => canonicalProofCheckPlaceKey(placeKey, placeResolver))),
  ].sort(compareCodeUnitStrings);
}

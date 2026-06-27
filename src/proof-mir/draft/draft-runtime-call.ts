import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirFactOperandFreezeLookups } from "./draft-fact-operands";
import { proofMirOwnedPlaceId } from "../ids";
import type { ProofMirRuntimeEffect } from "../model/calls";

export type DraftProofMirRuntimeEffect =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "writesMemory"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "advancesPrivateState"; readonly placeKey: ProofMirCanonicalKey }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

function resolveOwnedPlaceId(
  lookups: DraftProofMirFactOperandFreezeLookups,
  placeKey: ProofMirCanonicalKey,
) {
  const resolved = lookups.placeKeyLookup.resolve(placeKey);
  if (resolved === undefined) {
    return undefined;
  }
  return proofMirOwnedPlaceId(resolved.functionInstanceId, resolved.placeId);
}

export function freezeDraftRuntimeEffect(
  effect: DraftProofMirRuntimeEffect,
  lookups: DraftProofMirFactOperandFreezeLookups,
): ProofMirRuntimeEffect | undefined {
  switch (effect.kind) {
    case "pure":
      return { kind: "pure" };
    case "mayPanic":
      return { kind: "mayPanic" };
    case "doesNotReturn":
      return { kind: "doesNotReturn" };
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState": {
      const place = resolveOwnedPlaceId(lookups, effect.placeKey);
      if (place === undefined) {
        return undefined;
      }
      return { kind: effect.kind, place };
    }
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

export function freezeDraftRuntimeCapabilityPlaceKeys(
  placeKeys: readonly ProofMirCanonicalKey[],
  lookups: DraftProofMirFactOperandFreezeLookups,
): readonly ReturnType<typeof proofMirOwnedPlaceId>[] | undefined {
  const capabilities = [];
  for (const placeKey of placeKeys) {
    const place = resolveOwnedPlaceId(lookups, placeKey);
    if (place === undefined) {
      return undefined;
    }
    capabilities.push(place);
  }
  return capabilities;
}

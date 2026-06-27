import type {
  DraftProofMirPlaceProjection,
  DraftProofMirPlaceRoot,
} from "../domains/effects-resources";
import type { ProofMirPlaceId, ProofMirValueId } from "../ids";
import type { ProofMirPlaceProjection, ProofMirPlaceRoot } from "../model/graph";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import type { ProofMirCanonicalKeyLookup } from "./id-assignment";

export function freezeDraftPlaceRoot(input: {
  readonly root: DraftProofMirPlaceRoot;
  readonly valueLookup: ProofMirCanonicalKeyLookup<ProofMirValueId>;
}): ProofMirPlaceRoot | undefined {
  switch (input.root.kind) {
    case "blockParameter": {
      const valueId = input.valueLookup.resolve(input.root.valueKey);
      if (valueId === undefined) {
        return undefined;
      }
      return { kind: "blockParameter", valueId };
    }
    case "runtimeTemporary": {
      const valueId = input.valueLookup.resolve(input.root.valueKey);
      if (valueId === undefined) {
        return undefined;
      }
      return { kind: "runtimeTemporary", valueId };
    }
    default:
      return input.root;
  }
}

export function freezeDraftPlaceProjection(
  projection: DraftProofMirPlaceProjection,
): ProofMirPlaceProjection {
  switch (projection.kind) {
    case "field":
    case "deref":
    case "variant":
      return projection;
    case "validatedPacketPayload":
    case "imageDevice":
      return projection;
    default: {
      const unreachable: never = projection;
      return unreachable;
    }
  }
}

export function resolveFrozenPlaceId(input: {
  readonly placeKey: ProofMirCanonicalKey;
  readonly placeLookup: ProofMirCanonicalKeyLookup<ProofMirPlaceId>;
}): ProofMirPlaceId | undefined {
  return input.placeLookup.resolve(input.placeKey);
}

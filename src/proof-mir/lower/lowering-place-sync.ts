import type { MonoResourcePlace } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirPlaceProjection,
  DraftProofMirStructuredPlace,
} from "../domains/effects-resources";
import type { LoweredProofMirPlace } from "./scope-place-lowerer";
import type { ProofMirLoweringContext } from "./lowering-context";

export function structuredPlaceFromLowered(
  context: ProofMirLoweringContext,
  lowered: LoweredProofMirPlace,
  monoPlace?: MonoResourcePlace,
): DraftProofMirStructuredPlace {
  const projection: readonly DraftProofMirPlaceProjection[] = lowered.projections.map(
    (entry) => entry.projection,
  );
  return {
    key: lowered.placeKey,
    functionInstanceId: context.functionInstanceId,
    root: lowered.root,
    projection,
    ...(lowered.monoPlaceCanonicalKey === undefined
      ? {}
      : { monoPlaceCanonicalKey: lowered.monoPlaceCanonicalKey }),
    originKey: lowered.originKey,
    ...(monoPlace?.type === undefined ? {} : { type: monoPlace.type }),
    ...(monoPlace?.resourceKind === undefined ? {} : { resourceKind: monoPlace.resourceKind }),
  };
}

export function syncLoweredPlaceToFunctionDraft(input: {
  readonly context: ProofMirLoweringContext;
  readonly lowered: LoweredProofMirPlace;
  readonly monoPlace?: MonoResourcePlace;
}): ProofMirCanonicalKey {
  const structured = structuredPlaceFromLowered(input.context, input.lowered, input.monoPlace);
  input.context.graph.createPlace({
    monoPlaceCanonicalKey:
      structured.monoPlaceCanonicalKey ?? `structured:${String(structured.key)}`,
    origin: structured.originKey,
    root: structured.root,
    projection: structured.projection,
    ...(structured.type === undefined ? {} : { type: structured.type }),
    ...(structured.resourceKind === undefined ? {} : { resourceKind: structured.resourceKind }),
  });
  input.context.graph.acceptStructuredPlace(structured);
  return structured.key;
}

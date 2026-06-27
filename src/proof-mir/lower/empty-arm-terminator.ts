import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { loweringOk } from "./loop-scaffold";
import { type ProofMirLoweringContext, type ProofMirLoweringResult } from "./lowering-context";

export function setEmptyArmUnreachableTerminator(input: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly origin: ProofMirCanonicalKey;
}): ProofMirLoweringResult<void> {
  const setTerminatorResult = input.context.graph.setTerminator(input.blockKey, {
    kind: "unreachable",
    reason: "emptyMatch",
    origin: input.origin,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  return loweringOk(undefined);
}

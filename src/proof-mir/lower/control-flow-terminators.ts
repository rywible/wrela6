import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirLoweringContext } from "./lowering-context";

export function blockHasTerminator(
  context: ProofMirLoweringContext,
  blockKey: ProofMirCanonicalKey,
): boolean {
  return context.graph.block(blockKey).terminator !== undefined;
}

export function blockHasExitTerminator(
  context: ProofMirLoweringContext,
  blockKey: ProofMirCanonicalKey,
): boolean {
  const terminator = context.graph.block(blockKey).terminator;
  switch (terminator?.kind) {
    case "return":
    case "panic":
    case "goto":
    case "unreachable":
      return true;
    default:
      return false;
  }
}

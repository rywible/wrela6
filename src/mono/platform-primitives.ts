import type { PlatformPrimitiveId } from "../semantic/ids";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { MonomorphizedHirProgram } from "./mono-hir";

export function collectReachablePlatformPrimitiveIds(
  program: MonomorphizedHirProgram,
): readonly PlatformPrimitiveId[] {
  const seen = new Set<PlatformPrimitiveId>();
  for (const edge of program.proofMetadata.platformContractEdges.entries()) {
    seen.add(edge.primitiveId);
  }
  return [...seen].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

import type { ProofMirValueId } from "../../proof-mir/ids";
import { proofMirValueId } from "../../proof-mir/ids";
import type { OptIrValueId } from "../ids";

export function proofMirScopedValueKey(
  functionInstanceId: unknown,
  valueId: ProofMirValueId,
): string {
  return `${String(functionInstanceId)}/${String(valueId)}`;
}

export function proofMirValueIdFromScopedKey(valueKey: string): ProofMirValueId | undefined {
  const separator = valueKey.lastIndexOf("/");
  if (separator < 0) {
    return undefined;
  }
  const suffix = valueKey.slice(separator + 1);
  const numeric = Number(suffix);
  return Number.isFinite(numeric) ? proofMirValueId(numeric) : undefined;
}

export function proofMirValueIdsForOptIrValues(input: {
  readonly valueIdsByKey: ReadonlyMap<string, OptIrValueId>;
  readonly proofOnlyOptIrValueIds: ReadonlySet<OptIrValueId>;
}): ReadonlySet<ProofMirValueId> {
  const proofMirValueIds = new Set<ProofMirValueId>();
  for (const [valueKey, valueId] of input.valueIdsByKey) {
    if (!input.proofOnlyOptIrValueIds.has(valueId)) {
      continue;
    }
    const proofMirValueId = proofMirValueIdFromScopedKey(valueKey);
    if (proofMirValueId !== undefined) {
      proofMirValueIds.add(proofMirValueId);
    }
  }
  return proofMirValueIds;
}

export function compareStableKeys(left: string | number, right: string | number): number {
  return String(left).localeCompare(String(right), "en", { numeric: true });
}

export function compareOperations<Operation extends { readonly operationId: number }>(
  left: Operation,
  right: Operation,
): number {
  return left.operationId - right.operationId;
}

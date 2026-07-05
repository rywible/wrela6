import { hirStatementId } from "../../hir/ids";
import { instantiatedHirId, type MonoInstanceId } from "../../mono/ids";
import type { MonoStatementId } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirPlaceId,
  proofMirValueId,
  type ProofMirPlaceId,
  type ProofMirValueId,
} from "../ids";

export interface ProofMirAttemptIdAllocator {
  valueForKey(key: ProofMirCanonicalKey): ProofMirValueId;
  placeForKey(key: ProofMirCanonicalKey): ProofMirPlaceId;
  nextMonoStatementId(functionInstanceId: MonoInstanceId): MonoStatementId;
}

export function createAttemptIdAllocator(): ProofMirAttemptIdAllocator {
  let nextPlace = 0;
  let nextValue = 0;
  let nextMonoStatement = 1;
  const placeKeys = new Map<ProofMirCanonicalKey, ProofMirPlaceId>();
  const valueKeys = new Map<ProofMirCanonicalKey, ProofMirValueId>();

  return {
    valueForKey(key) {
      const existing = valueKeys.get(key);
      if (existing !== undefined) return existing;
      const id = proofMirValueId(nextValue++);
      valueKeys.set(key, id);
      return id;
    },
    placeForKey(key) {
      const existing = placeKeys.get(key);
      if (existing !== undefined) return existing;
      const id = proofMirPlaceId(nextPlace++);
      placeKeys.set(key, id);
      return id;
    },
    nextMonoStatementId(functionInstanceId) {
      return instantiatedHirId(functionInstanceId, hirStatementId(nextMonoStatement++));
    },
  };
}

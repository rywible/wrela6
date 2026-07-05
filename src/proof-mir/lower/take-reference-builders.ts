import type { BrandId, ObligationId, SessionId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirObligationReference,
  DraftProofMirSessionMemberReference,
} from "../draft/draft-statement";

export function draftObligationReference(input: {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirObligationReference {
  return {
    obligationId: input.obligationId,
    originKey: input.originKey,
  };
}

export function draftSessionMemberReference(input: {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly obligationId?: MonoInstantiatedProofId<ObligationId>;
  readonly placeKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirSessionMemberReference {
  return {
    sessionId: input.sessionId,
    brandId: input.brandId,
    ...(input.obligationId === undefined ? {} : { obligationId: input.obligationId }),
    ...(input.placeKey === undefined ? {} : { placeKey: input.placeKey }),
    originKey: input.originKey,
  };
}

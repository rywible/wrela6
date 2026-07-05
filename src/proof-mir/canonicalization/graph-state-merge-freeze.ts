import type { BrandId, ObligationId, SessionId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { DraftProofMirGraphBlockSnapshot } from "../draft/draft-program";
import type { ProofMirLoanId, ProofMirOriginId, ProofMirPlaceId, ProofMirScopeId } from "../ids";
import type {
  ProofMirBlockStateMerge,
  ProofMirPrivateStateGenerationReference,
  ProofMirResourceBoundarySet,
} from "../model/graph";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import {
  pushFreezeUnresolvedReference,
  type FreezeGraphSnapshotErrorContext,
} from "./graph-freeze-errors";
import type { ProofMirCanonicalKeyLookup } from "./id-assignment";

export interface FreezeBlockStateMergeLookups {
  readonly scopeLookup: ProofMirCanonicalKeyLookup<ProofMirScopeId>;
  readonly loanLookup: ProofMirCanonicalKeyLookup<ProofMirLoanId>;
  readonly placeLookup: ProofMirCanonicalKeyLookup<ProofMirPlaceId>;
  readonly resolveOrigin: (key: ProofMirCanonicalKey) => ProofMirOriginId | undefined;
  readonly resolveObligationId: (
    proofKey: string,
  ) => MonoInstantiatedProofId<ObligationId> | undefined;
  readonly resolveSessionId: (proofKey: string) => MonoInstantiatedProofId<SessionId> | undefined;
  readonly resolveBrandId: (proofKey: string) => MonoInstantiatedProofId<BrandId> | undefined;
  readonly resolvePrivateStateGeneration: (
    generationKey: ProofMirCanonicalKey,
  ) => ProofMirPrivateStateGenerationReference | undefined;
}

export function freezeBlockStateMerge(
  lookups: FreezeBlockStateMergeLookups,
  snapshotBlock: DraftProofMirGraphBlockSnapshot,
  context: FreezeGraphSnapshotErrorContext,
): ProofMirBlockStateMerge | undefined {
  const stateMerge = snapshotBlock.stateMerge;
  if (stateMerge === undefined) {
    return undefined;
  }
  const loopScopeId = lookups.scopeLookup.resolve(stateMerge.loopScopeKey);
  const origin = lookups.resolveOrigin(stateMerge.originKey);
  const boundaryResources = freezeBoundaryResources(lookups, stateMerge.boundaryResources, context);
  if (loopScopeId === undefined || origin === undefined || boundaryResources === undefined) {
    pushFreezeUnresolvedReference(
      context,
      "block-state-merge",
      String(snapshotBlock.key),
      "Proof MIR freeze could not resolve a loop header state merge reference.",
    );
    return undefined;
  }
  return {
    kind: "loopHeader",
    loopScopeId,
    boundaryResources,
    origin,
  };
}

function freezeBoundaryResources(
  lookups: FreezeBlockStateMergeLookups,
  boundary: NonNullable<DraftProofMirGraphBlockSnapshot["stateMerge"]>["boundaryResources"],
  context: FreezeGraphSnapshotErrorContext,
): ProofMirResourceBoundarySet | undefined {
  const places = boundary.places.map((placeKey) => lookups.placeLookup.resolve(placeKey));
  const loans = boundary.loans.map((loanKey) => lookups.loanLookup.resolve(loanKey));
  const obligations = boundary.obligations.map((obligation) => {
    const origin = lookups.resolveOrigin(obligation.originKey);
    const obligationId = lookups.resolveObligationId(obligation.obligationProofKey);
    return origin === undefined || obligationId === undefined
      ? undefined
      : { obligationId, origin };
  });
  const sessionMembers = boundary.sessionMembers.map((member) => {
    const origin = lookups.resolveOrigin(member.originKey);
    const sessionId = lookups.resolveSessionId(member.sessionProofKey);
    const brandId = lookups.resolveBrandId(member.brandProofKey);
    const obligationId =
      member.obligationProofKey === undefined
        ? undefined
        : lookups.resolveObligationId(member.obligationProofKey);
    const placeId =
      member.placeKey === undefined ? undefined : lookups.placeLookup.resolve(member.placeKey);
    if (
      origin === undefined ||
      sessionId === undefined ||
      brandId === undefined ||
      (member.obligationProofKey !== undefined && obligationId === undefined) ||
      (member.placeKey !== undefined && placeId === undefined)
    ) {
      return undefined;
    }
    return {
      sessionId,
      brandId,
      ...(obligationId === undefined ? {} : { obligationId }),
      ...(placeId === undefined ? {} : { placeId }),
      origin,
    };
  });
  const privateStateGenerations = boundary.privateStateGenerations.map((generation) =>
    lookups.resolvePrivateStateGeneration(generation.generationKey),
  );
  if (
    places.some((place): place is undefined => place === undefined) ||
    loans.some((loan): loan is undefined => loan === undefined) ||
    obligations.some((obligation): obligation is undefined => obligation === undefined) ||
    sessionMembers.some((member): member is undefined => member === undefined) ||
    privateStateGenerations.some((generation): generation is undefined => generation === undefined)
  ) {
    pushFreezeUnresolvedReference(
      context,
      "boundary-resources",
      "stateMerge.boundaryResources",
      "Proof MIR freeze could not resolve a loop header boundary resource reference.",
    );
    return undefined;
  }
  return {
    places: places.filter(
      (place): place is NonNullable<(typeof places)[number]> => place !== undefined,
    ),
    loans: loans.filter((loan): loan is NonNullable<(typeof loans)[number]> => loan !== undefined),
    obligations: obligations.filter(
      (obligation): obligation is NonNullable<(typeof obligations)[number]> =>
        obligation !== undefined,
    ),
    sessionMembers: sessionMembers.filter(
      (member): member is NonNullable<(typeof sessionMembers)[number]> => member !== undefined,
    ),
    privateStateGenerations: privateStateGenerations.filter(
      (generation): generation is NonNullable<(typeof privateStateGenerations)[number]> =>
        generation !== undefined,
    ),
  };
}

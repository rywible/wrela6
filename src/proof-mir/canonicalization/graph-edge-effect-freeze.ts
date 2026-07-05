import type { BrandId, ObligationId, SessionId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { DraftGraphEdgeEffect } from "../draft/draft-graph-builder";
import type { DraftProofMirExitClosurePolicy } from "../draft/draft-program";
import type { ProofMirLoanId, ProofMirOriginId, ProofMirPlaceId, ProofMirScopeId } from "../ids";
import type {
  ProofMirEdgeEffect,
  ProofMirExitClosurePolicy,
  ProofMirPrivateStateGenerationReference,
} from "../model/graph";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import {
  pushFreezeUnresolvedReference,
  type FreezeGraphSnapshotErrorContext,
} from "./graph-freeze-errors";
import type { ProofMirCanonicalKeyLookup } from "./id-assignment";

export interface FreezeGraphEdgeEffectLookups {
  readonly scopeLookup: ProofMirCanonicalKeyLookup<ProofMirScopeId>;
  readonly placeLookup: ProofMirCanonicalKeyLookup<ProofMirPlaceId>;
  readonly loanLookup: ProofMirCanonicalKeyLookup<ProofMirLoanId>;
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

export function freezeEdgeEffect(
  lookups: FreezeGraphEdgeEffectLookups,
  effect: DraftGraphEdgeEffect,
): ProofMirEdgeEffect | undefined {
  switch (effect.kind) {
    case "consumePlace": {
      const placeId = lookups.placeLookup.resolve(effect.placeKey);
      return placeId === undefined ? undefined : { kind: "consumePlace", placeId };
    }
    case "introducePlace": {
      const placeId = lookups.placeLookup.resolve(effect.placeKey);
      return placeId === undefined ? undefined : { kind: "introducePlace", placeId };
    }
    case "startLoan":
    case "endLoan": {
      const loanId = lookups.loanLookup.resolve(effect.loanKey);
      return loanId === undefined ? undefined : { kind: effect.kind, loanId };
    }
    case "openObligation":
    case "dischargeObligation": {
      const origin = lookups.resolveOrigin(effect.originKey);
      const obligationId = lookups.resolveObligationId(effect.obligationProofKey);
      if (origin === undefined || obligationId === undefined) return undefined;
      return { kind: effect.kind, obligation: { obligationId, origin } };
    }
    case "openSessionMember":
    case "closeSessionMember": {
      const origin = lookups.resolveOrigin(effect.originKey);
      const sessionId = lookups.resolveSessionId(effect.sessionProofKey);
      const brandId = lookups.resolveBrandId(effect.brandProofKey);
      if (origin === undefined || sessionId === undefined || brandId === undefined) {
        return undefined;
      }
      const obligationId =
        effect.obligationProofKey === undefined
          ? undefined
          : lookups.resolveObligationId(effect.obligationProofKey);
      if (effect.obligationProofKey !== undefined && obligationId === undefined) {
        return undefined;
      }
      const placeId =
        effect.placeKey === undefined ? undefined : lookups.placeLookup.resolve(effect.placeKey);
      if (effect.placeKey !== undefined && placeId === undefined) {
        return undefined;
      }
      return {
        kind: effect.kind,
        member: {
          sessionId,
          brandId,
          ...(obligationId === undefined ? {} : { obligationId }),
          ...(placeId === undefined ? {} : { placeId }),
          origin,
        },
      };
    }
    case "advancePrivateState": {
      const from = lookups.resolvePrivateStateGeneration(effect.fromGenerationKey);
      const target = lookups.resolvePrivateStateGeneration(effect.toGenerationKey);
      if (from === undefined || target === undefined) return undefined;
      return { kind: "advancePrivateState", from, target };
    }
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

export function freezeScopeKeyList(input: {
  readonly lookups: Pick<FreezeGraphEdgeEffectLookups, "scopeLookup">;
  readonly scopeKeys: readonly ProofMirCanonicalKey[];
  readonly errorContext: FreezeGraphSnapshotErrorContext;
  readonly diagnosticRole: string;
  readonly message: string;
}): ProofMirScopeId[] | "error" {
  const scopes: ProofMirScopeId[] = [];
  for (const scopeKey of input.scopeKeys) {
    const scopeId = input.lookups.scopeLookup.resolve(scopeKey);
    if (scopeId === undefined) {
      pushFreezeUnresolvedReference(
        input.errorContext,
        input.diagnosticRole,
        String(scopeKey),
        input.message,
      );
      return "error";
    }
    scopes.push(scopeId);
  }
  return scopes;
}

export function freezeExitClosure(input: {
  readonly lookups: FreezeGraphEdgeEffectLookups;
  readonly exitKey: ProofMirCanonicalKey;
  readonly closure: DraftProofMirExitClosurePolicy;
  readonly errorContext: FreezeGraphSnapshotErrorContext;
}): ProofMirExitClosurePolicy | "error" {
  if (input.closure.kind === "functionExit") return input.closure;

  const checkedScopes = freezeScopeKeyList({
    lookups: input.lookups,
    scopeKeys: input.closure.checkedScopeKeys,
    errorContext: input.errorContext,
    diagnosticRole: "exit-closure-checked-scope",
    message: "Proof MIR freeze could not resolve an exit closure checked scope reference.",
  });
  if (checkedScopes === "error") return "error";

  const allowedTransfers: ProofMirEdgeEffect[] = [];
  for (const transfer of input.closure.allowedTransfers) {
    const frozenTransfer = freezeEdgeEffect(input.lookups, transfer);
    if (frozenTransfer === undefined) {
      pushFreezeUnresolvedReference(
        input.errorContext,
        "exit-closure-transfer",
        String(input.exitKey),
        "Proof MIR freeze could not resolve an exit closure transfer effect reference.",
      );
      return "error";
    }
    allowedTransfers.push(frozenTransfer);
  }

  return {
    kind: "scopeExit",
    checkedScopes,
    evaluateAfterEdgeEffects: true,
    allowedTransfers,
  };
}

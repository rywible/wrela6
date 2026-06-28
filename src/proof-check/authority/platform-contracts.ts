import {
  proofMirCallId,
  proofMirTerminatorId,
  type ProofMirCallId,
  type ProofMirTerminatorId,
} from "../../proof-mir/ids";
import type { PlatformContractId, PlatformPrimitiveId, TargetId } from "../../semantic/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckDiagnostic } from "../diagnostics";
import {
  normalizeProofCheckTerm,
  type MatchCaseKey,
  type PlatformEffectKindId,
  type ProofCheckFactTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import {
  authorityContentBytesEqual,
  canonicalPlatformContractContentBytes,
} from "./authority-term-canonicalization";
import type { ProofAuthorityFingerprint } from "./authority-types";
import {
  authorityCatalogDiagnostic,
  rejectDuplicateAuthorityKeys,
  rejectDuplicateLookupKeys,
  type ProofCheckAuthorityCatalogResult,
} from "./authority-catalog-helpers";
import {
  normalizeTargetSurfaceContractEffect,
  normalizeTargetSurfaceFactTerm,
  normalizeTargetSurfacePlaceRef,
  normalizeTargetSurfaceRequirementExpression,
  type TargetSurfaceFactExpression,
  type TargetSurfacePlaceRef,
  type TargetSurfaceProofPlaceholder,
  type TargetSurfaceRequirementExpression,
} from "./target-surface-normalization";

export type {
  TargetSurfaceFactExpression,
  TargetSurfaceOperandExpression,
  TargetSurfacePlaceRef,
  TargetSurfaceProofPlaceholder,
  TargetSurfaceRequirementExpression,
  TargetSurfaceValueRef,
} from "./target-surface-normalization";
export {
  normalizeTargetSurfaceFactTerm,
  normalizeTargetSurfaceProofTerm,
} from "./target-surface-normalization";

export interface ProofCheckCallableSignature {
  readonly hasReceiver: boolean;
  readonly parameterCount: number;
  readonly hasResult: boolean;
}

export type ProofCheckContractEffect =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofCheckPlaceBinder }
  | { readonly kind: "writesMemory"; readonly place: ProofCheckPlaceBinder }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofCheckPlaceBinder }
  | { readonly kind: "platformEffect"; readonly effectKind: PlatformEffectKindId }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export type ProofCheckContractEffectDraft =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: TargetSurfacePlaceRef }
  | { readonly kind: "writesMemory"; readonly place: TargetSurfacePlaceRef }
  | { readonly kind: "advancesPrivateState"; readonly place: TargetSurfacePlaceRef }
  | { readonly kind: "platformEffect"; readonly effectKind: PlatformEffectKindId }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export interface ProofCheckGuardedPostcondition {
  readonly when: readonly ProofCheckRequirementTerm[];
  readonly consequentTerms: readonly ProofCheckFactTerm[];
  readonly otherwisePreserves?: readonly ProofCheckFactTerm[];
  readonly authorityKey: string;
}

export interface ProofCheckGuardedPostconditionDraft {
  readonly when: readonly TargetSurfaceRequirementExpression[];
  readonly consequentTerms: readonly TargetSurfaceFactExpression[];
  readonly otherwisePreserves?: readonly TargetSurfaceFactExpression[];
  readonly authorityKey: string;
}

export interface ProofCheckPlatformContract {
  readonly targetId: TargetId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly signature: ProofCheckCallableSignature;
  readonly preconditions: readonly ProofCheckRequirementTerm[];
  readonly postconditions: readonly ProofCheckFactTerm[];
  readonly guardedPostconditions: readonly ProofCheckGuardedPostcondition[];
  readonly consumedCapabilities: readonly ProofCheckPlaceBinder[];
  readonly producedCapabilities: readonly ProofCheckPlaceBinder[];
  readonly effects: readonly ProofCheckContractEffect[];
  readonly authorityKey: string;
  readonly displayLabel?: string;
}

export interface ProofCheckPlatformContractCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  get(input: {
    readonly targetId: TargetId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: PlatformContractId;
  }): ProofCheckPlatformContract | undefined;
  entries(): readonly ProofCheckPlatformContract[];
}

export interface ProofCheckPlatformContractDraft {
  readonly targetId: TargetId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly signature: ProofCheckCallableSignature;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
  readonly preconditions: readonly TargetSurfaceRequirementExpression[];
  readonly postconditions: readonly TargetSurfaceFactExpression[];
  readonly guardedPostconditions?: readonly ProofCheckGuardedPostconditionDraft[];
  readonly consumedCapabilities?: readonly TargetSurfacePlaceRef[];
  readonly producedCapabilities?: readonly TargetSurfacePlaceRef[];
  readonly effects?: readonly ProofCheckContractEffectDraft[];
  readonly authorityKey: string;
  readonly displayLabel?: string;
}

export interface ProofCheckPlatformContractCatalogInput {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly entries: readonly ProofCheckPlatformContractDraft[];
}

function platformContractLookupKey(input: {
  readonly targetId: TargetId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
}): string {
  return `${input.targetId}:${input.primitiveId}:${input.contractId}`;
}

function normalizePlatformContractDraft(
  draft: ProofCheckPlatformContractDraft,
): ProofCheckPlatformContract | readonly ProofCheckDiagnostic[] {
  const context = {
    targetId: draft.targetId,
    authorityKey: draft.authorityKey,
    placeholders: draft.placeholders,
  };

  const preconditions: ProofCheckRequirementTerm[] = [];
  for (const precondition of draft.preconditions) {
    const normalized = normalizeTargetSurfaceRequirementExpression(
      context,
      precondition,
      "sourceRequirement",
    );
    if ("code" in normalized) {
      return [normalized];
    }
    preconditions.push(normalizeProofCheckTerm(normalized, "sourceRequirement").term);
  }

  const postconditions: ProofCheckFactTerm[] = [];
  for (const postcondition of draft.postconditions) {
    try {
      postconditions.push(
        normalizeTargetSurfaceFactTerm({
          targetId: draft.targetId,
          authorityKey: draft.authorityKey,
          placeholders: draft.placeholders,
          term: postcondition,
        }),
      );
    } catch (error) {
      return [
        authorityCatalogDiagnostic({
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          message:
            error instanceof Error
              ? error.message
              : `Invalid postcondition for authority ${draft.authorityKey}.`,
          ownerKey: "authorityCatalog",
          rootCauseKey: draft.authorityKey,
          stableDetail: `${draft.authorityKey}:postcondition`,
        }),
      ];
    }
  }

  const guardedPostconditions: ProofCheckGuardedPostcondition[] = [];
  for (const guarded of draft.guardedPostconditions ?? []) {
    const whenTerms: ProofCheckRequirementTerm[] = [];
    for (const whenTerm of guarded.when) {
      const normalized = normalizeTargetSurfaceRequirementExpression(
        context,
        whenTerm,
        "sourceRequirement",
      );
      if ("code" in normalized) {
        return [normalized];
      }
      whenTerms.push(normalizeProofCheckTerm(normalized, "sourceRequirement").term);
    }

    const thenTerms: ProofCheckFactTerm[] = [];
    for (const thenTerm of guarded.consequentTerms) {
      try {
        thenTerms.push(
          normalizeTargetSurfaceFactTerm({
            targetId: draft.targetId,
            authorityKey: guarded.authorityKey,
            placeholders: draft.placeholders,
            term: thenTerm,
          }),
        );
      } catch (error) {
        return [
          authorityCatalogDiagnostic({
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            message:
              error instanceof Error
                ? error.message
                : `Invalid guarded postcondition for authority ${guarded.authorityKey}.`,
            ownerKey: "authorityCatalog",
            rootCauseKey: guarded.authorityKey,
            stableDetail: `${guarded.authorityKey}:guarded-then`,
          }),
        ];
      }
    }

    let otherwisePreserves: ProofCheckFactTerm[] | undefined;
    if (guarded.otherwisePreserves !== undefined) {
      otherwisePreserves = [];
      for (const preservedTerm of guarded.otherwisePreserves) {
        try {
          otherwisePreserves.push(
            normalizeTargetSurfaceFactTerm({
              targetId: draft.targetId,
              authorityKey: guarded.authorityKey,
              placeholders: draft.placeholders,
              term: preservedTerm,
            }),
          );
        } catch (error) {
          return [
            authorityCatalogDiagnostic({
              code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
              message:
                error instanceof Error
                  ? error.message
                  : `Invalid guarded preservation for authority ${guarded.authorityKey}.`,
              ownerKey: "authorityCatalog",
              rootCauseKey: guarded.authorityKey,
              stableDetail: `${guarded.authorityKey}:guarded-preserve`,
            }),
          ];
        }
      }
    }

    guardedPostconditions.push({
      when: whenTerms,
      consequentTerms: thenTerms,
      ...(otherwisePreserves === undefined ? {} : { otherwisePreserves }),
      authorityKey: guarded.authorityKey,
    });
  }

  const consumedCapabilities: ProofCheckPlaceBinder[] = [];
  for (const capability of draft.consumedCapabilities ?? []) {
    const normalized = normalizeTargetSurfacePlaceRef(context, capability);
    if ("code" in normalized) {
      return [normalized];
    }
    consumedCapabilities.push(normalized);
  }

  const producedCapabilities: ProofCheckPlaceBinder[] = [];
  for (const capability of draft.producedCapabilities ?? []) {
    const normalized = normalizeTargetSurfacePlaceRef(context, capability);
    if ("code" in normalized) {
      return [normalized];
    }
    producedCapabilities.push(normalized);
  }

  const effects: ProofCheckContractEffect[] = [];
  for (const effect of draft.effects ?? []) {
    const normalized = normalizeTargetSurfaceContractEffect(context, effect);
    if ("code" in normalized) {
      return [normalized];
    }
    effects.push(normalized);
  }

  return {
    targetId: draft.targetId,
    primitiveId: draft.primitiveId,
    contractId: draft.contractId,
    signature: draft.signature,
    preconditions,
    postconditions,
    guardedPostconditions,
    consumedCapabilities,
    producedCapabilities,
    effects,
    authorityKey: draft.authorityKey,
    ...(draft.displayLabel === undefined ? {} : { displayLabel: draft.displayLabel }),
  };
}

export function proofCheckPlatformContractContentEqual(
  left: ProofCheckPlatformContract,
  right: ProofCheckPlatformContract,
): boolean {
  return authorityContentBytesEqual(
    canonicalPlatformContractContentBytes(left),
    canonicalPlatformContractContentBytes(right),
  );
}

export function proofCheckPlatformContractCatalog(
  input: ProofCheckPlatformContractCatalogInput,
): ProofCheckAuthorityCatalogResult<ProofCheckPlatformContractCatalog> {
  const duplicateDiagnostics = rejectDuplicateAuthorityKeys(
    input.entries.map((entry) => entry.authorityKey),
    "platformContracts",
  );
  if (duplicateDiagnostics.length > 0) {
    return { kind: "error", diagnostics: duplicateDiagnostics };
  }

  const normalizedEntries: ProofCheckPlatformContract[] = [];
  for (const draft of input.entries) {
    const normalized = normalizePlatformContractDraft(draft);
    if (Array.isArray(normalized)) {
      return { kind: "error", diagnostics: normalized };
    }
    normalizedEntries.push(normalized as ProofCheckPlatformContract);
  }

  const sortedEntries = [...normalizedEntries].sort((left, right) =>
    compareCodeUnitStrings(left.authorityKey, right.authorityKey),
  );
  const lookupKeyDuplicates = rejectDuplicateLookupKeys(
    sortedEntries.map((entry) =>
      platformContractLookupKey({
        targetId: entry.targetId,
        primitiveId: entry.primitiveId,
        contractId: entry.contractId,
      }),
    ),
    "platformContracts",
    "duplicate-lookup",
  );
  if (lookupKeyDuplicates.length > 0) {
    return { kind: "error", diagnostics: lookupKeyDuplicates };
  }

  const lookup = new Map<string, ProofCheckPlatformContract>();
  for (const entry of sortedEntries) {
    lookup.set(
      platformContractLookupKey({
        targetId: entry.targetId,
        primitiveId: entry.primitiveId,
        contractId: entry.contractId,
      }),
      entry,
    );
  }

  const catalog: ProofCheckPlatformContractCatalog = {
    fingerprint: input.fingerprint,
    get(inputLookup: {
      readonly targetId: TargetId;
      readonly primitiveId: PlatformPrimitiveId;
      readonly contractId: PlatformContractId;
    }): ProofCheckPlatformContract | undefined {
      return lookup.get(platformContractLookupKey(inputLookup));
    },
    entries(): readonly ProofCheckPlatformContract[] {
      return sortedEntries.slice();
    },
  };

  return { kind: "ok", catalog };
}

// Test-only terminal/call id helpers for authority catalog normalization.
export function proofCheckAuthorityTerminalCallIdForTest(value: number): ProofMirCallId {
  return proofMirCallId(value);
}

export function proofCheckAuthorityTerminatorIdForTest(value: number): ProofMirTerminatorId {
  return proofMirTerminatorId(value);
}

export type ProofCheckAuthorityMatchCaseKey = MatchCaseKey;

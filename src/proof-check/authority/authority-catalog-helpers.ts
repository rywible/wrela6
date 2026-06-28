import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import type { BrandedStableId } from "../model/fact-language";

export type TargetFeatureId = BrandedStableId<"targetFeature">;

export function targetFeatureId(value: string): TargetFeatureId {
  if (value.length === 0) {
    throw new RangeError("TargetFeatureId must be a non-empty string.");
  }
  return value as TargetFeatureId;
}

export type ProofCheckAuthorityCatalogResult<TCatalog> =
  | { readonly kind: "ok"; readonly catalog: TCatalog }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function authorityCatalogDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: input.code,
    messageTemplateId: "authority.catalog",
    messageArguments: [{ kind: "text", value: input.message }],
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  });
}

export function rejectDuplicateAuthorityKeys(
  authorityKeys: readonly string[],
  ownerKey: string,
): readonly ProofCheckDiagnostic[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const sortedKeys = [...authorityKeys].sort(compareCodeUnitStrings);

  for (const authorityKey of sortedKeys) {
    if (seen.has(authorityKey)) {
      if (!duplicates.includes(authorityKey)) {
        duplicates.push(authorityKey);
      }
      continue;
    }
    seen.add(authorityKey);
  }

  return duplicates.map((authorityKey) =>
    authorityCatalogDiagnostic({
      code: "PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY",
      message: `Duplicate authority catalog entry for key ${authorityKey}.`,
      ownerKey,
      rootCauseKey: authorityKey,
      stableDetail: `duplicate:${authorityKey}`,
    }),
  );
}

export function rejectDuplicateLookupKeys(
  lookupKeys: readonly string[],
  ownerKey: string,
  stableDetailPrefix: string,
): readonly ProofCheckDiagnostic[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const sortedKeys = [...lookupKeys].sort(compareCodeUnitStrings);

  for (const lookupKey of sortedKeys) {
    if (seen.has(lookupKey)) {
      if (!duplicates.includes(lookupKey)) {
        duplicates.push(lookupKey);
      }
      continue;
    }
    seen.add(lookupKey);
  }

  return duplicates.map((lookupKey) =>
    authorityCatalogDiagnostic({
      code: "PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY",
      message: `Duplicate authority catalog lookup key ${lookupKey}.`,
      ownerKey,
      rootCauseKey: lookupKey,
      stableDetail: `${stableDetailPrefix}:${lookupKey}`,
    }),
  );
}

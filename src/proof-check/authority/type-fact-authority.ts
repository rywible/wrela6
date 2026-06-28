import type { BrandId } from "../../hir/ids";
import type { MonoCheckedType, MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { TargetId } from "../../semantic/ids";
import { monoCheckedTypeFingerprint } from "../../mono/mono-checked-type-fingerprint";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  authorityContentBytesEqual,
  canonicalTypeFactCatalogEntryContentBytes,
} from "./authority-term-canonicalization";
import type { ProofAuthorityFingerprint } from "./authority-types";
import {
  rejectDuplicateAuthorityKeys,
  type ProofCheckAuthorityCatalogResult,
} from "./authority-catalog-helpers";
import {
  normalizeTargetSurfaceFactTerm,
  type TargetSurfaceFactExpression,
  type TargetSurfaceProofPlaceholder,
} from "./target-surface-normalization";
import {
  type BrandedStableId,
  type ProofCapabilityKindId,
  type ProofCheckFactTerm,
  type ProofCheckTypeFactInvalidation,
} from "../model/fact-language";

export type ProofCheckLiveValueScopeId = BrandedStableId<"proofLiveValueScope">;

export function proofCheckLiveValueScopeId(value: string): ProofCheckLiveValueScopeId {
  if (value.length === 0) {
    throw new RangeError("ProofCheckLiveValueScopeId must be a non-empty string.");
  }
  return value as ProofCheckLiveValueScopeId;
}

export interface ProofCheckTypeFactSchema {
  readonly term: ProofCheckFactTerm;
}

export interface ProofCheckTypeFactCatalogEntry {
  readonly concreteType: MonoCheckedType;
  readonly brand?: MonoInstantiatedProofId<BrandId>;
  readonly capabilityKind?: ProofCapabilityKindId;
  readonly liveValueScope: ProofCheckLiveValueScopeId;
  readonly facts: readonly ProofCheckTypeFactSchema[];
  readonly invalidatedBy: readonly ProofCheckTypeFactInvalidation[];
  readonly authorityKey: string;
  readonly displayLabel?: string;
}

export interface ProofCheckTypeFactLookup {
  readonly concreteType: MonoCheckedType;
  readonly brand?: MonoInstantiatedProofId<BrandId>;
  readonly capabilityKind?: ProofCapabilityKindId;
  readonly liveValueScope: ProofCheckLiveValueScopeId;
}

export interface ProofCheckTypeFactCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  get(input: ProofCheckTypeFactLookup): readonly ProofCheckTypeFactCatalogEntry[];
  entries(): readonly ProofCheckTypeFactCatalogEntry[];
}

export interface ProofCheckTypeFactCatalogEntryDraft {
  readonly concreteType: MonoCheckedType;
  readonly brand?: MonoInstantiatedProofId<BrandId>;
  readonly capabilityKind?: ProofCapabilityKindId;
  readonly liveValueScope: ProofCheckLiveValueScopeId;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
  readonly facts: readonly TargetSurfaceFactExpression[];
  readonly invalidatedBy: readonly ProofCheckTypeFactInvalidation[];
  readonly authorityKey: string;
  readonly displayLabel?: string;
}

export interface ProofCheckTypeFactCatalogInput {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly entries: readonly ProofCheckTypeFactCatalogEntryDraft[];
}

function brandLookupKey(brand: MonoInstantiatedProofId<BrandId> | undefined): string {
  if (brand === undefined) {
    return "";
  }
  return `${String(brand.hirId)}:${String(brand.instanceId)}:${brand.owner.kind}`;
}

function typeFactLookupKey(input: ProofCheckTypeFactLookup): string {
  return [
    monoCheckedTypeFingerprint(input.concreteType),
    brandLookupKey(input.brand),
    input.capabilityKind ?? "",
    input.liveValueScope,
  ].join(":");
}

function typeFactEntryLookupKey(entry: ProofCheckTypeFactCatalogEntry): string {
  return typeFactLookupKey({
    concreteType: entry.concreteType,
    brand: entry.brand,
    capabilityKind: entry.capabilityKind,
    liveValueScope: entry.liveValueScope,
  });
}

function normalizeTypeFactCatalogEntryDraft(
  draft: ProofCheckTypeFactCatalogEntryDraft,
  targetId: TargetId,
): ProofCheckTypeFactCatalogEntry {
  const facts = draft.facts.map((fact) => ({
    term: normalizeTargetSurfaceFactTerm({
      targetId,
      authorityKey: draft.authorityKey,
      placeholders: draft.placeholders,
      term: fact,
    }),
  }));

  return {
    concreteType: draft.concreteType,
    ...(draft.brand === undefined ? {} : { brand: draft.brand }),
    ...(draft.capabilityKind === undefined ? {} : { capabilityKind: draft.capabilityKind }),
    liveValueScope: draft.liveValueScope,
    facts,
    invalidatedBy: draft.invalidatedBy,
    authorityKey: draft.authorityKey,
    ...(draft.displayLabel === undefined ? {} : { displayLabel: draft.displayLabel }),
  };
}

export function proofCheckTypeFactLookupStableKey(input: ProofCheckTypeFactLookup): string {
  return typeFactLookupKey(input);
}

export function proofCheckTypeFactCatalogEntryContentEqual(
  left: ProofCheckTypeFactCatalogEntry,
  right: ProofCheckTypeFactCatalogEntry,
): boolean {
  return authorityContentBytesEqual(
    canonicalTypeFactCatalogEntryContentBytes(left),
    canonicalTypeFactCatalogEntryContentBytes(right),
  );
}

export function proofCheckTypeFactCatalog(
  input: ProofCheckTypeFactCatalogInput,
): ProofCheckAuthorityCatalogResult<ProofCheckTypeFactCatalog> {
  const duplicateDiagnostics = rejectDuplicateAuthorityKeys(
    input.entries.map((entry) => entry.authorityKey),
    "typeFacts",
  );
  if (duplicateDiagnostics.length > 0) {
    return { kind: "error", diagnostics: duplicateDiagnostics };
  }

  const normalizedEntries = input.entries.map((entry) =>
    normalizeTypeFactCatalogEntryDraft(entry, input.fingerprint.targetId),
  );
  const sortedEntries = [...normalizedEntries].sort((left, right) =>
    compareCodeUnitStrings(left.authorityKey, right.authorityKey),
  );
  const lookup = new Map<string, ProofCheckTypeFactCatalogEntry[]>();
  for (const entry of sortedEntries) {
    const key = typeFactEntryLookupKey(entry);
    const bucket = lookup.get(key);
    if (bucket === undefined) {
      lookup.set(key, [entry]);
      continue;
    }
    bucket.push(entry);
  }

  const catalog: ProofCheckTypeFactCatalog = {
    fingerprint: input.fingerprint,
    get(inputLookup: ProofCheckTypeFactLookup): readonly ProofCheckTypeFactCatalogEntry[] {
      return lookup.get(typeFactLookupKey(inputLookup)) ?? [];
    },
    entries(): readonly ProofCheckTypeFactCatalogEntry[] {
      return sortedEntries.slice();
    },
  };

  return { kind: "ok", catalog };
}

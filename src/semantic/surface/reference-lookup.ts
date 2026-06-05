import { compareCodeUnitStrings } from "./deterministic-sort";
import type { ModuleId } from "../ids";
import type { ResolvedReferenceEntry } from "../names/reference";
import type { ResolvedReferences } from "../names/resolution-result";

export interface ReferenceLookupInput {
  readonly moduleId: ModuleId;
  readonly span: { readonly start: number; readonly end: number };
  readonly kind: string;
}

export type ReferenceLookupResult =
  | { readonly kind: "found"; readonly entry: ResolvedReferenceEntry }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly entries: readonly ResolvedReferenceEntry[] };

export interface SurfaceReferenceLookup {
  findOne(input: ReferenceLookupInput): ReferenceLookupResult;
}

function surfaceReferenceBucketKey(input: {
  moduleId: ModuleId;
  span: { readonly start: number; readonly end: number };
  kind: string;
}): string {
  return `${input.moduleId}:${input.span.start}:${input.span.end}:${input.kind}`;
}

function compareResolvedReferenceEntries(
  left: ResolvedReferenceEntry,
  right: ResolvedReferenceEntry,
): number {
  const moduleCmp = (left.key.moduleId as number) - (right.key.moduleId as number);
  if (moduleCmp !== 0) return moduleCmp;
  if (left.key.span.start !== right.key.span.start)
    return left.key.span.start - right.key.span.start;
  if (left.key.span.end !== right.key.span.end) return left.key.span.end - right.key.span.end;
  const kindCmp = compareCodeUnitStrings(left.key.kind, right.key.kind);
  if (kindCmp !== 0) return kindCmp;
  return left.key.ordinal - right.key.ordinal;
}

export function syntaxReferenceKeyToString(key: {
  moduleId: ModuleId;
  span: { readonly start: number; readonly end: number };
  kind: string;
  ordinal: number;
}): string {
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

export function buildSurfaceReferenceLookup(
  references: ResolvedReferences,
): SurfaceReferenceLookup {
  const bySurfaceKey = new Map<string, ResolvedReferenceEntry[]>();
  for (const entry of references.entries()) {
    const key = surfaceReferenceBucketKey(entry.key);
    const entries = bySurfaceKey.get(key) ?? [];
    entries.push(entry);
    bySurfaceKey.set(key, entries);
  }

  for (const [key, entries] of bySurfaceKey) {
    bySurfaceKey.set(key, [...entries].sort(compareResolvedReferenceEntries));
  }

  return {
    findOne(input) {
      const entries = bySurfaceKey.get(surfaceReferenceBucketKey(input)) ?? [];
      if (entries.length === 0) return { kind: "missing" };
      if (entries.length > 1) return { kind: "ambiguous", entries };
      return { kind: "found", entry: entries[0]! };
    },
  };
}

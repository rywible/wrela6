import { compareCodeUnitStrings } from "../semantic/surface/deterministic-sort";
import type { TargetId } from "../semantic/ids";
import type {
  ProofMirRuntimeCatalog,
  ProofMirRuntimeOperation,
  ProofMirRuntimeOperationId,
  ProofMirRuntimeTargetAvailability,
} from "./runtime-catalog-types";

export {
  proofMirRuntimeOperationId,
  type ProofMirRuntimeAbiReference,
  type ProofMirRuntimeCatalog,
  type ProofMirRuntimeEffectSchema,
  type ProofMirRuntimeFactRole,
  type ProofMirRuntimeFactSchema,
  type ProofMirRuntimeLoweringOwner,
  type ProofMirRuntimeOperation,
  type ProofMirRuntimeOperationId,
  type ProofMirRuntimePlaceSchema,
  type ProofMirRuntimeTargetAvailability,
} from "./runtime-catalog-types";

export const RUNTIME_CATALOG_DIAGNOSTIC_CODES = [
  "RUNTIME_CATALOG_DUPLICATE_RUNTIME_ID",
  "RUNTIME_CATALOG_NOT_FOUND",
  "RUNTIME_CATALOG_TARGET_MISMATCH",
  "RUNTIME_CATALOG_FEATURES_MISMATCH",
] as const;

export type RuntimeCatalogDiagnosticCode = (typeof RUNTIME_CATALOG_DIAGNOSTIC_CODES)[number];

const RUNTIME_CATALOG_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(
  RUNTIME_CATALOG_DIAGNOSTIC_CODES,
);

export function runtimeCatalogDiagnosticCode(code: string): RuntimeCatalogDiagnosticCode {
  if (!RUNTIME_CATALOG_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown runtime catalog diagnostic code: ${code}.`);
  }
  return code as RuntimeCatalogDiagnosticCode;
}

export interface RuntimeCatalogDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: RuntimeCatalogDiagnosticCode;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export interface RuntimeCatalogDiagnosticInput {
  readonly severity: "error" | "warning" | "note";
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export function runtimeCatalogDiagnostic(
  input: RuntimeCatalogDiagnosticInput,
): RuntimeCatalogDiagnostic {
  return {
    severity: input.severity,
    code: runtimeCatalogDiagnosticCode(input.code),
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  };
}

export interface RuntimeCatalogInput {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly entries: readonly ProofMirRuntimeOperation[];
}

export type RuntimeCatalogResult =
  | { readonly kind: "ok"; readonly catalog: ProofMirRuntimeCatalog }
  | { readonly kind: "error"; readonly diagnostics: readonly RuntimeCatalogDiagnostic[] };

function runtimeOperationKey(runtimeId: ProofMirRuntimeOperationId): string {
  return String(runtimeId).padStart(12, "0");
}

function sortFeatures(features: readonly string[]): readonly string[] {
  return [...features].sort(compareCodeUnitStrings);
}

function featuresEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function runtimeCatalog(input: RuntimeCatalogInput): RuntimeCatalogResult {
  const sortedFeatures = sortFeatures(input.features);
  const sortedEntries = [...input.entries].sort((left, right) =>
    compareCodeUnitStrings(
      runtimeOperationKey(left.runtimeId),
      runtimeOperationKey(right.runtimeId),
    ),
  );
  const seenRuntimeIds = new Set<string>();

  for (const entry of sortedEntries) {
    const key = runtimeOperationKey(entry.runtimeId);
    if (seenRuntimeIds.has(key)) {
      return {
        kind: "error",
        diagnostics: [
          runtimeCatalogDiagnostic({
            severity: "error",
            code: "RUNTIME_CATALOG_DUPLICATE_RUNTIME_ID",
            message: `Duplicate runtime catalog entry for runtime ID ${String(entry.runtimeId)}.`,
            ownerKey: "runtimeCatalog",
            rootCauseKey: key,
            stableDetail: `duplicate:${key}`,
          }),
        ],
      };
    }
    seenRuntimeIds.add(key);
  }

  const lookup = new Map<string, ProofMirRuntimeOperation>();
  for (const entry of sortedEntries) {
    lookup.set(runtimeOperationKey(entry.runtimeId), entry);
  }

  const catalog: ProofMirRuntimeCatalog = {
    targetId: input.targetId,
    features: sortedFeatures,
    get(runtimeId: ProofMirRuntimeOperationId): ProofMirRuntimeOperation | undefined {
      return lookup.get(runtimeOperationKey(runtimeId));
    },
    entries(): readonly ProofMirRuntimeOperation[] {
      return sortedEntries.slice();
    },
  };

  return { kind: "ok", catalog };
}

export function runtimeOperationAvailableOnTarget(input: {
  readonly operation: ProofMirRuntimeOperation;
  readonly targetId: TargetId;
  readonly features: readonly string[];
}): boolean {
  return targetAvailabilityAllows(
    input.operation.targetAvailability,
    input.targetId,
    sortFeatures(input.features),
  );
}

function targetAvailabilityAllows(
  availability: ProofMirRuntimeTargetAvailability,
  targetId: TargetId,
  features: readonly string[],
): boolean {
  switch (availability.kind) {
    case "allTargets":
      return true;
    case "target":
      return availability.targetId === targetId;
    case "targetFeature":
      return availability.targetId === targetId && features.includes(availability.feature);
    default: {
      const unreachable: never = availability;
      return unreachable;
    }
  }
}

export function runtimeCatalogFeaturesEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return featuresEqual(sortFeatures(left), sortFeatures(right));
}

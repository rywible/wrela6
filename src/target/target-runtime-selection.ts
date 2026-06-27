import type { TargetId } from "../semantic/ids";
import type { ProofMirRuntimeCatalog } from "../runtime/runtime-catalog-types";
import {
  runtimeCatalogDiagnostic,
  runtimeCatalogFeaturesEqual,
  type RuntimeCatalogDiagnostic,
} from "../runtime/runtime-catalog";

export interface SelectProofMirRuntimeCatalogInput {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly catalogs: readonly ProofMirRuntimeCatalog[];
}

export type SelectProofMirRuntimeCatalogResult =
  | { readonly kind: "ok"; readonly catalog: ProofMirRuntimeCatalog }
  | { readonly kind: "error"; readonly diagnostics: readonly RuntimeCatalogDiagnostic[] };

export function selectProofMirRuntimeCatalog(
  input: SelectProofMirRuntimeCatalogInput,
): SelectProofMirRuntimeCatalogResult {
  const featureMismatchDiagnostics: RuntimeCatalogDiagnostic[] = [];

  for (const catalog of input.catalogs) {
    if (catalog.targetId !== input.targetId) {
      continue;
    }
    if (!runtimeCatalogFeaturesEqual(catalog.features, input.features)) {
      featureMismatchDiagnostics.push(
        runtimeCatalogDiagnostic({
          severity: "error",
          code: "RUNTIME_CATALOG_FEATURES_MISMATCH",
          message: "Selected runtime catalog features do not match the target context.",
          ownerKey: "runtimeCatalog",
          rootCauseKey: String(input.targetId),
          stableDetail: `features:${input.features.join(",")}`,
        }),
      );
      continue;
    }
    return { kind: "ok", catalog };
  }

  if (featureMismatchDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: featureMismatchDiagnostics,
    };
  }

  return {
    kind: "error",
    diagnostics: [
      runtimeCatalogDiagnostic({
        severity: "error",
        code: "RUNTIME_CATALOG_NOT_FOUND",
        message: `No runtime catalog found for target ${String(input.targetId)}.`,
        ownerKey: "runtimeCatalog",
        rootCauseKey: String(input.targetId),
        stableDetail: `missing:${String(input.targetId)}`,
      }),
    ],
  };
}

import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { ProofMirOriginId } from "../ids";
import type { ProofMirExtensionConstruct } from "../model/effects";

export interface RejectUnsupportedProofMirExtensionConstructInput {
  readonly construct: ProofMirExtensionConstruct;
  readonly targetFeatures: readonly string[];
  readonly monoMetadataAvailable?: boolean;
  readonly origin: ProofMirOriginId;
}

export type RejectUnsupportedProofMirExtensionConstructResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

function extensionGateError(
  diagnostics: readonly ProofMirDiagnostic[],
): RejectUnsupportedProofMirExtensionConstructResult {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function extensionGateDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly construct: ProofMirExtensionConstruct;
  readonly origin: ProofMirOriginId;
  readonly rootCauseKey: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: `extension:${input.construct}`,
    rootCauseKey: input.rootCauseKey,
    stableDetail: `origin:${String(input.origin)}`,
  });
}

function targetFeatureEnabled(targetFeatures: readonly string[], feature: string): boolean {
  return targetFeatures.includes(feature);
}

export function rejectUnsupportedProofMirExtensionConstruct(
  input: RejectUnsupportedProofMirExtensionConstructInput,
): RejectUnsupportedProofMirExtensionConstructResult {
  switch (input.construct) {
    case "coroutineYield":
      if (!targetFeatureEnabled(input.targetFeatures, "coroutineYield")) {
        return extensionGateError([
          extensionGateDiagnostic({
            code: "PROOF_MIR_MISSING_SEMANTICS_GATE",
            message: "Coroutine yield requires the coroutineYield target feature.",
            construct: input.construct,
            origin: input.origin,
            rootCauseKey: "coroutineYield",
          }),
        ]);
      }
      return { kind: "ok" };
    case "streamLoop":
      if (!targetFeatureEnabled(input.targetFeatures, "streamLoop")) {
        return extensionGateError([
          extensionGateDiagnostic({
            code: "PROOF_MIR_MISSING_SEMANTICS_GATE",
            message: "Stream for-loop requires the streamLoop target feature.",
            construct: input.construct,
            origin: input.origin,
            rootCauseKey: "streamLoop",
          }),
        ]);
      }
      return { kind: "ok" };
    case "crossCoreOwnership":
      if (input.monoMetadataAvailable !== true) {
        return extensionGateError([
          extensionGateDiagnostic({
            code: "PROOF_MIR_MISSING_CONCURRENCY_METADATA",
            message: "Cross-core construct requires mono concurrency metadata.",
            construct: input.construct,
            origin: input.origin,
            rootCauseKey: "crossCoreOwnership",
          }),
        ]);
      }
      return { kind: "ok" };
    default: {
      const unreachable: never = input.construct;
      return unreachable;
    }
  }
}

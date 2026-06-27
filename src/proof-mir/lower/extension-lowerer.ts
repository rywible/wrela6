import { proofMirOriginId, type ProofMirOriginId } from "../ids";
import { proofMirDiagnostic } from "../diagnostics";
import { rejectUnsupportedProofMirExtensionConstruct } from "../extensions/extension-gates";
import type {
  ProofMirExtensionLoweringInput,
  ProofMirExtensionLowerer,
  ProofMirLoweringResult,
} from "./lowering-context";

function unsupportedExtensionLoweringResult(
  input: ProofMirExtensionLoweringInput,
  origin: ProofMirOriginId,
): ProofMirLoweringResult<void> {
  return {
    kind: "error",
    diagnostics: [
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD",
        message: "Extension construct is not lowered by the core Proof MIR builder.",
        ownerKey: `extension:${input.construct}`,
        rootCauseKey: input.construct,
        stableDetail: `origin:${String(origin)}`,
        sourceOrigin: input.statement.sourceOrigin,
        functionInstanceId: input.context.functionInstanceId,
      }),
    ],
  };
}

export function createProofMirExtensionLowerer(): ProofMirExtensionLowerer {
  let nextOrigin = 1;

  return {
    lowerExtension(input: ProofMirExtensionLoweringInput): ProofMirLoweringResult<void> {
      const origin: ProofMirOriginId = proofMirOriginId(nextOrigin++);
      const gate = rejectUnsupportedProofMirExtensionConstruct({
        construct: input.construct,
        targetFeatures: input.context.target.features,
        origin,
      });
      if (gate.kind === "error") {
        return gate;
      }
      return unsupportedExtensionLoweringResult(input, origin);
    },
  };
}

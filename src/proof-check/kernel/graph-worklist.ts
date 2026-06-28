import { proofCheckDiagnostic, sortProofCheckDiagnostics } from "../diagnostics";
import { proofCheckResourceMismatchKeys } from "./graph-worklist-meet";
import { runProofCheckGraphWorklistBody } from "./graph-worklist-session";
import {
  createProofCheckFunctionRegistryArtifacts,
  finalizeProofCheckFunctionRegistryArtifacts,
} from "./registry/registry-effects";
import type {
  ProofCheckDiagnosticSuppressionHooks,
  ProofCheckGraphWorklistInput,
  ProofCheckGraphWorklistResult,
  ProofCheckJoinPolicyHooks,
  ProofCheckResourceLimitHooks,
} from "./graph-worklist-types";
import type { ProofCheckState } from "./state";

export type {
  ProofCheckDiagnosticSuppressionHooks,
  ProofCheckGraphWorklistInput,
  ProofCheckGraphWorklistResult,
  ProofCheckJoinPolicyHooks,
  ProofCheckResourceLimitHookResult,
  ProofCheckResourceLimitHooks,
  ProofCheckSuppressionCandidate,
} from "./graph-worklist-types";

export type { ProofCheckCoreMeetResult } from "./graph-worklist-meet";
export { computeProofCheckCoreMeet } from "./graph-worklist-meet";

export function resetProofCheckGraphWorklistTransitionIdsForTest(): void {
  // Transition ids are allocated per graph-worklist run.
}

export function defaultProofCheckResourceLimitHooks(): ProofCheckResourceLimitHooks {
  return {};
}

export function defaultProofCheckJoinPolicyHooks(): ProofCheckJoinPolicyHooks {
  return {};
}

export function defaultProofCheckDiagnosticSuppressionHooks(): ProofCheckDiagnosticSuppressionHooks {
  return {};
}

export function runProofCheckGraphWorklist(
  input: ProofCheckGraphWorklistInput,
): ProofCheckGraphWorklistResult {
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph === undefined) {
    return {
      kind: "error",
      acceptedBlockStates: [],
      summaries: [],
      packetEntries: [],
      explicitOrigins: [],
      diagnostics: sortProofCheckDiagnostics([
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          messageTemplateId: "proof-check.input-contract-invalid",
          messageArguments: [
            { kind: "text", value: `missing-function:${String(input.functionInstanceId)}` },
          ],
          message: `missing-function:${String(input.functionInstanceId)}`,
          ownerKey: `function:${String(input.functionInstanceId)}`,
          rootCauseKey: `function:${String(input.functionInstanceId)}`,
          stableDetail: `missing-function:${String(input.functionInstanceId)}`,
          functionInstanceId: input.functionInstanceId,
        }),
      ]),
      registryArtifacts: finalizeProofCheckFunctionRegistryArtifacts(
        createProofCheckFunctionRegistryArtifacts(),
      ),
      debug: { suppressionCandidates: [] },
    };
  }

  const resourceLimitHooks = input.resourceLimitHooks ?? defaultProofCheckResourceLimitHooks();
  const joinPolicyHooks = input.joinPolicyHooks ?? defaultProofCheckJoinPolicyHooks();
  const suppressionHooks =
    input.diagnosticSuppressionHooks ?? defaultProofCheckDiagnosticSuppressionHooks();

  return runProofCheckGraphWorklistBody({
    input,
    functionGraph,
    resourceLimitHooks,
    joinPolicyHooks,
    suppressionHooks,
  });
}

export function proofCheckStateComponentKeysForJoinFailure(
  left: ProofCheckState,
  right: ProofCheckState,
): readonly string[] {
  return proofCheckResourceMismatchKeys(left, right);
}

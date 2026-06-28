import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import type { CheckedBlockStateCertificate } from "../model/certificates";
import type { ProofCheckCertificateRegistry } from "./certificate-registry";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedOriginFact,
} from "../model/fact-packet";
import type { CheckedFunctionSummary } from "../model/function-summary";
import type { ProofCheckState } from "./state";
import {
  defaultProofCheckDiagnosticSuppressionHooks,
  defaultProofCheckJoinPolicyHooks,
  defaultProofCheckResourceLimitHooks,
  runProofCheckGraphWorklist,
  type ProofCheckDiagnosticSuppressionHooks,
  type ProofCheckGraphWorklistInput,
  type ProofCheckJoinPolicyHooks,
  type ProofCheckResourceLimitHooks,
  type ProofCheckSuppressionCandidate,
} from "./graph-worklist";
import type { ProofCheckOperationTransferRegistry } from "./operation-dispatch";
import type { ProofCheckRegistryAccumulator } from "./registry/registry-effects";
import {
  createProofCheckFunctionRegistryArtifacts,
  type ProofCheckFunctionRegistryArtifacts,
} from "./registry/registry-effects";

export type {
  ProofCheckDiagnosticSuppressionHooks,
  ProofCheckJoinPolicyHooks,
  ProofCheckResourceLimitHooks,
  ProofCheckSuppressionCandidate,
};

export interface ProofCheckFunctionKernelInput {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly registry: ProofCheckOperationTransferRegistry;
  readonly blockLabels?: ReadonlyMap<ProofMirBlockId, string>;
  readonly resourceLimitHooks?: ProofCheckResourceLimitHooks;
  readonly joinPolicyHooks?: ProofCheckJoinPolicyHooks;
  readonly diagnosticSuppressionHooks?: ProofCheckDiagnosticSuppressionHooks;
  readonly certificateRegistry?: ProofCheckCertificateRegistry;
  readonly coreCertificates?: ProofCheckCoreCertificate[];
  readonly registryAccumulator?: ProofCheckRegistryAccumulator;
}

export type ProofCheckFunctionKernelResult =
  | {
      readonly kind: "ok";
      readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
      readonly summaries: readonly CheckedFunctionSummary[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly explicitOrigins: readonly CheckedOriginFact[];
      readonly diagnostics: readonly ProofCheckDiagnostic[];
      readonly debug: {
        readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
      };
      readonly registryArtifacts: ProofCheckFunctionRegistryArtifacts;
    }
  | {
      readonly kind: "error";
      readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
      readonly summaries: readonly CheckedFunctionSummary[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly explicitOrigins: readonly CheckedOriginFact[];
      readonly diagnostics: readonly ProofCheckDiagnostic[];
      readonly debug: {
        readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
      };
      readonly registryArtifacts: ProofCheckFunctionRegistryArtifacts;
    };

export function runProofCheckFunctionKernel(
  input: ProofCheckFunctionKernelInput,
): ProofCheckFunctionKernelResult {
  const registryArtifacts = createProofCheckFunctionRegistryArtifacts();
  const worklistInput: ProofCheckGraphWorklistInput = {
    mir: input.mir,
    functionInstanceId: input.functionInstanceId,
    entryState: input.entryState,
    registry: input.registry,
    ...(input.blockLabels !== undefined ? { blockLabels: input.blockLabels } : {}),
    resourceLimitHooks: input.resourceLimitHooks ?? defaultProofCheckResourceLimitHooks(),
    joinPolicyHooks: input.joinPolicyHooks ?? defaultProofCheckJoinPolicyHooks(),
    diagnosticSuppressionHooks:
      input.diagnosticSuppressionHooks ?? defaultProofCheckDiagnosticSuppressionHooks(),
    ...(input.certificateRegistry !== undefined
      ? { certificateRegistry: input.certificateRegistry }
      : {}),
    ...(input.coreCertificates !== undefined ? { coreCertificates: input.coreCertificates } : {}),
    registryArtifacts,
    ...(input.registryAccumulator !== undefined
      ? { registryAccumulator: input.registryAccumulator }
      : {}),
  };

  const result = runProofCheckGraphWorklist(worklistInput);
  return {
    kind: result.kind,
    acceptedBlockStates: result.acceptedBlockStates,
    summaries: result.summaries,
    packetEntries: result.packetEntries,
    explicitOrigins: result.explicitOrigins,
    diagnostics: result.diagnostics,
    registryArtifacts: result.registryArtifacts,
    debug: result.debug,
  };
}

export {
  computeProofCheckCoreMeet,
  defaultProofCheckDiagnosticSuppressionHooks,
  defaultProofCheckJoinPolicyHooks,
  defaultProofCheckResourceLimitHooks,
  resetProofCheckGraphWorklistTransitionIdsForTest,
  runProofCheckGraphWorklist,
} from "./graph-worklist";

export {
  attachCounterexampleToDiagnostic,
  buildProofCounterexamplePath,
  proofCheckBlockKey,
  proofCheckPathFrameKey,
  type ProofCheckTransitionWitness,
} from "./counterexample-builder";

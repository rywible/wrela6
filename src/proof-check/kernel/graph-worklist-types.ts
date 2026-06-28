import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckTransitionId } from "../ids";
import type {
  CheckedBlockStateCertificate,
  ProofCheckCoreCertificate,
} from "../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedOriginFact,
} from "../model/fact-packet";
import type { CheckedFunctionSummary } from "../model/function-summary";
import type { ProofCheckCertificateRegistry } from "./certificate-registry";
import type { ProofCheckOperationTransferRegistry } from "./operation-dispatch";
import type {
  ProofCheckFunctionRegistryArtifacts,
  ProofCheckFunctionRegistryArtifactsMutable,
  ProofCheckRegistryAccumulator,
} from "./registry/registry-effects";
import type { ProofCheckResourceLimitHooks } from "./resource-limits";
import type { ProofCheckState } from "./state";

export type {
  ProofCheckResourceLimitHookResult,
  ProofCheckResourceLimitHooks,
} from "./resource-limits";

export interface ProofCheckSuppressionCandidate {
  readonly rootCauseKey: string;
  readonly suppressedRootCauseKey: string;
}

export interface ProofCheckJoinPolicyHooks {
  readonly resolveNonExactJoin?: (input: {
    readonly functionInstanceId: MonoInstanceId;
    readonly blockId: ProofMirBlockId;
    readonly incomingStates: readonly ProofCheckState[];
    readonly coreMeetState: ProofCheckState;
    readonly transitionId: ProofCheckTransitionId;
  }) =>
    | { readonly kind: "accept"; readonly state: ProofCheckState }
    | { readonly kind: "reject"; readonly diagnostics: readonly ProofCheckDiagnostic[] };
  readonly resolveLoopHeaderJoin?: (input: {
    readonly functionInstanceId: MonoInstanceId;
    readonly blockId: ProofMirBlockId;
    readonly incomingStates: readonly ProofCheckState[];
    readonly transitionId: ProofCheckTransitionId;
  }) =>
    | { readonly kind: "accept"; readonly state: ProofCheckState }
    | { readonly kind: "reject"; readonly diagnostics: readonly ProofCheckDiagnostic[] };
}

export interface ProofCheckDiagnosticSuppressionHooks {
  readonly filterPublicDiagnostics?: (input: {
    readonly diagnostics: readonly ProofCheckDiagnostic[];
    readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
  }) => readonly ProofCheckDiagnostic[];
}

export interface ProofCheckGraphWorklistInput {
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
  readonly registryArtifacts?: ProofCheckFunctionRegistryArtifactsMutable;
}

export interface ProofCheckGraphWorklistResult {
  readonly kind: "ok" | "error";
  readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
  readonly summaries: readonly CheckedFunctionSummary[];
  readonly packetEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly explicitOrigins: readonly CheckedOriginFact[];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly registryArtifacts: ProofCheckFunctionRegistryArtifacts;
  readonly debug: {
    readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
  };
}

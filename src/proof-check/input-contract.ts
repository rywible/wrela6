import type { LayoutFactProgram } from "../layout/layout-program";
import type { MonoInstanceId } from "../mono/ids";
import type { ProofMirProgram } from "../proof-mir/model/program";
import type { ProofMirOwnedCallId } from "../proof-mir/ids";
import type { ProofCheckPlatformContractCatalog } from "./authority/platform-contracts";
import type { ProofCheckRuntimeCatalog } from "./authority/runtime-authority";
import type { ProofSemanticsCompanion } from "./authority/semantics-companion";
import type { ProofCheckTypeFactCatalog } from "./authority/type-fact-authority";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "./diagnostics";

export const PROOF_CHECK_RESOURCE_LIMIT_KEYS = [
  "maximumReachableFunctions",
  "maximumBlocksPerFunction",
  "maximumEdgesPerFunction",
  "maximumAcceptedStateVariantsPerBlock",
  "maximumActiveFactsPerState",
  "maximumActiveLoansPerState",
  "maximumOpenObligationsPerState",
  "maximumOpenValidationsPerState",
  "maximumOpenAttemptsPerState",
  "maximumLiveCapabilitiesPerState",
  "maximumCounterexampleFrames",
  "maximumStagedPacketEntriesPerFunction",
] as const;

export type ProofCheckResourceLimitKey = (typeof PROOF_CHECK_RESOURCE_LIMIT_KEYS)[number];

export interface ProofCheckResourceLimits {
  readonly maximumReachableFunctions: number;
  readonly maximumBlocksPerFunction: number;
  readonly maximumEdgesPerFunction: number;
  readonly maximumAcceptedStateVariantsPerBlock: number;
  readonly maximumActiveFactsPerState: number;
  readonly maximumActiveLoansPerState: number;
  readonly maximumOpenObligationsPerState: number;
  readonly maximumOpenValidationsPerState: number;
  readonly maximumOpenAttemptsPerState: number;
  readonly maximumLiveCapabilitiesPerState: number;
  readonly maximumCounterexampleFrames: number;
  readonly maximumStagedPacketEntriesPerFunction: number;
}

export interface CheckProofAndResourcesInput {
  readonly mir: ProofMirProgram;
  readonly layout: LayoutFactProgram;
  readonly limits: ProofCheckResourceLimits;
  readonly platformContracts: ProofCheckPlatformContractCatalog;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly semantics: ProofSemanticsCompanion;
}

export interface ProofCheckSourceCallEdge {
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly calleeFunctionInstanceId: MonoInstanceId;
  readonly callId: ProofMirOwnedCallId;
}

export interface ProofCheckSourceCallGraph {
  readonly edges: readonly ProofCheckSourceCallEdge[];
  readonly successors: ReadonlyMap<string, readonly MonoInstanceId[]>;
}

export interface ValidateProofCheckInputResult {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly reachableFunctionOrder: readonly MonoInstanceId[];
  readonly sourceCallGraph: ProofCheckSourceCallGraph;
  readonly deadFunctionIds: readonly MonoInstanceId[];
}

export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateProofCheckResourceLimits(
  limits: ProofCheckResourceLimits | undefined,
): ProofCheckDiagnostic[] {
  if (limits === undefined) {
    return [
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.input-contract.invalid-limit",
        messageArguments: [{ kind: "text", value: "limits" }],
        message: "Proof-check input limits must be provided.",
        ownerKey: "proof-check:input-contract",
        rootCauseKey: "proof-check:resource-limits",
        stableDetail: "invalid-limit:limits:undefined",
      }),
    ];
  }

  const diagnostics: ProofCheckDiagnostic[] = [];
  for (const limitKey of PROOF_CHECK_RESOURCE_LIMIT_KEYS) {
    const limitValue = limits[limitKey];
    if (isPositiveSafeInteger(limitValue)) {
      continue;
    }
    diagnostics.push(
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.input-contract.invalid-limit",
        messageArguments: [{ kind: "text", value: limitKey }],
        message: `Proof-check input limit ${limitKey} must be a positive safe integer.`,
        ownerKey: "proof-check:input-contract",
        rootCauseKey: "proof-check:resource-limits",
        stableDetail: `invalid-limit:${limitKey}:${String(limitValue)}`,
      }),
    );
  }
  return diagnostics;
}

export function proofCheckInputContractNotWiredDiagnostic(): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.input-contract.not-wired",
    messageArguments: [{ kind: "text", value: "proof-check kernel orchestration" }],
    message:
      "Proof checking is not wired yet; the public facade fails closed until orchestration lands.",
    ownerKey: "proof-check:input-contract",
    rootCauseKey: "proof-check:kernel-not-wired",
    stableDetail: "proof-check:kernel-not-wired",
  });
}

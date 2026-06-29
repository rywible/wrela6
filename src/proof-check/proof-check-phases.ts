import type { MonoInstanceId } from "../mono/ids";
import type { ProofMirPlaceId } from "../proof-mir/ids";
import {
  buildCheckedFunctionSummary,
  type BuildCheckedFunctionSummaryInput,
} from "./domains/source-calls";
import type { CheckProofAndResourcesInput, ValidateProofCheckInputResult } from "./input-contract";
import { buildCheckedFunctionSummaryInputFromMir } from "./domains/summary-input";
import { createProofCheckCertificateRegistry } from "./kernel/certificate-registry";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "./diagnostics";
import {
  runProofCheckFunctionKernel,
  type ProofCheckFunctionKernelResult,
} from "./kernel/checker-kernel";
import { proofCheckDiagnosticSuppressionHooks } from "./kernel/diagnostic-suppression";
import {
  buildProofCheckOperationTransferRegistry,
  createProofCheckPlaceResolver,
  type ProofCheckRegistryContext,
} from "./kernel/operation-registry-wiring";
import { buildPlaceKeyToMirPlaceIdIndex } from "./domains/mir-place-bindings";
import {
  createProofCheckRegistryAccumulator,
  mergeProofCheckFunctionRegistryArtifactsIntoAccumulator,
  type ProofCheckFunctionRegistryArtifacts,
} from "./kernel/registry/registry-effects";
import {
  enforceProofCheckResourceLimits,
  proofCheckResourceLimitHooks,
} from "./kernel/resource-limits";
import { createProofCheckState, type ProofCheckState } from "./kernel/state";
import {
  runProofCheckWholeImageDriver,
  type ProofCheckWholeImageFunctionCheckInput,
  type ProofCheckWholeImageFunctionCheckResult,
} from "./kernel/whole-image-driver";
import { proofCheckLoopJoinPolicyHooks } from "./domains/loops";
import type { CheckedMirFunction, CheckedMirProgram } from "./model/checked-mir";
import type {
  CheckedFunctionSummaryCertificateId,
  CheckedTerminalGraphCertificate,
  ProofCheckCertificateId,
} from "./model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacket,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedOriginFact,
} from "./model/fact-packet";
import { buildCheckedFactPacket } from "./validation/fact-packet-builder";
import {
  collectUniqueOrigins,
  ensureOriginEntryCoreCertificates,
} from "./validation/origin-packet-entry";
import { validateCheckedFactPacketInputForProofCheck } from "./validation/packet-validation-context";
import {
  validateCheckedFactPacket,
  checkedFactSubjectKey,
  type ProofCheckCertificate,
  type ProofSemanticsCertificateRecord,
} from "./validation/packet-validator";
import { checkedOptIrHandoffFingerprint, type CheckedOptIrHandoff } from "./model/opt-ir-handoff";

export interface ProofCheckReachableFunctionChecksResult {
  readonly kind: "ok";
  readonly driverResult: ReturnType<typeof runProofCheckWholeImageDriver>;
  readonly checkedFunctions: ReadonlyMap<MonoInstanceId, CheckedMirFunction>;
  readonly kernelPacketEntries: readonly CheckedFactPacketEntry<
    CheckedFactKindId,
    CheckedFactSubject
  >[];
  readonly kernelExplicitOrigins: readonly CheckedOriginFact[];
  readonly registryAccumulator: ReturnType<typeof createProofCheckRegistryAccumulator>;
  readonly certificateRegistry: ReturnType<typeof createProofCheckCertificateRegistry>;
  readonly semanticsCertificates: readonly ProofSemanticsCertificateRecord[];
}

export type AssembleCheckedFactPacketResult =
  | {
      readonly kind: "ok";
      readonly packet: CheckedFactPacket;
      readonly packetDiagnostics: readonly ProofCheckDiagnostic[];
      readonly allCertificates: readonly ProofCheckCertificate[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function buildSummaryInput(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly registryArtifacts: ProofCheckFunctionRegistryArtifacts;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly exitStates: readonly ProofCheckState[];
}): BuildCheckedFunctionSummaryInput {
  return buildCheckedFunctionSummaryInputFromMir({
    mir: input.checkInput.mir,
    functionInstanceId: input.functionInstanceId,
    entryState: input.entryState,
    exitStates: input.exitStates,
    registryArtifacts: input.registryArtifacts,
  });
}

function buildCheckedFunctionRecord(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly kernelResult: ProofCheckFunctionKernelResult;
  readonly summaryCertificate: CheckedFunctionSummaryCertificateId;
  readonly entryStateCertificate: ProofCheckCertificateId;
  readonly exitCertificates: readonly ProofCheckCertificateId[];
}): CheckedMirFunction {
  return {
    functionInstanceId: input.functionInstanceId,
    entryStateCertificate: input.entryStateCertificate,
    exitCertificates: input.exitCertificates,
    summaryCertificate: input.summaryCertificate,
    acceptedBlockStates: input.kernelResult.acceptedBlockStates,
  };
}

function checkedFactPacketEntryContentKey(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
): string {
  const base = `${String(entry.kind)}:${checkedFactSubjectKey(entry.subject)}`;
  if (String(entry.kind) !== "platformEffect") {
    return base;
  }
  const invalidation = entry.invalidatedBy.find((candidate) => candidate.kind === "platformEffect");
  if (invalidation?.kind !== "platformEffect") {
    return base;
  }
  return `${base}:${String(invalidation.effectKind)}`;
}

function mergePacketEntries(
  entryGroups: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[][],
):
  | {
      readonly kind: "ok";
      readonly entries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const merged = new Map<string, CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>>();
  for (const entries of entryGroups) {
    for (const entry of entries) {
      const contentKey = checkedFactPacketEntryContentKey(entry);
      const existing = merged.get(contentKey);
      if (existing === undefined) {
        merged.set(contentKey, entry);
        continue;
      }
      if (String(existing.factId) !== String(entry.factId)) {
        return {
          kind: "error",
          stableDetail: `duplicate-packet-fact:${contentKey}:${String(existing.factId)}:${String(entry.factId)}`,
        };
      }
    }
  }
  return { kind: "ok", entries: [...merged.values()] };
}

export function runReachableFunctionChecks(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly validatedInput: ValidateProofCheckInputResult;
}):
  | ProofCheckReachableFunctionChecksResult
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const registryAccumulator = createProofCheckRegistryAccumulator();
  const semanticsCertificates: ProofSemanticsCertificateRecord[] = [];
  const kernelPacketEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];
  const kernelExplicitOrigins: CheckedOriginFact[] = [];
  const checkedFunctions = new Map<MonoInstanceId, CheckedMirFunction>();
  const certificateRegistry = createProofCheckCertificateRegistry();

  if (
    input.validatedInput.reachableFunctionOrder.length >
    input.checkInput.limits.maximumReachableFunctions
  ) {
    const firstFunctionInstanceId = input.validatedInput.reachableFunctionOrder[0];
    if (firstFunctionInstanceId !== undefined) {
      const limitResult = enforceProofCheckResourceLimits({
        limits: input.checkInput.limits,
        location: { kind: "functionEntry", functionInstanceId: firstFunctionInstanceId },
        state: createProofCheckState({}),
        metrics: { reachableFunctionCount: input.validatedInput.reachableFunctionOrder.length },
      });
      if (limitResult.kind === "error") {
        return {
          kind: "error",
          diagnostics: sortProofCheckDiagnostics(limitResult.diagnostics),
        };
      }
    }
  }

  const joinPolicyHooks = proofCheckLoopJoinPolicyHooks({
    companion: input.checkInput.semantics,
    mir: input.checkInput.mir,
  });
  const diagnosticSuppressionHooks = proofCheckDiagnosticSuppressionHooks();

  const checkFunction = (
    checkInput: ProofCheckWholeImageFunctionCheckInput,
  ): ProofCheckWholeImageFunctionCheckResult => {
    const resourceLimitHooks = proofCheckResourceLimitHooks(input.checkInput.limits);
    for (const [functionInstanceId, summary] of checkInput.summaries.entries()) {
      registryAccumulator.summaries.set(functionInstanceId, summary);
    }

    const callerGraph = checkInput.mir.functions.get(checkInput.functionInstanceId);
    const functionCoreCertificates = [...registryAccumulator.coreCertificates];
    const functionRegistryContext: ProofCheckRegistryContext = {
      input: input.checkInput,
      validatedInput: input.validatedInput,
      certificateRegistry,
      summaries: registryAccumulator.summaries,
      coreCertificates: functionCoreCertificates,
      placeResolver: {
        index:
          callerGraph === undefined
            ? new Map<string, ProofMirPlaceId>()
            : new Map(
                buildPlaceKeyToMirPlaceIdIndex({
                  functionGraph: callerGraph,
                  functionInstanceId: checkInput.functionInstanceId,
                }),
              ),
      },
    };
    const functionRegistry = buildProofCheckOperationTransferRegistry({
      context: functionRegistryContext,
    });

    const kernelResult = runProofCheckFunctionKernel({
      mir: checkInput.mir,
      functionInstanceId: checkInput.functionInstanceId,
      entryState: checkInput.entryState,
      registry: functionRegistry,
      resourceLimitHooks,
      joinPolicyHooks,
      diagnosticSuppressionHooks,
      certificateRegistry,
      coreCertificates: functionCoreCertificates,
    });

    mergeProofCheckFunctionRegistryArtifactsIntoAccumulator({
      accumulator: registryAccumulator,
      functionInstanceId: checkInput.functionInstanceId,
      artifacts: kernelResult.registryArtifacts,
    });

    const registryArtifacts = kernelResult.registryArtifacts;
    const summaryInput = buildSummaryInput({
      checkInput: input.checkInput,
      registryArtifacts,
      functionInstanceId: checkInput.functionInstanceId,
      entryState: checkInput.entryState,
      exitStates: registryArtifacts.exitStates,
    });
    const summaryResult = buildCheckedFunctionSummary(summaryInput);

    const entryStateCertificate = registryArtifacts.entryStateCertificate;
    if (entryStateCertificate === undefined) {
      return {
        kernelResult,
        summaryResult: {
          kind: "error",
          diagnostics: [
            proofCheckDiagnostic({
              severity: "error",
              code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
              messageTemplateId: "proof-check.missing-entry-state-certificate",
              messageArguments: [
                {
                  kind: "text",
                  value: `missing-entry-state-certificate:${String(checkInput.functionInstanceId)}`,
                },
              ],
              message: "Function entry state certificate is missing after kernel checking.",
              ownerKey: `function:${String(checkInput.functionInstanceId)}`,
              rootCauseKey: "proof-check:entry-state",
              stableDetail: `missing-entry-state-certificate:${String(checkInput.functionInstanceId)}`,
              functionInstanceId: checkInput.functionInstanceId,
            }),
          ],
        },
      };
    }

    if (summaryResult.kind === "ok") {
      registryAccumulator.summaries.set(checkInput.functionInstanceId, summaryResult.summary);
      checkedFunctions.set(
        checkInput.functionInstanceId,
        buildCheckedFunctionRecord({
          functionInstanceId: checkInput.functionInstanceId,
          kernelResult,
          summaryCertificate: summaryResult.summary.certificateId,
          entryStateCertificate,
          exitCertificates: registryArtifacts.exitCertificates,
        }),
      );
    }

    kernelPacketEntries.push(...kernelResult.packetEntries);
    kernelExplicitOrigins.push(...kernelResult.explicitOrigins);

    return { kernelResult, summaryResult };
  };

  const driverResult = runProofCheckWholeImageDriver({
    mir: input.checkInput.mir,
    validatedInput: input.validatedInput,
    registry: buildProofCheckOperationTransferRegistry({
      context: {
        input: input.checkInput,
        validatedInput: input.validatedInput,
        certificateRegistry,
        summaries: registryAccumulator.summaries,
        coreCertificates: registryAccumulator.coreCertificates,
        placeResolver: createProofCheckPlaceResolver(),
      },
    }),
    buildSummaryInput: (checkInput) =>
      buildSummaryInput({
        checkInput: input.checkInput,
        registryArtifacts: checkInput.kernelResult.registryArtifacts,
        functionInstanceId: checkInput.functionInstanceId,
        entryState: checkInput.entryState,
        exitStates: checkInput.kernelResult.registryArtifacts.exitStates,
      }),
    checkFunction,
  });

  return {
    kind: "ok",
    driverResult,
    checkedFunctions,
    kernelPacketEntries,
    kernelExplicitOrigins,
    registryAccumulator,
    certificateRegistry,
    semanticsCertificates,
  };
}

export function assembleCheckedFactPacket(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly checkedFunctions: ReadonlyMap<MonoInstanceId, CheckedMirFunction>;
  readonly kernelPacketEntries: readonly CheckedFactPacketEntry<
    CheckedFactKindId,
    CheckedFactSubject
  >[];
  readonly kernelExplicitOrigins: readonly CheckedOriginFact[];
  readonly terminalPacketEntries: readonly CheckedFactPacketEntry<
    CheckedFactKindId,
    CheckedFactSubject
  >[];
  readonly registryAccumulator: ReturnType<typeof createProofCheckRegistryAccumulator>;
  readonly certificateRegistry: ReturnType<typeof createProofCheckCertificateRegistry>;
  readonly semanticsCertificates: readonly ProofSemanticsCertificateRecord[];
}): AssembleCheckedFactPacketResult {
  const mergedPacketEntries = mergePacketEntries([
    [...input.terminalPacketEntries],
    [...input.kernelPacketEntries],
  ]);
  if (mergedPacketEntries.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INVALID_FACT_PACKET",
          messageTemplateId: "proof-check.invalid-fact-packet",
          messageArguments: [{ kind: "text", value: mergedPacketEntries.stableDetail }],
          message: mergedPacketEntries.stableDetail,
          ownerKey: "proof-check:packet-builder",
          rootCauseKey: "proof-check:packet-builder",
          stableDetail: mergedPacketEntries.stableDetail,
        }),
      ]),
    };
  }

  const packetOrigins = collectUniqueOrigins({
    stagedEntries: mergedPacketEntries.entries,
    explicitOrigins: input.kernelExplicitOrigins,
  });
  ensureOriginEntryCoreCertificates({
    origins: [...packetOrigins.values()],
    coreCertificates: input.registryAccumulator.coreCertificates,
    allocateCoreCertificateId: input.certificateRegistry.allocateCoreCertificateId,
  });

  const allCertificates: ProofCheckCertificate[] = [
    ...input.registryAccumulator.coreCertificates,
    ...input.semanticsCertificates,
  ];

  const packetBuildResult = buildCheckedFactPacket({
    acceptedFunctions: [...input.checkedFunctions.values()],
    stagedEntries: mergedPacketEntries.entries,
    explicitOrigins: input.kernelExplicitOrigins,
    certificates: allCertificates,
  });
  if (packetBuildResult.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INVALID_FACT_PACKET",
          messageTemplateId: "proof-check.invalid-fact-packet",
          messageArguments: [{ kind: "text", value: packetBuildResult.stableDetail }],
          message: packetBuildResult.stableDetail,
          ownerKey: "proof-check:packet-builder",
          rootCauseKey: "proof-check:packet-builder",
          stableDetail: packetBuildResult.stableDetail,
        }),
      ]),
    };
  }

  const packetDiagnostics = validateCheckedFactPacket(
    validateCheckedFactPacketInputForProofCheck({
      checkInput: input.checkInput,
      packet: packetBuildResult.packet,
      certificates: allCertificates,
    }),
  );
  const packetErrors = packetDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (packetErrors.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(packetErrors),
    };
  }

  return {
    kind: "ok",
    packet: packetBuildResult.packet,
    packetDiagnostics,
    allCertificates,
  };
}

export function buildCheckedMirProgram(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly checkedFunctions: ReadonlyMap<MonoInstanceId, CheckedMirFunction>;
  readonly summaries: CheckedMirProgram["summaries"];
  readonly packet: CheckedFactPacket;
  readonly terminalGraph: CheckedTerminalGraphCertificate;
}): CheckedMirProgram {
  return {
    mir: input.checkInput.mir,
    checkedFunctions: input.checkedFunctions,
    summaries: input.summaries,
    facts: input.packet,
    terminalGraph: input.terminalGraph,
    originMap: new Map(input.packet.origins.map((entry) => [entry.origin.originKey, entry.origin])),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => stableJson(left[0]).localeCompare(stableJson(right[0])));
  }

  if (value instanceof Set) {
    return [...value]
      .map(toStableValue)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  }

  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }

  return value;
}

export function buildCheckedOptIrHandoff(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly checked: CheckedMirProgram;
  readonly certificates: readonly ProofCheckCertificate[];
}): CheckedOptIrHandoff {
  const acceptedFunctionInstanceIds = [...input.checked.checkedFunctions.keys()].sort();
  const summaryCertificateIds = [...input.checked.checkedFunctions.values()]
    .map((checkedFunction) => checkedFunction.summaryCertificate)
    .sort((left, right) => left - right);
  const semanticInlinePolicies = [...input.checked.checkedFunctions.entries()]
    .map(([functionInstanceId, checkedFunction]) => ({
      functionInstanceId,
      kind: "mandatory" as const,
      reason: "checked-summary",
      source: "checkedSummary" as const,
      summaryCertificateId: checkedFunction.summaryCertificate,
    }))
    .sort((left, right) => {
      const functionOrder = String(left.functionInstanceId).localeCompare(
        String(right.functionInstanceId),
      );
      if (functionOrder !== 0) {
        return functionOrder;
      }
      return left.summaryCertificateId - right.summaryCertificateId;
    });
  const originMapStableKey = stableJson(input.checked.originMap);
  const checkedFactPacketStableKey = stableJson(input.checked.facts);
  const withoutFingerprint = {
    checkedMir: input.checked,
    certificates: input.certificates,
    packetValidation: {
      checkedFactPacketStableKey,
      acceptedFunctionInstanceIds,
      summaryCertificateIds,
      terminalGraphCertificateId: input.checked.terminalGraph.certificateId,
      originMapStableKey,
      authorityFingerprints: [
        input.checkInput.platformContracts.fingerprint,
        input.checkInput.runtimeCatalog.fingerprint,
        input.checkInput.typeFacts.fingerprint,
        input.checkInput.semantics.fingerprint,
      ],
    },
    pathCertificates: [],
    semanticInlinePolicies,
  } satisfies Omit<CheckedOptIrHandoff, "handoffFingerprint">;

  return {
    ...withoutFingerprint,
    handoffFingerprint: checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

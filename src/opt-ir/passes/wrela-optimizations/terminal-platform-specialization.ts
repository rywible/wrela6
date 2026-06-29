import type { OptIrOperationId } from "../../ids";
import type { OptIrOperation } from "../../operations";

export interface WrelaTerminalCleanupCandidate {
  readonly operationId: OptIrOperationId;
  readonly observable: boolean;
  readonly platformOrRuntimeCleanup: boolean;
  readonly factChain: readonly string[];
}

export interface WrelaPlatformSpecializationCandidate {
  readonly operationId: OptIrOperationId;
  readonly constantArgumentFactIds: readonly string[];
  readonly abiFactIds: readonly string[];
  readonly targetCatalogEquivalent: boolean;
  readonly specializedTargetKey: string;
}

export interface WrelaTerminalPlatformInput {
  readonly operations: readonly OptIrOperation[];
  readonly terminalCleanupCandidates?: readonly WrelaTerminalCleanupCandidate[];
  readonly platformSpecializationCandidates?: readonly WrelaPlatformSpecializationCandidate[];
}

export interface WrelaTerminalPlatformResult {
  readonly operations: readonly OptIrOperation[];
  readonly prunedCleanupOperationIds: readonly OptIrOperationId[];
  readonly specializedPlatformCalls: readonly {
    readonly operationId: OptIrOperationId;
    readonly specializedTargetKey: string;
  }[];
  readonly rejectedCleanups: readonly {
    readonly operationId: OptIrOperationId;
    readonly reason: "observableCleanupCall";
  }[];
  readonly rejectedSpecializations: readonly {
    readonly operationId: OptIrOperationId;
    readonly reason: "missingConstantFact" | "missingAbiFact" | "missingTargetCatalogEquivalence";
  }[];
  readonly explanations: readonly {
    readonly kind: "terminalCleanupPruned" | "platformCallSpecialized";
    readonly operationId: OptIrOperationId;
    readonly factChain: readonly string[];
  }[];
}

export function runWrelaTerminalPlatformSpecializationForTest(
  input: WrelaTerminalPlatformInput,
): WrelaTerminalPlatformResult {
  return runWrelaTerminalPlatformSpecialization(input);
}

export function runWrelaTerminalPlatformSpecialization(
  input: WrelaTerminalPlatformInput,
): WrelaTerminalPlatformResult {
  const pruned = new Set<OptIrOperationId>();
  const rejectedCleanups: WrelaTerminalPlatformResult["rejectedCleanups"][number][] = [];
  const rejectedSpecializations: WrelaTerminalPlatformResult["rejectedSpecializations"][number][] =
    [];
  const specializedPlatformCalls: WrelaTerminalPlatformResult["specializedPlatformCalls"][number][] =
    [];
  const explanations: WrelaTerminalPlatformResult["explanations"][number][] = [];

  for (const candidate of input.terminalCleanupCandidates ?? []) {
    if (candidate.observable || candidate.platformOrRuntimeCleanup) {
      rejectedCleanups.push({
        operationId: candidate.operationId,
        reason: "observableCleanupCall",
      });
      continue;
    }
    pruned.add(candidate.operationId);
    explanations.push({
      kind: "terminalCleanupPruned",
      operationId: candidate.operationId,
      factChain: candidate.factChain,
    });
  }

  for (const candidate of input.platformSpecializationCandidates ?? []) {
    const rejection = specializationRejection(candidate);
    if (rejection !== undefined) {
      rejectedSpecializations.push({ operationId: candidate.operationId, reason: rejection });
      continue;
    }
    specializedPlatformCalls.push({
      operationId: candidate.operationId,
      specializedTargetKey: candidate.specializedTargetKey,
    });
    explanations.push({
      kind: "platformCallSpecialized",
      operationId: candidate.operationId,
      factChain: [
        ...candidate.constantArgumentFactIds,
        ...candidate.abiFactIds,
        "target-catalog-equivalence",
      ],
    });
  }

  return {
    operations: input.operations.filter((operation) => !pruned.has(operation.operationId)),
    prunedCleanupOperationIds: [...pruned].sort((left, right) => Number(left) - Number(right)),
    specializedPlatformCalls,
    rejectedCleanups,
    rejectedSpecializations,
    explanations,
  };
}

function specializationRejection(
  candidate: WrelaPlatformSpecializationCandidate,
): WrelaTerminalPlatformResult["rejectedSpecializations"][number]["reason"] | undefined {
  if (candidate.constantArgumentFactIds.length === 0) {
    return "missingConstantFact";
  }
  if (candidate.abiFactIds.length === 0) {
    return "missingAbiFact";
  }
  if (!candidate.targetCatalogEquivalent) {
    return "missingTargetCatalogEquivalence";
  }
  return undefined;
}

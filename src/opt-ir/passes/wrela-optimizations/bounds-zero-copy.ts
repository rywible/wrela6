import type { OptIrFactId, OptIrOperationId } from "../../ids";
import type { OptIrBoundsAuthority, OptIrOperation } from "../../operations";
import type { RewriteLegalityObligationId } from "../pass-contract";

export interface WrelaBoundsEliminationCandidate {
  readonly checkOperationId: OptIrOperationId;
  readonly affectedAccessOperationIds: readonly OptIrOperationId[];
  readonly licensingFactId?: OptIrFactId;
  readonly obligationId?: RewriteLegalityObligationId;
  readonly factChain: readonly string[];
}

export interface WrelaBoundsZeroCopyInput {
  readonly operations: readonly OptIrOperation[];
  readonly candidates: readonly WrelaBoundsEliminationCandidate[];
  readonly zeroCopyAccessOperationIds?: readonly OptIrOperationId[];
}

export interface WrelaBoundsZeroCopyResult {
  readonly operations: readonly OptIrOperation[];
  readonly eliminatedCheckIds: readonly OptIrOperationId[];
  readonly zeroCopyAccessOperationIds: readonly OptIrOperationId[];
  readonly rejectedCandidates: readonly {
    readonly checkOperationId: OptIrOperationId;
    readonly reason: "missingLicensingFact" | "missingRewriteObligation" | "missingAffectedAccess";
  }[];
  readonly explanations: readonly {
    readonly kind: "boundsCheckEliminated" | "zeroCopyAccess";
    readonly operationId: OptIrOperationId;
    readonly factChain: readonly string[];
  }[];
}

export function runWrelaBoundsZeroCopyForTest(
  input: WrelaBoundsZeroCopyInput,
): WrelaBoundsZeroCopyResult {
  return runWrelaBoundsZeroCopy(input);
}

export function runWrelaBoundsZeroCopy(input: WrelaBoundsZeroCopyInput): WrelaBoundsZeroCopyResult {
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const eliminated = new Set<OptIrOperationId>();
  const authorityByAccess = new Map<OptIrOperationId, OptIrBoundsAuthority>();
  const rejectedCandidates: WrelaBoundsZeroCopyResult["rejectedCandidates"][number][] = [];
  const explanations: WrelaBoundsZeroCopyResult["explanations"][number][] = [];

  for (const candidate of input.candidates) {
    if (candidate.licensingFactId === undefined) {
      rejectedCandidates.push({
        checkOperationId: candidate.checkOperationId,
        reason: "missingLicensingFact",
      });
      continue;
    }
    if (candidate.obligationId === undefined) {
      rejectedCandidates.push({
        checkOperationId: candidate.checkOperationId,
        reason: "missingRewriteObligation",
      });
      continue;
    }
    if (
      candidate.affectedAccessOperationIds.some((operationId) => !operationById.has(operationId))
    ) {
      rejectedCandidates.push({
        checkOperationId: candidate.checkOperationId,
        reason: "missingAffectedAccess",
      });
      continue;
    }

    eliminated.add(candidate.checkOperationId);
    for (const operationId of candidate.affectedAccessOperationIds) {
      authorityByAccess.set(operationId, {
        kind: "passDerivedFact",
        factId: candidate.licensingFactId,
        obligationId: candidate.obligationId,
      });
    }
    explanations.push({
      kind: "boundsCheckEliminated",
      operationId: candidate.checkOperationId,
      factChain: candidate.factChain,
    });
  }

  const zeroCopy = new Set(input.zeroCopyAccessOperationIds ?? []);
  for (const operationId of zeroCopy) {
    explanations.push({ kind: "zeroCopyAccess", operationId, factChain: ["zero-copy-access"] });
  }

  return {
    operations: input.operations
      .filter((operation) => !eliminated.has(operation.operationId))
      .map((operation) =>
        rewriteAccessAuthority(operation, authorityByAccess.get(operation.operationId)),
      ),
    eliminatedCheckIds: [...eliminated].sort((left, right) => Number(left) - Number(right)),
    zeroCopyAccessOperationIds: [...zeroCopy].sort((left, right) => Number(left) - Number(right)),
    rejectedCandidates,
    explanations,
  };
}

function rewriteAccessAuthority(
  operation: OptIrOperation,
  authority: OptIrBoundsAuthority | undefined,
): OptIrOperation {
  if (authority === undefined || !("memoryAccess" in operation)) {
    return operation;
  }
  return {
    ...operation,
    memoryAccess: { ...operation.memoryAccess, boundsAuthority: authority },
  } as OptIrOperation;
}

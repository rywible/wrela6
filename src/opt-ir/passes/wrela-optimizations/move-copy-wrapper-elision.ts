import type { OptIrOperationId, OptIrValueId } from "../../ids";
import type { OptIrOperation } from "../../operations";
import type { RewriteInvariant } from "../pass-contract";

export type WrelaFactChain = readonly string[];

export interface WrelaMoveCopyWrapperCandidate {
  readonly operationId: OptIrOperationId;
  readonly sourceValue: OptIrValueId;
  readonly resultValue: OptIrValueId;
  readonly kind: "move" | "copy" | "wrapper";
  readonly ownershipFactIds: readonly string[];
  readonly noaliasFactIds: readonly string[];
  readonly erasureFactIds: readonly string[];
  readonly hasObservableCleanup: boolean;
}

export interface WrelaMoveCopyWrapperElisionInput {
  readonly operations: readonly OptIrOperation[];
  readonly candidates: readonly WrelaMoveCopyWrapperCandidate[];
}

export interface WrelaMoveCopyWrapperExplanation {
  readonly kind: "copyEliminated" | "wrapperEliminated";
  readonly operationId: OptIrOperationId;
  readonly sourceValue: OptIrValueId;
  readonly resultValue: OptIrValueId;
  readonly factChain: WrelaFactChain;
  readonly invariant: RewriteInvariant;
}

export interface WrelaMoveCopyWrapperElisionResult {
  readonly operations: readonly OptIrOperation[];
  readonly valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[];
  readonly eliminatedOperationIds: readonly OptIrOperationId[];
  readonly rejectedCandidates: readonly {
    readonly operationId: OptIrOperationId;
    readonly reason:
      | "missingOwnershipFact"
      | "missingNoaliasFact"
      | "missingErasureFact"
      | "observableCleanup";
  }[];
  readonly explanations: readonly WrelaMoveCopyWrapperExplanation[];
}

export function runWrelaMoveCopyWrapperElisionForTest(
  input: WrelaMoveCopyWrapperElisionInput,
): WrelaMoveCopyWrapperElisionResult {
  return runWrelaMoveCopyWrapperElision(input);
}

export function runWrelaMoveCopyWrapperElision(
  input: WrelaMoveCopyWrapperElisionInput,
): WrelaMoveCopyWrapperElisionResult {
  const eliminated = new Set<OptIrOperationId>();
  const valueForwards: WrelaMoveCopyWrapperElisionResult["valueForwards"][number][] = [];
  const rejectedCandidates: WrelaMoveCopyWrapperElisionResult["rejectedCandidates"][number][] = [];
  const explanations: WrelaMoveCopyWrapperExplanation[] = [];

  for (const candidate of input.candidates) {
    const rejection = rejectionReason(candidate);
    if (rejection !== undefined) {
      rejectedCandidates.push({ operationId: candidate.operationId, reason: rejection });
      continue;
    }

    eliminated.add(candidate.operationId);
    valueForwards.push({
      sourceValue: candidate.resultValue,
      replacementValue: candidate.sourceValue,
    });
    explanations.push({
      kind: candidate.kind === "wrapper" ? "wrapperEliminated" : "copyEliminated",
      operationId: candidate.operationId,
      sourceValue: candidate.sourceValue,
      resultValue: candidate.resultValue,
      factChain: [
        ...candidate.ownershipFactIds,
        ...candidate.noaliasFactIds,
        ...candidate.erasureFactIds,
      ],
      invariant:
        candidate.kind === "wrapper"
          ? { kind: "abiWrapperEquivalence" }
          : { kind: "ownershipRuntimeIdentity" },
    });
  }

  return {
    operations: input.operations.filter((operation) => !eliminated.has(operation.operationId)),
    valueForwards: valueForwards.sort(
      (left, right) => Number(left.sourceValue) - Number(right.sourceValue),
    ),
    eliminatedOperationIds: [...eliminated].sort((left, right) => Number(left) - Number(right)),
    rejectedCandidates,
    explanations,
  };
}

function rejectionReason(
  candidate: WrelaMoveCopyWrapperCandidate,
): WrelaMoveCopyWrapperElisionResult["rejectedCandidates"][number]["reason"] | undefined {
  if (candidate.ownershipFactIds.length === 0) {
    return "missingOwnershipFact";
  }
  if (candidate.noaliasFactIds.length === 0) {
    return "missingNoaliasFact";
  }
  if (candidate.erasureFactIds.length === 0) {
    return "missingErasureFact";
  }
  if (candidate.hasObservableCleanup) {
    return "observableCleanup";
  }
  return undefined;
}

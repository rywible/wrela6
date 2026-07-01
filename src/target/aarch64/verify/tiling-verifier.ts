import type { AArch64SelectionCandidate } from "../select/pattern-tiler";
import { aarch64SelectionPatternById } from "../select/pattern-catalog";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64TilingVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "tiling",
  verify(context) {
    if (context.selectionCandidates === undefined) {
      return [];
    }
    return verifyAArch64Tiling({
      candidates: context.selectionCandidates,
      requiredCoverage: context.requiredSelectionCoverage ?? [],
      context,
    });
  },
};

export function verifyAArch64Tiling(input: {
  readonly candidates: readonly AArch64SelectionCandidate[];
  readonly requiredCoverage?: readonly number[];
  readonly context: AArch64MachineVerifierContext;
}) {
  const covered = new Set<number>();
  const diagnostics = [];
  const targetProfileFeatures = new Set(input.context.targetProfileFeatures ?? ["BASE_A64"]);
  for (const candidate of input.candidates) {
    const manifest = aarch64SelectionPatternById(candidate.patternId);
    if (manifest !== undefined) {
      if (candidate.tier !== manifest.tier) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_TILING_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: candidate.patternId,
            stableDetail: `selection-candidate:tier-mismatch:${candidate.tier}:${manifest.tier}`,
          }),
        );
      }
      if (manifest.requiredFacts.length > 0 && (candidate.factsUsed ?? []).length === 0) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_TILING_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: candidate.patternId,
            stableDetail: `selection-candidate:missing-required-facts:${manifest.requiredFacts.join(",")}`,
          }),
        );
      }
      for (const feature of manifest.requiredProfileFeatures) {
        if (!targetProfileFeatures.has(feature)) {
          diagnostics.push(
            input.context.makeDiagnostic({
              code: "AARCH64_TILING_INVALID",
              ownerKey: candidate.patternId,
              rootCauseKey: feature,
              stableDetail: `selection-candidate:missing-profile-feature:${feature}`,
            }),
          );
        }
      }
    }
    if (candidate.covers.length === 0) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_TILING_INVALID",
          ownerKey: candidate.patternId,
          rootCauseKey: candidate.patternId,
          stableDetail: "selection-candidate:empty-coverage",
        }),
      );
    }
    const candidateCoverage = new Set<number>();
    for (const operationId of candidate.covers) {
      if (candidateCoverage.has(operationId)) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_TILING_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `duplicated-consumed-operation:${operationId}`,
          }),
        );
      }
      candidateCoverage.add(operationId);
      if (covered.has(operationId)) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_TILING_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `overlapping-consumed-operation:${operationId}`,
          }),
        );
      }
      covered.add(operationId);
    }
    if (
      candidate.tier !== "semantic" &&
      manifest !== undefined &&
      candidate.emittedOpcodes !== undefined &&
      candidate.emittedOpcodes.length === 0
    ) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_TILING_INVALID",
          ownerKey: candidate.patternId,
          rootCauseKey: candidate.patternId,
          stableDetail: "selection-candidate:missing-emitted-opcodes",
        }),
      );
    }
  }
  for (const operationId of input.requiredCoverage ?? []) {
    if (!covered.has(operationId)) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_TILING_INVALID",
          ownerKey: `operation:${operationId}`,
          rootCauseKey: "selection-coverage",
          stableDetail: `uncovered-operation:${operationId}`,
        }),
      );
    }
  }
  return diagnostics;
}

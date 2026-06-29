import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrFactSet } from "../facts/fact-index";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import type { OptIrTargetSurface } from "../target-surface";
import type { OptIrDecisionLog } from "../policy/decision-log";
import type { OptIrOptimizationPolicy } from "../policy/optimization-profile";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";

export interface OptimizedOptIrProvenanceSnapshot {
  readonly originIds: readonly OptIrProgram["provenance"]["originIds"][number][];
  readonly fingerprint: ProofAuthorityFingerprint;
}

export type OptimizedOptIrProgram = Omit<OptIrProgram, "provenance"> & {
  readonly provenance: OptimizedOptIrProvenanceSnapshot;
  readonly operations?: readonly OptIrOperation[];
  readonly optimizationRegions?: readonly OptIrRegion[];
};

export type OptIrVerifierCheckpointKind =
  | "after-construction"
  | "after-mandatory-inlining"
  | "after-scope-expansion-mutation"
  | "after-scope-expansion-cluster"
  | "after-scalar-simplification-cluster"
  | "after-memory-region-cluster"
  | "after-wrela-cluster"
  | "after-fact-gated-egraph"
  | "after-vectorization-cluster"
  | "after-final-cleanup"
  | "before-target-lowering";

export interface OptIrVerifierCheckpoint {
  readonly kind: OptIrVerifierCheckpointKind;
  readonly passId?: string;
}

export interface OptimizeOptIrInput {
  readonly program: OptIrProgram & {
    readonly operations?: readonly OptIrOperation[];
    readonly optimizationRegions?: readonly OptIrRegion[];
  };
  readonly facts: OptIrFactSet;
  readonly target: OptIrTargetSurface;
  readonly policy: OptIrOptimizationPolicy;
}

export type OptimizeOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: OptimizedOptIrProgram;
      readonly operations: readonly OptIrOperation[];
      readonly facts: OptIrFactSet;
      readonly provenance: OptimizedOptIrProvenanceSnapshot;
      readonly decisionLog: OptIrDecisionLog;
      readonly diagnostics: readonly OptIrDiagnostic[];
      readonly verificationCheckpoints: readonly OptIrVerifierCheckpoint[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface PipelineState {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
  readonly diagnostics: readonly OptIrDiagnostic[];
  readonly decisionLog: OptIrDecisionLog | undefined;
  readonly verificationCheckpoints: readonly OptIrVerifierCheckpoint[];
}

export type PipelineStepResult =
  | PipelineState
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export function isPipelineError(
  result: PipelineStepResult,
): result is { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  return "kind" in result && result.kind === "error";
}

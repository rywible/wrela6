import { validateOptIrConstructionBoundary } from "./boundary-validation";
import { type InternalConstructOptIrInput } from "./internal-construction-api";
import type { ConstructOptIrResult } from "./construction-results";
import { runOptIrConstructionPipeline } from "./lower/construction-pipeline";
import {
  optimizeOptIr,
  type OptimizeOptIrInput,
  type OptimizeOptIrResult,
} from "./passes/pipeline";
import type { OptIrOptimizationPolicy } from "./policy/optimization-profile";

export type {
  ConstructedOptIrProvenanceSnapshot,
  ConstructedOptIrProgram,
  ConstructOptIrResult,
} from "./construction-results";
export type { OptIrProofErasureProvenance } from "./lower/proof-erasure";

export type ConstructOptIrInput = InternalConstructOptIrInput;

export interface BuildOptimizedOptIrInput extends ConstructOptIrInput {
  readonly policy: OptIrOptimizationPolicy;
}

export interface BuildOptimizedOptIrDependencies {
  readonly optimizer?: (input: OptimizeOptIrInput) => OptimizeOptIrResult;
}

export function constructOptIr(input: ConstructOptIrInput): ConstructOptIrResult {
  const boundary = validateOptIrConstructionBoundary(input);
  if (boundary.kind === "error") {
    return { kind: "error", diagnostics: boundary.diagnostics };
  }
  return runOptIrConstructionPipeline(input);
}

export function buildOptimizedOptIr(
  input: BuildOptimizedOptIrInput,
  dependencies: BuildOptimizedOptIrDependencies = {},
): OptimizeOptIrResult {
  const construction = constructOptIr(input);
  if (construction.kind === "error") {
    return construction;
  }

  const optimizer = dependencies.optimizer ?? optimizeOptIr;
  const optimization = optimizer({
    program: construction.program,
    operations: construction.operations,
    optimizationRegions: construction.optimizationRegions,
    facts: construction.facts,
    target: input.target,
    policy: input.policy,
  });
  if (optimization.kind === "error") {
    return {
      kind: "error",
      diagnostics: [...construction.diagnostics, ...optimization.diagnostics],
    };
  }
  return {
    ...optimization,
    diagnostics: [...construction.diagnostics, ...optimization.diagnostics],
  };
}

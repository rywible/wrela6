import type { OptimizationPassId } from "../ids";

export interface OptIrOptimizationPolicy {
  readonly profileName: string;
  readonly pipeline: readonly OptimizationPassId[];
  readonly enableMandatoryInlining: boolean;
  readonly enableWholeProgramSpecialization: boolean;
  readonly enableFactGatedRewrites: boolean;
  readonly enableVectorization: boolean;
}

export function defaultOptIrOptimizationPolicy(): OptIrOptimizationPolicy {
  return {
    profileName: "task-11-empty",
    pipeline: [],
    enableMandatoryInlining: true,
    enableWholeProgramSpecialization: false,
    enableFactGatedRewrites: false,
    enableVectorization: false,
  };
}

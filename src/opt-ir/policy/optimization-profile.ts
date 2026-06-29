import type { OptimizationPassId } from "../ids";
import { OPT_IR_PRODUCTION_PASS_SCHEDULE } from "./pass-order-policy";

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

export function productionOptIrOptimizationPolicy(): OptIrOptimizationPolicy {
  return {
    profileName: "production-v1",
    pipeline: OPT_IR_PRODUCTION_PASS_SCHEDULE.map((entry) => entry.passId),
    enableMandatoryInlining: true,
    enableWholeProgramSpecialization: true,
    enableFactGatedRewrites: true,
    enableVectorization: true,
  };
}

export function productionOptimizationPolicyForTest(): OptIrOptimizationPolicy {
  return productionOptIrOptimizationPolicy();
}

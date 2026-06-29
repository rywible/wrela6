import {
  OPT_IR_PRODUCTION_PASS_SCHEDULE,
  type OptIrProductionPassScheduleEntry,
} from "../policy/pass-order-policy";
import type {
  OptIrAnalysisId,
  OptIrFormOrFactPostcondition,
  OptIrFormOrFactPrecondition,
} from "../passes/pass-contract";
import type { OptimizationPassId } from "../ids";

export type OptIrPassScheduleConsistencyIssueCode =
  | "PRECONDITION_PRODUCER_NOT_SCHEDULED"
  | "STALE_ANALYSIS_CONSUMED"
  | "FIXPOINT_PASS_NOT_IDEMPOTENT"
  | "FIXPOINT_PASS_UNBOUNDED";

export type OptIrPassScheduleConsistencyIssue =
  | {
      readonly code: "PRECONDITION_PRODUCER_NOT_SCHEDULED";
      readonly passId: OptimizationPassId;
      readonly order: number;
      readonly precondition: OptIrFormOrFactPrecondition;
    }
  | {
      readonly code: "STALE_ANALYSIS_CONSUMED";
      readonly passId: OptimizationPassId;
      readonly order: number;
      readonly analysis: OptIrAnalysisId;
      readonly invalidatedByPassId: OptimizationPassId;
      readonly invalidatedByOrder: number;
    }
  | {
      readonly code: "FIXPOINT_PASS_NOT_IDEMPOTENT";
      readonly passId: OptimizationPassId;
      readonly order: number;
      readonly fixpointId: string;
    }
  | {
      readonly code: "FIXPOINT_PASS_UNBOUNDED";
      readonly passId: OptimizationPassId;
      readonly order: number;
      readonly fixpointId: string;
    };

export type OptIrPassScheduleConsistencyResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly issues: readonly OptIrPassScheduleConsistencyIssue[] };

export interface OptIrPassScheduleConsistencyOptions {
  readonly initialAvailable?: readonly (OptIrFormOrFactPrecondition | OptIrAnalysisId)[];
  readonly recomputeAnalysesBeforePass?: (
    entry: OptIrProductionPassScheduleEntry,
  ) => readonly OptIrAnalysisId[];
}

const productionInitialAvailable = Object.freeze([
  "canonical-opt-ir",
  "fact-index",
  "path-certificates",
]);

const productionRecomputableAnalysisIds: ReadonlySet<OptIrAnalysisId> = new Set([
  "alias",
  "call-graph",
  "dominance",
  "effects",
  "escape-analysis",
  "fact-index",
  "liveness",
  "loop-tree",
  "memory-ssa",
  "path-certificates",
  "scc",
  "sccp",
  "value-numbering",
]);

export function validateProductionOptIrPassSchedule(): OptIrPassScheduleConsistencyResult {
  return validateOptIrPassSchedule(OPT_IR_PRODUCTION_PASS_SCHEDULE, {
    initialAvailable: productionInitialAvailable,
    recomputeAnalysesBeforePass: (entry) =>
      entry.contract.scheduling.requires.filter(isProductionRecomputableAnalysis),
  });
}

export function validateOptIrPassSchedule(
  schedule: readonly OptIrProductionPassScheduleEntry[],
  options: OptIrPassScheduleConsistencyOptions = {},
): OptIrPassScheduleConsistencyResult {
  const issues: OptIrPassScheduleConsistencyIssue[] = [];
  const available = new Set<OptIrFormOrFactPostcondition | OptIrAnalysisId>(
    options.initialAvailable ?? ["canonical-opt-ir"],
  );
  const staleAnalyses = new Map<
    OptIrAnalysisId,
    { readonly passId: OptimizationPassId; readonly order: number }
  >();

  for (const [order, entry] of schedule.entries()) {
    const scheduling = entry.contract.scheduling;
    const recomputedAnalyses = options.recomputeAnalysesBeforePass?.(entry) ?? [];
    for (const analysis of recomputedAnalyses) {
      available.add(analysis);
      staleAnalyses.delete(analysis);
    }

    for (const precondition of scheduling.requires) {
      if (!available.has(precondition)) {
        issues.push({
          code: "PRECONDITION_PRODUCER_NOT_SCHEDULED",
          passId: entry.contract.passId,
          order,
          precondition,
        });
        continue;
      }

      const staleProducer = staleAnalyses.get(precondition);
      if (staleProducer !== undefined) {
        issues.push({
          code: "STALE_ANALYSIS_CONSUMED",
          passId: entry.contract.passId,
          order,
          analysis: precondition,
          invalidatedByPassId: staleProducer.passId,
          invalidatedByOrder: staleProducer.order,
        });
      }
    }

    if (entry.fixpoint !== undefined) {
      const fixpointId = String(entry.fixpoint.fixpointId);
      if (!scheduling.idempotent) {
        issues.push({
          code: "FIXPOINT_PASS_NOT_IDEMPOTENT",
          passId: entry.contract.passId,
          order,
          fixpointId,
        });
      }
      if (scheduling.fuel.kind === "none") {
        issues.push({
          code: "FIXPOINT_PASS_UNBOUNDED",
          passId: entry.contract.passId,
          order,
          fixpointId,
        });
      }
    }

    for (const invalidatedAnalysis of scheduling.invalidatesAnalyses) {
      staleAnalyses.set(invalidatedAnalysis, {
        passId: entry.contract.passId,
        order,
      });
    }
    for (const produced of scheduling.produces) {
      available.add(produced);
      staleAnalyses.delete(produced);
    }
  }

  return issues.length === 0 ? { kind: "ok" } : { kind: "error", issues };
}

function isProductionRecomputableAnalysis(
  precondition: OptIrFormOrFactPrecondition,
): precondition is OptIrAnalysisId {
  return productionRecomputableAnalysisIds.has(precondition);
}

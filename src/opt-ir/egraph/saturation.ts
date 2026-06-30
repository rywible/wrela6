import type { OptIrEGraph } from "./egraph";
import type { OptIrFactGateEvaluationContext } from "./fact-gated-rule";
import { evaluateOptIrFactGate } from "./fact-gated-rule";
import type { OptIrRuleCatalog } from "./rule-catalog";
import type { OptIrOperation } from "../operations";
import { compareOptIrEGraphCost, optIrEGraphCostForOperations } from "./egraph-cost";

export type OptIrEGraphSaturationCap = "iterations" | "eNodes" | "eClasses" | "ruleApplications";

export interface OptIrEGraphSaturationLimits {
  readonly maxIterations: number;
  readonly maxENodes: number;
  readonly maxEClasses: number;
  readonly maxRuleApplications: number;
}

export interface OptIrAppliedEGraphRule {
  readonly ruleId: string;
  readonly iteration: number;
  readonly uncertaintyPenalty: number;
}

export interface OptIrEGraphGateApplicationCount {
  readonly graph: OptIrEGraph;
  readonly iterations: number;
  readonly eNodeCount: number;
  readonly eClassCount: number;
  readonly appliedRules: readonly OptIrAppliedEGraphRule[];
  readonly appliedRuleIds: readonly string[];
  readonly hitCaps: readonly OptIrEGraphSaturationCap[];
  readonly uncertaintyPenalty: number;
}

export function countOptIrEGraphGateApplications(input: {
  readonly graph: OptIrEGraph;
  readonly catalog: OptIrRuleCatalog;
  readonly factContext: OptIrFactGateEvaluationContext;
  readonly limits: OptIrEGraphSaturationLimits;
}): OptIrEGraphGateApplicationCount {
  assertPositiveLimits(input.limits);

  const appliedRules: OptIrAppliedEGraphRule[] = [];
  const hitCaps = new Set<OptIrEGraphSaturationCap>();
  let eNodeCount = input.graph.importOrder.length;
  const eClassCount = input.graph.classes.length;
  let iterations = 0;
  let uncertaintyPenalty = 0;

  for (let iteration = 0; iteration < input.limits.maxIterations; iteration += 1) {
    iterations = iteration + 1;
    let appliedInIteration = false;

    for (const rule of input.catalog.rules) {
      const cap = nextSaturationCap({
        appliedRuleCount: appliedRules.length,
        eNodeCount,
        eClassCount,
        limits: input.limits,
      });
      if (cap !== undefined) {
        hitCaps.add(cap);
        break;
      }

      const gate = evaluateOptIrFactGate(rule.factGate, input.factContext);
      if (gate.kind !== "passed") {
        continue;
      }

      uncertaintyPenalty += gate.uncertaintyPenalty;
      appliedRules.push(
        Object.freeze({
          ruleId: String(rule.ruleId),
          iteration,
          uncertaintyPenalty: gate.uncertaintyPenalty,
        }),
      );
      eNodeCount += 1;
      appliedInIteration = true;

      if (appliedRules.length >= input.limits.maxRuleApplications) {
        hitCaps.add("ruleApplications");
        break;
      }
    }

    if (hitCaps.size > 0 || !appliedInIteration) {
      break;
    }
  }

  if (iterations >= input.limits.maxIterations) {
    hitCaps.add("iterations");
  }

  return Object.freeze({
    graph: input.graph,
    iterations,
    eNodeCount,
    eClassCount,
    appliedRules: Object.freeze(appliedRules),
    appliedRuleIds: Object.freeze(appliedRules.map((entry) => entry.ruleId)),
    hitCaps: Object.freeze([...hitCaps].sort()),
    uncertaintyPenalty,
  });
}

export function saturatedOperationsImproveRegion(
  originalRegionOperations: readonly OptIrOperation[],
  rewrittenRegionOperations: readonly OptIrOperation[],
): boolean {
  return (
    compareOptIrEGraphCost(
      optIrEGraphCostForOperations(rewrittenRegionOperations),
      optIrEGraphCostForOperations(originalRegionOperations),
    ) < 0
  );
}

export function saturationCountsForOperations(operations: readonly OptIrOperation[]): {
  readonly eNodeCount: number;
  readonly eClassCount: number;
} {
  return Object.freeze({
    eNodeCount: operations.length,
    eClassCount: new Set(operations.flatMap((operation) => operation.resultIds)).size,
  });
}

export function nextSaturationCap(input: {
  readonly appliedRuleCount: number;
  readonly eNodeCount: number;
  readonly eClassCount: number;
  readonly limits: OptIrEGraphSaturationLimits;
}): OptIrEGraphSaturationCap | undefined {
  if (input.appliedRuleCount >= input.limits.maxRuleApplications) {
    return "ruleApplications";
  }
  if (input.eNodeCount >= input.limits.maxENodes) {
    return "eNodes";
  }
  if (input.eClassCount >= input.limits.maxEClasses) {
    return "eClasses";
  }
  return undefined;
}

export function assertPositiveLimits(limits: OptIrEGraphSaturationLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`OptIR e-graph saturation limit ${name} must be a positive integer.`);
    }
  }
}

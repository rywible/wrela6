import type { OptIrEGraph } from "./egraph";
import type { OptIrFactGateEvaluationContext } from "./fact-gated-rule";
import { evaluateOptIrFactGate } from "./fact-gated-rule";
import type { OptIrRuleCatalog } from "./rule-catalog";

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

export interface OptIrEGraphSaturationResult {
  readonly graph: OptIrEGraph;
  readonly iterations: number;
  readonly eNodeCount: number;
  readonly eClassCount: number;
  readonly appliedRules: readonly OptIrAppliedEGraphRule[];
  readonly hitCaps: readonly OptIrEGraphSaturationCap[];
}

export function saturateOptIrEGraph(input: {
  readonly graph: OptIrEGraph;
  readonly catalog: OptIrRuleCatalog;
  readonly factContext: OptIrFactGateEvaluationContext;
  readonly limits: OptIrEGraphSaturationLimits;
}): OptIrEGraphSaturationResult {
  assertPositiveLimits(input.limits);

  const appliedRules: OptIrAppliedEGraphRule[] = [];
  const hitCaps = new Set<OptIrEGraphSaturationCap>();
  let eNodeCount = input.graph.importOrder.length;
  const eClassCount = input.graph.classes.length;
  let iterations = 0;

  for (let iteration = 0; iteration < input.limits.maxIterations; iteration += 1) {
    iterations = iteration + 1;
    let appliedInIteration = false;

    for (const rule of input.catalog.rules) {
      if (appliedRules.length >= input.limits.maxRuleApplications) {
        hitCaps.add("ruleApplications");
        break;
      }
      if (eNodeCount >= input.limits.maxENodes) {
        hitCaps.add("eNodes");
        break;
      }
      if (eClassCount >= input.limits.maxEClasses) {
        hitCaps.add("eClasses");
        break;
      }

      const gate = evaluateOptIrFactGate(rule.factGate, input.factContext);
      if (gate.kind !== "passed") {
        continue;
      }

      appliedRules.push(
        Object.freeze({
          ruleId: String(rule.ruleId),
          iteration,
          uncertaintyPenalty: gate.uncertaintyPenalty,
        }),
      );
      eNodeCount += 1;
      appliedInIteration = true;
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
    hitCaps: Object.freeze([...hitCaps].sort()),
  });
}

function assertPositiveLimits(limits: OptIrEGraphSaturationLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`OptIR e-graph saturation limit ${name} must be a positive integer.`);
    }
  }
}

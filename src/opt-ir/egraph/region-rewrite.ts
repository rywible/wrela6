import { mergeOptIrEGraphClasses, type OptIrEGraphClass } from "./equivalence-class";
import type { OptIrEGraph } from "./egraph";
import { evaluateOptIrFactGate, type OptIrFactGateEvaluationContext } from "./fact-gated-rule";
import type { OptIrEGraphRegionCandidate } from "./region-selection";
import type { OptIrRuleCatalog } from "./rule-catalog";
import { optIrOperationId, type OptIrOperationId, type OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import {
  catalogRewriteHandlerForRuleId,
  type CatalogRewriteApplication,
} from "../rewrites/catalog-rewrite-builders";
import {
  assertPositiveLimits,
  nextSaturationCap,
  saturationCountsForOperations,
  type OptIrEGraphSaturationCap,
  type OptIrEGraphSaturationLimits,
} from "./saturation";

export interface OptIrEGraphRegionRewriteResult {
  readonly rewrittenOperations: readonly OptIrOperation[];
  readonly replacementOperationIds: readonly OptIrOperationId[];
  readonly appliedRuleIds: readonly string[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly addedOperationIds: readonly OptIrOperationId[];
  readonly valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[];
}

export interface OptIrAppliedEGraphCatalogRule {
  readonly ruleId: string;
  readonly iteration: number;
  readonly uncertaintyPenalty: number;
}

export interface OptIrEGraphRegionRewriteFixpointResult {
  readonly rewrite: OptIrEGraphRegionRewriteResult;
  readonly appliedRules: readonly OptIrAppliedEGraphCatalogRule[];
  readonly appliedRuleIds: readonly string[];
  readonly uncertaintyPenalty: number;
  readonly hitCaps: readonly OptIrEGraphSaturationCap[];
  readonly iterations: number;
}

export function applyOptIrCatalogRewriteRule(
  ruleId: string,
  input: {
    readonly region: OptIrEGraphRegionCandidate;
    readonly operations: readonly OptIrOperation[];
    readonly nextOperationId?: () => OptIrOperationId;
  },
): OptIrEGraphRegionRewriteResult | undefined {
  const handler = catalogRewriteHandlerForRuleId(ruleId);
  if (handler === undefined) {
    return undefined;
  }
  const regionOperations = regionOperationList(input.region, input.operations);
  const rewrite = handler(regionOperations, {
    nextOperationId: input.nextOperationId ?? operationIdAllocator(input.operations),
  });
  if (rewrite === undefined) {
    return undefined;
  }
  return mergeCatalogRewriteIntoOperations({
    region: input.region,
    operations: input.operations,
    rewrite,
    appliedRuleIds: [ruleId],
  });
}

function operationIdAllocator(operations: readonly OptIrOperation[]): () => OptIrOperationId {
  let nextOperationId =
    Math.max(0, ...operations.map((operation) => Number(operation.operationId))) + 1;
  return () => {
    const operationId = optIrOperationId(nextOperationId);
    nextOperationId += 1;
    return operationId;
  };
}

export function rewriteOptIrEGraphRegionWithCatalogFixpoint(input: {
  readonly region: OptIrEGraphRegionCandidate;
  readonly operations: readonly OptIrOperation[];
  readonly catalog: OptIrRuleCatalog;
  readonly factContext: OptIrFactGateEvaluationContext;
  readonly limits: OptIrEGraphSaturationLimits;
}): OptIrEGraphRegionRewriteFixpointResult {
  assertPositiveLimits(input.limits);

  const appliedRules: OptIrAppliedEGraphCatalogRule[] = [];
  const hitCaps = new Set<OptIrEGraphSaturationCap>();
  const removedOperationIds = new Set<OptIrOperationId>();
  const addedOperationIds = new Set<OptIrOperationId>();
  const valueForwards: { sourceValue: OptIrValueId; replacementValue: OptIrValueId }[] = [];
  let operations = input.operations;
  let iterations = 0;
  let uncertaintyPenalty = 0;

  for (let iteration = 0; iteration < input.limits.maxIterations; iteration += 1) {
    iterations = iteration + 1;
    let appliedInIteration = false;

    for (const rule of input.catalog.rules) {
      const counts = saturationCountsForOperations(operations);
      const cap = nextSaturationCap({
        appliedRuleCount: appliedRules.length,
        eNodeCount: counts.eNodeCount,
        eClassCount: counts.eClassCount,
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

      const rewrite = applyOptIrCatalogRewriteRule(String(rule.ruleId), {
        region: input.region,
        operations,
      });
      if (rewrite === undefined || rewrite.appliedRuleIds.length === 0) {
        continue;
      }

      uncertaintyPenalty += gate.uncertaintyPenalty;
      for (const ruleId of rewrite.appliedRuleIds) {
        appliedRules.push(
          Object.freeze({
            ruleId,
            iteration,
            uncertaintyPenalty: gate.uncertaintyPenalty,
          }),
        );
      }
      for (const operationId of rewrite.removedOperationIds) {
        removedOperationIds.add(operationId);
      }
      for (const operationId of rewrite.addedOperationIds) {
        addedOperationIds.add(operationId);
      }
      operations = rewrite.rewrittenOperations;
      valueForwards.push(...rewrite.valueForwards);
      appliedInIteration = true;

      const afterApplyCap = nextSaturationCap({
        appliedRuleCount: appliedRules.length,
        eNodeCount: saturationCountsForOperations(operations).eNodeCount,
        eClassCount: saturationCountsForOperations(operations).eClassCount,
        limits: input.limits,
      });
      if (afterApplyCap !== undefined) {
        hitCaps.add(afterApplyCap);
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

  const rewrite = buildRegionRewriteResult({
    region: input.region,
    operations,
    appliedRules,
    removedOperationIds,
    addedOperationIds,
    valueForwards,
  });

  return Object.freeze({
    rewrite,
    appliedRules: Object.freeze(appliedRules),
    appliedRuleIds: Object.freeze(appliedRules.map((entry) => entry.ruleId)),
    uncertaintyPenalty,
    hitCaps: Object.freeze([...hitCaps].sort()),
    iterations,
  });
}

export function mergeCatalogRewriteIntoOperations(input: {
  readonly region: OptIrEGraphRegionCandidate;
  readonly operations: readonly OptIrOperation[];
  readonly rewrite: CatalogRewriteApplication;
  readonly appliedRuleIds: readonly string[];
}): OptIrEGraphRegionRewriteResult {
  const rewrittenById = new Map(
    input.rewrite.operations.map((operation) => [operation.operationId, operation]),
  );
  const existingOperationIds = new Set(input.operations.map((operation) => operation.operationId));
  const mergedOperations = [
    ...input.operations.map((operation) => rewrittenById.get(operation.operationId) ?? operation),
    ...input.rewrite.operations.filter(
      (operation) => !existingOperationIds.has(operation.operationId),
    ),
  ];
  const removedOperationIds = new Set(input.rewrite.removedOperationIds);

  return Object.freeze({
    rewrittenOperations: Object.freeze(
      mergedOperations.filter((operation) => !removedOperationIds.has(operation.operationId)),
    ),
    replacementOperationIds: replacementOperationIdsForRewrite({
      region: input.region,
      operations: mergedOperations,
      removedOperationIds,
      addedOperationIds: input.rewrite.addedOperationIds,
    }),
    appliedRuleIds: Object.freeze(input.appliedRuleIds.slice()),
    removedOperationIds: Object.freeze(
      [...removedOperationIds].sort((left, right) => Number(left) - Number(right)),
    ),
    addedOperationIds: Object.freeze(
      [...input.rewrite.addedOperationIds].sort((left, right) => Number(left) - Number(right)),
    ),
    valueForwards: Object.freeze(
      input.rewrite.valueForwards
        .slice()
        .sort((left, right) => Number(left.sourceValue) - Number(right.sourceValue)),
    ),
  });
}

export function mergeOptIrEGraphClassesForValueForwards(
  graph: OptIrEGraph,
  valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[],
): readonly OptIrEGraphClass[] {
  if (valueForwards.length === 0) {
    return graph.classes;
  }

  const parent = graph.classes.map((_entry, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]!);
    }
    return parent[index]!;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (const forward of valueForwards) {
    const sourceClass = classIndexForValue(graph.classes, forward.sourceValue);
    const replacementClass = classIndexForValue(graph.classes, forward.replacementValue);
    if (sourceClass !== undefined && replacementClass !== undefined) {
      unite(sourceClass, replacementClass);
    }
  }

  const grouped = new Map<number, OptIrEGraphClass[]>();
  for (let index = 0; index < graph.classes.length; index += 1) {
    const root = find(index);
    const bucket = grouped.get(root) ?? [];
    bucket.push(graph.classes[index]!);
    grouped.set(root, bucket);
  }

  return Object.freeze(
    [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([classId, classes]) => mergeOptIrEGraphClasses(classId, classes)),
  );
}

function buildRegionRewriteResult(input: {
  readonly region: OptIrEGraphRegionCandidate;
  readonly operations: readonly OptIrOperation[];
  readonly appliedRules: readonly OptIrAppliedEGraphCatalogRule[];
  readonly removedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly addedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[];
}): OptIrEGraphRegionRewriteResult {
  return Object.freeze({
    rewrittenOperations: Object.freeze(input.operations.slice()),
    replacementOperationIds: replacementOperationIdsForRewrite({
      region: input.region,
      operations: input.operations,
      removedOperationIds: input.removedOperationIds,
      addedOperationIds: input.addedOperationIds,
    }),
    appliedRuleIds: Object.freeze(input.appliedRules.map((entry) => entry.ruleId)),
    removedOperationIds: Object.freeze(
      [...input.removedOperationIds].sort((left, right) => Number(left) - Number(right)),
    ),
    addedOperationIds: Object.freeze(
      [...input.addedOperationIds].sort((left, right) => Number(left) - Number(right)),
    ),
    valueForwards: Object.freeze(
      input.valueForwards
        .slice()
        .sort((left, right) => Number(left.sourceValue) - Number(right.sourceValue)),
    ),
  });
}

function replacementOperationIdsForRewrite(input: {
  readonly region: OptIrEGraphRegionCandidate;
  readonly operations: readonly OptIrOperation[];
  readonly removedOperationIds: ReadonlySet<OptIrOperationId> | readonly OptIrOperationId[];
  readonly addedOperationIds: ReadonlySet<OptIrOperationId> | readonly OptIrOperationId[];
}): readonly OptIrOperationId[] {
  const removed = new Set(input.removedOperationIds);
  const operationTableIds = new Set(input.operations.map((operation) => operation.operationId));
  const replacementIds: OptIrOperationId[] = [];
  for (const operationId of input.region.operationIds) {
    if (!removed.has(operationId) && operationTableIds.has(operationId)) {
      replacementIds.push(operationId);
    }
  }
  for (const operationId of input.addedOperationIds) {
    if (operationTableIds.has(operationId)) {
      replacementIds.push(operationId);
    }
  }
  return uniqueOperationIdsInOrder(replacementIds);
}

function regionOperationList(
  region: OptIrEGraphRegionCandidate,
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
  return Object.freeze(
    region.operationIds
      .map((operationId) => byId.get(operationId))
      .filter((operation): operation is OptIrOperation => operation !== undefined),
  );
}

function uniqueOperationIdsInOrder(
  operationIds: readonly OptIrOperationId[],
): readonly OptIrOperationId[] {
  const seen = new Set<OptIrOperationId>();
  const unique: OptIrOperationId[] = [];
  for (const operationId of operationIds) {
    if (seen.has(operationId)) {
      continue;
    }
    seen.add(operationId);
    unique.push(operationId);
  }
  return Object.freeze(unique);
}

function classIndexForValue(
  classes: readonly OptIrEGraphClass[],
  valueId: OptIrValueId,
): number | undefined {
  const index = classes.findIndex((entry) => entry.valueIds.includes(valueId));
  return index === -1 ? undefined : index;
}

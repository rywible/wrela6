import { extractOptIrEGraph, type OptIrExtractionCandidate } from "../egraph/extraction";
import {
  approvedNotApplicableReasonsForCatalogGates,
  buildOptIrFactGateContextFromFacts,
} from "../egraph/fact-context";
import type { OptIrEGraphRegionRewriteResult } from "../egraph/region-rewrite";
import { rewriteOptIrEGraphRegionWithCatalogFixpoint } from "../egraph/region-rewrite";
import type { OptIrEGraphRegionCandidate } from "../egraph/region-selection";
import { extractionPolicyRankForRegionKind } from "../egraph/region-selection";
import {
  saturatedOperationsImproveRegion,
  type OptIrEGraphSaturationLimits,
} from "../egraph/saturation";
import { createDefaultOptIrRuleCatalog } from "../egraph/rule-catalog";
import {
  validateOptIrEGraphTranslation,
  type OptIrTranslationValidationResult,
} from "../egraph/translation-validation";
import type { OptIrFactSet } from "../facts/fact-index";
import type { OptIrBlockId, OptIrOperationId } from "../ids";
import type { OptIrInterpreterSlice } from "../interpreter";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import { defaultOptIrEGraphExtractionPolicy } from "../policy/egraph-extraction-policy";
import {
  runFactGatedEGraphPass,
  type OptIrFactGatedEGraphPassResult,
  type OptIrFactGatedEGraphValidators,
} from "./fact-gated-egraph";
import { discoverOptIrEGraphRegionCandidates } from "./egraph-region-discovery";
import { optIrCfgEdgeTable } from "../cfg";
import type { OptIrBlock } from "../cfg";
import { operationMap } from "./pipeline-state";
import { verifyOptIrProgram } from "../verify/structural-verifier";
import {
  addedOperationsFromRewrite,
  applyOptIrOperationRewrites,
  type OptIrBlockOperationRewrite,
  replacedOperationsFromRewrite,
} from "./rewrite-materialization";

export const OPT_IR_FACT_GATED_EGRAPH_WORKLIST_LIMIT = 1200;

export const DEFAULT_OPT_IR_EGRAPH_SATURATION_LIMITS: OptIrEGraphSaturationLimits = Object.freeze({
  maxENodes: 600,
  maxEClasses: 240,
  maxIterations: 8,
  maxRuleApplications: 1200,
});

export interface OptIrFactGatedEGraphMaterializationInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly optimizationRegions: readonly OptIrRegion[];
  readonly facts: OptIrFactSet;
  readonly tracingEnabled: boolean;
}

export interface OptIrSaturateAndExtractRegionResult {
  readonly kind: "replaced" | "unchanged";
  readonly operations: readonly OptIrOperation[];
  readonly program: OptIrProgram;
  readonly record: {
    readonly rulesApplied: readonly string[];
    readonly regionId: OptIrEGraphRegionCandidate["regionId"];
    readonly stableRootOperationId: OptIrOperationId;
    readonly uncertaintyPenalty: number;
  };
}

export interface OptIrMaterializedEGraphProgram {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
}

interface PendingRegionRewrite {
  readonly region: OptIrEGraphRegionCandidate;
  readonly policyRank: ReturnType<typeof extractionPolicyRankForRegionKind>;
  readonly uncertaintyPenalty: number;
  readonly appliedRuleIds: readonly string[];
  readonly rewrite: OptIrEGraphRegionRewriteResult;
}

export function runOptIrFactGatedEGraphMaterialization(
  input: OptIrFactGatedEGraphMaterializationInput,
): OptIrFactGatedEGraphPassResult<OptIrProgram, OptIrMaterializedEGraphProgram> {
  const catalog = createDefaultOptIrRuleCatalog();
  const factContext = buildOptIrFactGateContextFromFacts(input.facts);
  const approvedReasons = approvedNotApplicableReasonsForCatalogGates(
    catalog.rules.map((rule) => rule.factGate),
  );
  const regions = discoverOptIrEGraphRegionCandidates({
    program: input.program,
    operations: input.operations,
    optimizationRegions: input.optimizationRegions,
    facts: input.facts,
  });
  const selectedPending = selectFirstImprovingRegionRewrite({
    program: input.program,
    operations: input.operations,
    regions,
    factContext,
    catalog,
  });
  const policy = defaultOptIrEGraphExtractionPolicy();
  const validators = {
    validatePostReplacement: postReplacementValidator(),
  };

  if (selectedPending === undefined) {
    return runFactGatedEGraphPass({
      original: input.program,
      extraction: extractOptIrEGraph({
        original: input.program,
        candidates: [],
        policy,
        tracingEnabled: input.tracingEnabled,
      }),
      validateTranslation: () =>
        Object.freeze({ kind: "notApplicable" as const, reasons: Object.freeze([]) }),
      validators,
      tracingEnabled: input.tracingEnabled,
    });
  }

  const materialized = commitOptIrEGraphRegionRewrite({
    program: input.program,
    operations: input.operations,
    region: selectedPending.region,
    rewrite: selectedPending.rewrite,
  });
  const extracted: OptIrMaterializedEGraphProgram = Object.freeze({
    program: materialized.program,
    operations: materialized.operations,
  });
  const candidate: OptIrExtractionCandidate<OptIrMaterializedEGraphProgram> = Object.freeze({
    extracted,
    regionId: selectedPending.region.regionId,
    stableRootOperationId: selectedPending.region.rootOperationId,
    policyRank: selectedPending.policyRank,
    uncertaintyPenalty: selectedPending.uncertaintyPenalty,
    appliedRuleIds: selectedPending.appliedRuleIds,
  });

  return runFactGatedEGraphPass({
    original: input.program,
    extraction: extractOptIrEGraph({
      original: input.program,
      candidates: [candidate],
      policy,
      tracingEnabled: input.tracingEnabled,
    }),
    validateTranslation: (extracted) =>
      validateMaterializedProgramTranslation({
        originalProgram: input.program,
        originalOperations: input.operations,
        extracted,
        region: selectedPending.region,
        replacementOperationIds: selectedPending.rewrite.replacementOperationIds,
        approvedReasons,
      }),
    validators,
    tracingEnabled: input.tracingEnabled,
  });
}

export function saturateAndExtractOptIrEGraphRegion(input: {
  readonly region: OptIrEGraphRegionCandidate;
  readonly operations: readonly OptIrOperation[];
  readonly program: OptIrProgram;
  readonly facts: OptIrFactSet;
}): OptIrSaturateAndExtractRegionResult {
  const catalog = createDefaultOptIrRuleCatalog();
  const factContext = buildOptIrFactGateContextFromFacts(input.facts);
  const pending = buildPendingRegionRewrite({
    program: input.program,
    operations: input.operations,
    region: input.region,
    factContext,
    catalog,
  });

  if (pending === undefined) {
    return Object.freeze({
      kind: "unchanged",
      operations: input.operations,
      program: input.program,
      record: Object.freeze({
        rulesApplied: Object.freeze([]),
        regionId: input.region.regionId,
        stableRootOperationId: input.region.rootOperationId,
        uncertaintyPenalty: 0,
      }),
    });
  }

  const materialized = commitOptIrEGraphRegionRewrite({
    program: input.program,
    operations: input.operations,
    region: input.region,
    rewrite: pending.rewrite,
  });
  return Object.freeze({
    kind: "replaced",
    operations: materialized.operations,
    program: materialized.program,
    record: Object.freeze({
      rulesApplied: pending.appliedRuleIds,
      regionId: input.region.regionId,
      stableRootOperationId: input.region.rootOperationId,
      uncertaintyPenalty: pending.uncertaintyPenalty,
    }),
  });
}

function selectFirstImprovingRegionRewrite(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly regions: readonly OptIrEGraphRegionCandidate[];
  readonly factContext: ReturnType<typeof buildOptIrFactGateContextFromFacts>;
  readonly catalog: ReturnType<typeof createDefaultOptIrRuleCatalog>;
}): PendingRegionRewrite | undefined {
  for (const region of input.regions) {
    const pending = buildPendingRegionRewrite({
      program: input.program,
      operations: input.operations,
      region,
      factContext: input.factContext,
      catalog: input.catalog,
    });
    if (pending !== undefined) {
      return pending;
    }
  }
  return undefined;
}

function buildPendingRegionRewrite(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly region: OptIrEGraphRegionCandidate;
  readonly factContext: ReturnType<typeof buildOptIrFactGateContextFromFacts>;
  readonly catalog: ReturnType<typeof createDefaultOptIrRuleCatalog>;
}): PendingRegionRewrite | undefined {
  const regionOperations = regionOperationsForCandidate(input.region, input.operations);
  const rewritten = rewriteOptIrEGraphRegionWithCatalogFixpoint({
    region: input.region,
    operations: input.operations,
    catalog: input.catalog,
    factContext: input.factContext,
    limits: DEFAULT_OPT_IR_EGRAPH_SATURATION_LIMITS,
  });
  const rewrittenRegionOperations = regionOperationsForCandidate(
    { ...input.region, operationIds: rewritten.rewrite.replacementOperationIds },
    rewritten.rewrite.rewrittenOperations,
  );
  if (
    rewritten.appliedRuleIds.length === 0 ||
    !saturatedOperationsImproveRegion(regionOperations, rewrittenRegionOperations)
  ) {
    return undefined;
  }

  return Object.freeze({
    region: input.region,
    policyRank: extractionPolicyRankForRegionKind(input.region.kind),
    uncertaintyPenalty: rewritten.uncertaintyPenalty,
    appliedRuleIds: rewritten.appliedRuleIds,
    rewrite: rewritten.rewrite,
  });
}

function commitOptIrEGraphRegionRewrite(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly region: OptIrEGraphRegionCandidate;
  readonly rewrite: OptIrEGraphRegionRewriteResult;
}): ReturnType<typeof applyOptIrOperationRewrites> {
  const replacedOperations = replacedOperationsFromRewrite(
    input.operations,
    input.rewrite.rewrittenOperations,
  );
  const addedOperations = addedOperationsFromRewrite(
    input.operations,
    input.rewrite.rewrittenOperations,
  );
  const blockRewrites = blockRewritesForEGraphRegionRewrite({
    program: input.program,
    region: input.region,
    rewrite: input.rewrite,
    addedOperations,
  });
  return applyOptIrOperationRewrites({
    program: input.program,
    operations: input.operations,
    addedOperations,
    replacedOperations,
    blockRewrites,
    valueForwards: input.rewrite.valueForwards,
  });
}

function blockRewritesForEGraphRegionRewrite(input: {
  readonly program: OptIrProgram;
  readonly region: OptIrEGraphRegionCandidate;
  readonly rewrite: OptIrEGraphRegionRewriteResult;
  readonly addedOperations: readonly OptIrOperation[];
}): readonly OptIrBlockOperationRewrite[] {
  const removedOperationIds = new Set(input.rewrite.removedOperationIds);
  const insertedOperationIds = input.addedOperations.map((operation) => operation.operationId);
  assertRemovedOperationsBelongToRegion(input.region, removedOperationIds);

  const materializedRemovedIds = new Set<OptIrOperationId>();
  const rewrites: OptIrBlockOperationRewrite[] = [];
  let insertedAddedOperations = false;

  for (const function_ of input.program.functions.entries()) {
    for (const block of function_.blocks) {
      for (const replacedSpanOperationIds of contiguousRemovedSpansForBlock(
        block,
        removedOperationIds,
      )) {
        for (const operationId of replacedSpanOperationIds) {
          materializedRemovedIds.add(operationId);
        }
        const replacementOperationIds =
          insertedAddedOperations || insertedOperationIds.length === 0 ? [] : insertedOperationIds;
        if (replacementOperationIds.length > 0) {
          insertedAddedOperations = true;
        }
        rewrites.push({
          kind: "replaceSpan",
          blockId: block.blockId,
          replacedSpanOperationIds,
          replacementOperationIds: Object.freeze(replacementOperationIds),
        });
      }
    }
  }

  assertAllRemovedOperationsWereMaterialized(removedOperationIds, materializedRemovedIds);
  if (removedOperationIds.size > 0 && insertedOperationIds.length > 0 && !insertedAddedOperations) {
    throw new Error("OptIR e-graph rewrite added operations were not inserted.");
  }

  if (removedOperationIds.size === 0 && insertedOperationIds.length > 0) {
    const rootBlockId = blockContainingOperation(input.program, input.region.rootOperationId);
    if (rootBlockId === undefined) {
      throw new Error(
        `OptIR e-graph rewrite root operation ${Number(input.region.rootOperationId)} is not in the program.`,
      );
    }
    rewrites.push({
      kind: "insertAt",
      blockId: rootBlockId,
      anchorOperationId: input.region.rootOperationId,
      placement: "after",
      insertedOperationIds: Object.freeze(insertedOperationIds),
    });
  }

  return Object.freeze(rewrites);
}

function contiguousRemovedSpansForBlock(
  block: OptIrBlock,
  removedOperationIds: ReadonlySet<OptIrOperationId>,
): readonly (readonly OptIrOperationId[])[] {
  const spans: OptIrOperationId[][] = [];
  let current: OptIrOperationId[] = [];
  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    spans.push(current);
    current = [];
  };

  for (const operationId of block.operations) {
    if (removedOperationIds.has(operationId)) {
      current.push(operationId);
    } else {
      flush();
    }
  }
  flush();
  return Object.freeze(spans.map((span) => Object.freeze(span)));
}

function assertRemovedOperationsBelongToRegion(
  region: OptIrEGraphRegionCandidate,
  removedOperationIds: ReadonlySet<OptIrOperationId>,
): void {
  const regionOperationIds = new Set(region.operationIds);
  for (const operationId of removedOperationIds) {
    if (!regionOperationIds.has(operationId)) {
      throw new Error(
        `OptIR e-graph rewrite removed operation ${Number(operationId)} outside region ${Number(region.regionId)}.`,
      );
    }
  }
}

function assertAllRemovedOperationsWereMaterialized(
  expected: ReadonlySet<OptIrOperationId>,
  actual: ReadonlySet<OptIrOperationId>,
): void {
  for (const operationId of expected) {
    if (!actual.has(operationId)) {
      throw new Error(
        `OptIR e-graph rewrite removed operation ${Number(operationId)} is not in the program.`,
      );
    }
  }
}

function blockContainingOperation(
  program: OptIrProgram,
  operationId: OptIrOperationId,
): OptIrBlockId | undefined {
  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      if (block.operations.includes(operationId)) {
        return block.blockId;
      }
    }
  }
  return undefined;
}

function postReplacementValidator(): OptIrFactGatedEGraphValidators<OptIrMaterializedEGraphProgram>["validatePostReplacement"] {
  const validationCache = new WeakMap<
    OptIrMaterializedEGraphProgram,
    ReturnType<
      OptIrFactGatedEGraphValidators<OptIrMaterializedEGraphProgram>["validatePostReplacement"]
    >
  >();
  return (materialized) => {
    const cached = validationCache.get(materialized);
    if (cached !== undefined) {
      return cached;
    }
    const result = verifyOptIrProgram({
      program: materialized.program,
      operations: operationMap(materialized.operations),
      options: { checkDominance: true, recomputeOperationMetadata: true },
    });
    const validation =
      result.kind === "ok"
        ? { kind: "ok" as const }
        : { kind: "error" as const, diagnostics: result.diagnostics };
    validationCache.set(materialized, validation);
    return validation;
  };
}

function validateMaterializedProgramTranslation(input: {
  readonly originalProgram: OptIrProgram;
  readonly originalOperations: readonly OptIrOperation[];
  readonly extracted: OptIrMaterializedEGraphProgram;
  readonly region: OptIrEGraphRegionCandidate;
  readonly replacementOperationIds: readonly OptIrOperationId[];
  readonly approvedReasons: readonly string[];
}): OptIrTranslationValidationResult {
  const originalSlice = interpreterSliceForRegion(
    input.originalProgram,
    input.region,
    input.originalOperations,
  );
  const replacementSlice = interpreterSliceForRegion(
    input.extracted.program,
    { ...input.region, operationIds: input.replacementOperationIds },
    input.extracted.operations,
  );
  if (originalSlice === undefined || replacementSlice === undefined) {
    return Object.freeze({
      kind: "notApplicable" as const,
      reasons: Object.freeze(["empty-region-slice"]),
    });
  }
  return validateOptIrEGraphTranslation({
    original: originalSlice,
    replacement: replacementSlice,
    validationContext: {},
    approvedNotApplicableReasons: input.approvedReasons,
  });
}

function interpreterSliceForRegion(
  program: OptIrProgram,
  region: OptIrEGraphRegionCandidate,
  operations: readonly OptIrOperation[],
): OptIrInterpreterSlice | undefined {
  const regionOperationIds = new Set(region.operationIds);
  const blocks: OptIrBlock[] = [];
  let entryBlock: OptIrBlockId | undefined;
  let edges = optIrCfgEdgeTable([]);
  for (const function_ of program.functions.entries()) {
    const regionBlocks = function_.blocks.flatMap((block) => {
      const blockOperationIds = block.operations.filter((operationId) =>
        regionOperationIds.has(operationId),
      );
      return blockOperationIds.length === 0
        ? []
        : [{ ...block, operations: Object.freeze(blockOperationIds) }];
    });
    if (regionBlocks.length === 0) {
      continue;
    }
    blocks.push(...regionBlocks);
    entryBlock = entryBlock ?? regionBlocks[0]?.blockId;
    edges = function_.edges;
  }
  const regionOperations = operations.filter((operation) =>
    regionOperationIds.has(operation.operationId),
  );
  if (entryBlock === undefined || blocks.length === 0 || regionOperations.length === 0) {
    return undefined;
  }
  const slice: OptIrInterpreterSlice = {
    entryBlock,
    blocks: Object.freeze(blocks),
    edges,
    operations: Object.freeze(regionOperations),
  };
  return Object.freeze(slice);
}

function regionOperationsForCandidate(
  region: OptIrEGraphRegionCandidate,
  operations: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  const byId = operationMap(operations);
  return region.operationIds
    .map((operationId) => byId.get(operationId))
    .filter((operation): operation is OptIrOperation => operation !== undefined);
}

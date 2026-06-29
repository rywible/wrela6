import { optimizationPassId, type OptimizationPassId } from "../ids";
import type {
  OptIrAnalysisId,
  OptIrFormOrFactPostcondition,
  OptIrFormOrFactPrecondition,
  OptIrPassContract,
  OptIrPassFuelPolicy,
} from "../passes/pass-contract";

export type OptIrProductionScheduleStageId =
  | "construction-cleanup-fixpoint"
  | "mandatory-semantic-inlining"
  | "post-mandatory-cleanup-fixpoint"
  | "scope-expansion-fixpoint"
  | "scalar-simplification-fixpoint"
  | "memory-region-optimization"
  | "wrela-fact-rounds-fixpoint"
  | "fact-gated-egraph"
  | "vectorization"
  | "final-cleanup-fixpoint"
  | "final-verification";

export type OptIrProductionMutationKind =
  | "cfg-edit"
  | "operation-replacement"
  | "memory-edit"
  | "call-edit"
  | "region-edit"
  | "fact-edit";

export interface OptIrFixpointPolicy {
  readonly fixpointId: OptIrProductionScheduleStageId;
  readonly fuel: Exclude<OptIrPassFuelPolicy, { readonly kind: "none" }>;
  readonly worklistPriority: readonly OptimizationPassId[];
}

export interface OptIrProductionPassScheduleEntry {
  readonly stageId: OptIrProductionScheduleStageId;
  readonly order: number;
  readonly passId: OptimizationPassId;
  readonly contract: OptIrPassContract;
  readonly requires: readonly OptIrFormOrFactPrecondition[];
  readonly produces: readonly OptIrFormOrFactPostcondition[];
  readonly invalidatesAnalyses: readonly OptIrAnalysisId[];
  readonly idempotent: boolean;
  readonly fuel: OptIrPassFuelPolicy;
  readonly fixpoint?: OptIrFixpointPolicy;
}

export interface OptIrProductionInvalidationRule {
  readonly mutationKind: OptIrProductionMutationKind;
  readonly invalidates: readonly OptIrAnalysisId[];
  readonly mustRecomputeBefore: readonly string[];
}

export const OPT_IR_PRODUCTION_SCHEDULE_STAGE_IDS: readonly OptIrProductionScheduleStageId[] =
  Object.freeze([
    "construction-cleanup-fixpoint",
    "mandatory-semantic-inlining",
    "post-mandatory-cleanup-fixpoint",
    "scope-expansion-fixpoint",
    "scalar-simplification-fixpoint",
    "memory-region-optimization",
    "wrela-fact-rounds-fixpoint",
    "fact-gated-egraph",
    "vectorization",
    "final-cleanup-fixpoint",
    "final-verification",
  ]);

const constructionCleanupFuel = fixedRounds(4);
const postMandatoryCleanupFuel = fixedRounds(4);
const scopeExpansionFuel = worklist(256);
const scalarSimplificationFuel = fixedRounds(6);
const wrelaFactRoundsFuel = fixedRounds(4);
const finalCleanupFuel = fixedRounds(4);

const scopeExpansionPassIds = passIds([
  "whole-program-inlining",
  "whole-program-specialization",
  "sccp-cleanup",
]);
const scalarSimplificationPassIds = passIds([
  "constant-folding",
  "sccp",
  "dce",
  "gvn",
  "copy-propagation",
  "cfg-simplification",
]);

const constructionCleanupFixpoint = fixpoint(
  "construction-cleanup-fixpoint",
  constructionCleanupFuel,
  passIds(["construction-cleanup"]),
);
const postMandatoryCleanupFixpoint = fixpoint(
  "post-mandatory-cleanup-fixpoint",
  postMandatoryCleanupFuel,
  passIds(["post-mandatory-cleanup"]),
);
const scopeExpansionFixpoint = fixpoint(
  "scope-expansion-fixpoint",
  scopeExpansionFuel,
  scopeExpansionPassIds,
);
const scalarSimplificationFixpoint = fixpoint(
  "scalar-simplification-fixpoint",
  scalarSimplificationFuel,
  scalarSimplificationPassIds,
);
const wrelaFactRoundsFixpoint = fixpoint(
  "wrela-fact-rounds-fixpoint",
  wrelaFactRoundsFuel,
  passIds(["wrela-fact-rounds"]),
);
const finalCleanupFixpoint = fixpoint(
  "final-cleanup-fixpoint",
  finalCleanupFuel,
  passIds(["final-cleanup"]),
);

export const OPT_IR_PRODUCTION_PASS_SCHEDULE: readonly OptIrProductionPassScheduleEntry[] =
  Object.freeze([
    scheduleEntry(0, "construction-cleanup-fixpoint", "construction-cleanup", {
      requires: ["canonical-opt-ir"],
      produces: ["construction-clean"],
      invalidatesAnalyses: ["dominance", "liveness", "fact-index"],
      idempotent: true,
      fuel: constructionCleanupFuel,
      fixpoint: constructionCleanupFixpoint,
    }),
    scheduleEntry(1, "mandatory-semantic-inlining", "mandatory-semantic-inlining", {
      requires: ["construction-clean"],
      produces: ["mandatory-inlining-complete"],
      invalidatesAnalyses: ["call-graph", "scc", "liveness", "effects", "fact-index"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(2, "post-mandatory-cleanup-fixpoint", "post-mandatory-cleanup", {
      requires: ["mandatory-inlining-complete"],
      produces: ["post-mandatory-clean"],
      invalidatesAnalyses: ["dominance", "liveness", "sccp", "fact-index"],
      idempotent: true,
      fuel: postMandatoryCleanupFuel,
      fixpoint: postMandatoryCleanupFixpoint,
    }),
    scheduleEntry(3, "scope-expansion-fixpoint", "whole-program-inlining", {
      requires: ["post-mandatory-clean", "call-graph", "scc"],
      produces: ["scope-expanded"],
      invalidatesAnalyses: ["call-graph", "scc", "liveness", "effects", "fact-index"],
      idempotent: true,
      fuel: scopeExpansionFuel,
      fixpoint: scopeExpansionFixpoint,
    }),
    scheduleEntry(4, "scope-expansion-fixpoint", "whole-program-specialization", {
      requires: ["post-mandatory-clean", "call-graph", "scc", "fact-index"],
      produces: ["scope-expanded", "specialized-clones"],
      invalidatesAnalyses: ["call-graph", "scc", "liveness", "effects", "fact-index"],
      idempotent: true,
      fuel: scopeExpansionFuel,
      fixpoint: scopeExpansionFixpoint,
    }),
    scheduleEntry(5, "scope-expansion-fixpoint", "sccp-cleanup", {
      requires: ["scope-expanded", "dominance"],
      produces: ["sccp-clean"],
      invalidatesAnalyses: ["dominance", "loop-tree", "liveness", "sccp"],
      idempotent: true,
      fuel: scopeExpansionFuel,
      fixpoint: scopeExpansionFixpoint,
    }),
    scheduleEntry(6, "scalar-simplification-fixpoint", "constant-folding", {
      requires: ["sccp-clean"],
      produces: ["constants-folded"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(7, "scalar-simplification-fixpoint", "sccp", {
      requires: ["constants-folded", "dominance"],
      produces: ["sccp"],
      invalidatesAnalyses: ["dominance", "loop-tree", "liveness", "sccp"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(8, "scalar-simplification-fixpoint", "dce", {
      requires: ["sccp", "liveness"],
      produces: ["dead-code-eliminated"],
      invalidatesAnalyses: ["dominance", "liveness"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(9, "scalar-simplification-fixpoint", "gvn", {
      requires: ["dead-code-eliminated", "value-numbering"],
      produces: ["values-numbered"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(10, "scalar-simplification-fixpoint", "copy-propagation", {
      requires: ["values-numbered"],
      produces: ["copies-propagated"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(11, "scalar-simplification-fixpoint", "cfg-simplification", {
      requires: ["copies-propagated", "dominance"],
      produces: ["scalar-simplified"],
      invalidatesAnalyses: ["dominance", "loop-tree", "liveness", "sccp"],
      idempotent: true,
      fuel: scalarSimplificationFuel,
      fixpoint: scalarSimplificationFixpoint,
    }),
    scheduleEntry(12, "memory-region-optimization", "memory-ssa", {
      requires: ["scalar-simplified"],
      produces: ["memory-ssa"],
      invalidatesAnalyses: ["memory-ssa"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(13, "memory-region-optimization", "load-store-forwarding", {
      requires: ["memory-ssa", "alias"],
      produces: ["loads-forwarded"],
      invalidatesAnalyses: ["memory-ssa", "alias", "liveness"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(14, "memory-region-optimization", "dead-store-elimination", {
      requires: ["loads-forwarded", "memory-ssa", "alias"],
      produces: ["dead-stores-eliminated"],
      invalidatesAnalyses: ["memory-ssa", "alias", "liveness"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(15, "memory-region-optimization", "scalar-replacement", {
      requires: ["dead-stores-eliminated", "memory-ssa", "alias"],
      produces: ["scalar-replaced"],
      invalidatesAnalyses: ["alias", "memory-ssa", "effects"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(16, "memory-region-optimization", "stack-promotion", {
      requires: ["scalar-replaced", "escape-analysis", "alias"],
      produces: ["stack-promoted"],
      invalidatesAnalyses: ["alias", "memory-ssa", "effects"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(17, "memory-region-optimization", "licm", {
      requires: ["stack-promoted", "dominance", "loop-tree", "memory-ssa"],
      produces: ["memory-region-optimized"],
      invalidatesAnalyses: ["memory-ssa", "alias", "liveness"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(18, "wrela-fact-rounds-fixpoint", "wrela-fact-rounds", {
      requires: ["memory-region-optimized", "fact-index", "path-certificates"],
      produces: ["wrela-facts-optimized"],
      invalidatesAnalyses: ["fact-index", "path-certificates"],
      idempotent: true,
      fuel: wrelaFactRoundsFuel,
      fixpoint: wrelaFactRoundsFixpoint,
    }),
    scheduleEntry(19, "fact-gated-egraph", "fact-gated-egraph", {
      requires: ["wrela-facts-optimized", "fact-index", "path-certificates"],
      produces: ["egraph-rewritten"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp", "fact-index"],
      idempotent: false,
      fuel: worklist(1200),
    }),
    scheduleEntry(20, "vectorization", "vector-idiom-prep", {
      requires: ["egraph-rewritten", "fact-index"],
      produces: ["vector-idioms-prepared"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(21, "vectorization", "slp-vectorization", {
      requires: ["vector-idioms-prepared", "alias", "effects", "fact-index"],
      produces: ["slp-vectorized"],
      invalidatesAnalyses: ["alias", "memory-ssa", "effects"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(22, "vectorization", "certified-loop-vectorization", {
      requires: ["slp-vectorized", "dominance", "loop-tree", "fact-index"],
      produces: ["loops-vectorized"],
      invalidatesAnalyses: ["dominance", "loop-tree", "liveness", "sccp"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(23, "vectorization", "vector-cleanup", {
      requires: ["loops-vectorized"],
      produces: ["vectorized"],
      invalidatesAnalyses: ["value-numbering", "liveness", "sccp"],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
    scheduleEntry(24, "final-cleanup-fixpoint", "final-cleanup", {
      requires: ["vectorized"],
      produces: ["lowering-ready"],
      invalidatesAnalyses: ["dominance", "liveness", "fact-index"],
      idempotent: true,
      fuel: finalCleanupFuel,
      fixpoint: finalCleanupFixpoint,
    }),
    scheduleEntry(25, "final-verification", "final-verification", {
      requires: ["lowering-ready", "fact-index", "path-certificates"],
      produces: ["verified-for-lowering"],
      invalidatesAnalyses: [],
      idempotent: false,
      fuel: fixedRounds(1),
    }),
  ]);

export const OPT_IR_PRODUCTION_INVALIDATION_MATRIX: readonly OptIrProductionInvalidationRule[] =
  Object.freeze([
    invalidationRule(
      "cfg-edit",
      ["dominance", "loop-tree", "liveness", "sccp"],
      ["verifier", "sccp", "licm", "vectorization", "path-certificates"],
    ),
    invalidationRule(
      "operation-replacement",
      ["value-numbering", "liveness", "sccp"],
      ["gvn", "dce", "sccp", "egraph"],
    ),
    invalidationRule(
      "memory-edit",
      ["memory-ssa", "alias", "liveness"],
      ["memory-optimization", "egraph", "vectorization"],
    ),
    invalidationRule(
      "call-edit",
      ["call-graph", "scc", "liveness", "effects"],
      ["inlining", "specialization", "effect-verifier"],
    ),
    invalidationRule(
      "region-edit",
      ["alias", "memory-ssa", "effects"],
      ["memory-optimization", "egraph", "vectorization"],
    ),
    invalidationRule(
      "fact-edit",
      ["fact-index", "path-certificates"],
      ["fact-gated-passes", "final-verifier"],
    ),
  ]);

interface ScheduleEntryInput {
  readonly requires: readonly OptIrFormOrFactPrecondition[];
  readonly produces: readonly OptIrFormOrFactPostcondition[];
  readonly invalidatesAnalyses: readonly OptIrAnalysisId[];
  readonly idempotent: boolean;
  readonly fuel: OptIrPassFuelPolicy;
  readonly fixpoint?: OptIrFixpointPolicy;
}

function scheduleEntry(
  order: number,
  stageId: OptIrProductionScheduleStageId,
  passIdValue: string,
  input: ScheduleEntryInput,
): OptIrProductionPassScheduleEntry {
  const passId = optimizationPassId(passIdValue);
  const requires = freezeArray(input.requires);
  const produces = freezeArray(input.produces);
  const invalidatesAnalyses = freezeArray(input.invalidatesAnalyses);
  const contract: OptIrPassContract = {
    passId,
    invalidatesByDefault: true,
    preserves: Object.freeze([]),
    derives: Object.freeze([]),
    rewriteObligations: Object.freeze([]),
    scheduling: Object.freeze({
      requires,
      produces,
      invalidatesAnalyses,
      idempotent: input.idempotent,
      fuel: input.fuel,
    }),
    requiresVerifierAfterRun: true,
  };

  return Object.freeze({
    stageId,
    order,
    passId,
    contract: Object.freeze(contract),
    requires: contract.scheduling.requires,
    produces: contract.scheduling.produces,
    invalidatesAnalyses: contract.scheduling.invalidatesAnalyses,
    idempotent: contract.scheduling.idempotent,
    fuel: contract.scheduling.fuel,
    fixpoint: input.fixpoint,
  });
}

function fixpoint(
  fixpointId: OptIrProductionScheduleStageId,
  fuel: Exclude<OptIrPassFuelPolicy, { readonly kind: "none" }>,
  worklistPriority: readonly OptimizationPassId[],
): OptIrFixpointPolicy {
  return Object.freeze({ fixpointId, fuel, worklistPriority: freezeArray(worklistPriority) });
}

function invalidationRule(
  mutationKind: OptIrProductionMutationKind,
  invalidates: readonly OptIrAnalysisId[],
  mustRecomputeBefore: readonly string[],
): OptIrProductionInvalidationRule {
  return Object.freeze({
    mutationKind,
    invalidates: freezeArray(invalidates),
    mustRecomputeBefore: freezeArray(mustRecomputeBefore),
  });
}

function fixedRounds(rounds: number): Exclude<OptIrPassFuelPolicy, { readonly kind: "none" }> {
  return Object.freeze({ kind: "fixedRounds", rounds });
}

function worklist(maxItems: number): Exclude<OptIrPassFuelPolicy, { readonly kind: "none" }> {
  return Object.freeze({ kind: "worklist", maxItems });
}

function passIds(values: readonly string[]): readonly OptimizationPassId[] {
  return Object.freeze(values.map((value) => optimizationPassId(value)));
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

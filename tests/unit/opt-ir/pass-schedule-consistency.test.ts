import { describe, expect, test } from "bun:test";

import {
  OPT_IR_PRODUCTION_INVALIDATION_MATRIX,
  OPT_IR_PRODUCTION_PASS_SCHEDULE,
  OPT_IR_PRODUCTION_SCHEDULE_STAGE_IDS,
  type OptIrProductionPassScheduleEntry,
} from "../../../src/opt-ir/policy/pass-order-policy";
import {
  validateOptIrPassSchedule,
  validateProductionOptIrPassSchedule,
} from "../../../src/opt-ir/verify/pass-schedule-consistency";
import {
  validateOptIrPassContract,
  type OptIrPassContract,
  type OptIrPassFuelPolicy,
} from "../../../src/opt-ir/passes/pass-contract";
import { optimizationPassId, type OptimizationPassId } from "../../../src/opt-ir/ids";

describe("OptIR production schedule policy", () => {
  test("production schedule matches the reviewed design staging", () => {
    expect(OPT_IR_PRODUCTION_SCHEDULE_STAGE_IDS).toEqual([
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

    expect(OPT_IR_PRODUCTION_PASS_SCHEDULE.map((entry) => String(entry.passId))).toEqual([
      "construction-cleanup",
      "mandatory-semantic-inlining",
      "post-mandatory-cleanup",
      "whole-program-inlining",
      "whole-program-specialization",
      "sccp-cleanup",
      "constant-folding",
      "sccp",
      "dce",
      "gvn",
      "copy-propagation",
      "cfg-simplification",
      "memory-ssa",
      "load-store-forwarding",
      "dead-store-elimination",
      "scalar-replacement",
      "stack-promotion",
      "licm",
      "wrela-fact-rounds",
      "fact-gated-egraph",
      "vector-idiom-prep",
      "slp-vectorization",
      "certified-loop-vectorization",
      "vector-cleanup",
      "final-cleanup",
      "final-verification",
    ]);
  });

  test("production schedule entries expose one pass contract and verifier-ready scheduling metadata", () => {
    expect(Object.isFrozen(OPT_IR_PRODUCTION_PASS_SCHEDULE)).toBe(true);
    expect(Object.isFrozen(OPT_IR_PRODUCTION_SCHEDULE_STAGE_IDS)).toBe(true);

    for (const entry of OPT_IR_PRODUCTION_PASS_SCHEDULE) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.contract)).toBe(true);
      expect(Object.isFrozen(entry.contract.scheduling)).toBe(true);
      expect(Object.isFrozen(entry.requires)).toBe(true);
      expect(Object.isFrozen(entry.produces)).toBe(true);
      expect(Object.isFrozen(entry.invalidatesAnalyses)).toBe(true);
      expect(entry.passId).toBe(entry.contract.passId);
      expect(entry.contract.invalidatesByDefault).toBe(true);
      expect(validateOptIrPassContract(entry.contract)).toEqual({ kind: "ok" });
      expect(entry.requires).toBe(entry.contract.scheduling.requires);
      expect(entry.produces).toBe(entry.contract.scheduling.produces);
      expect(entry.invalidatesAnalyses).toBe(entry.contract.scheduling.invalidatesAnalyses);
      expect(entry.idempotent).toBe(entry.contract.scheduling.idempotent);
      expect(entry.fuel).toBe(entry.contract.scheduling.fuel);
    }
  });

  test("production schedule declares fixpoint memberships with only idempotent fuel-bounded passes", () => {
    const fixpointMembers = OPT_IR_PRODUCTION_PASS_SCHEDULE.filter(
      (entry) => entry.fixpoint !== undefined,
    );

    expect(
      fixpointMembers.map((entry) => [entry.fixpoint?.fixpointId, String(entry.passId)]),
    ).toEqual([
      ["construction-cleanup-fixpoint", "construction-cleanup"],
      ["post-mandatory-cleanup-fixpoint", "post-mandatory-cleanup"],
      ["scope-expansion-fixpoint", "whole-program-inlining"],
      ["scope-expansion-fixpoint", "whole-program-specialization"],
      ["scope-expansion-fixpoint", "sccp-cleanup"],
      ["scalar-simplification-fixpoint", "constant-folding"],
      ["scalar-simplification-fixpoint", "sccp"],
      ["scalar-simplification-fixpoint", "dce"],
      ["scalar-simplification-fixpoint", "gvn"],
      ["scalar-simplification-fixpoint", "copy-propagation"],
      ["scalar-simplification-fixpoint", "cfg-simplification"],
      ["wrela-fact-rounds-fixpoint", "wrela-fact-rounds"],
      ["final-cleanup-fixpoint", "final-cleanup"],
    ]);

    for (const entry of fixpointMembers) {
      expect(entry.idempotent).toBe(true);
      expect(entry.fuel.kind).not.toBe("none");
      expect(entry.fixpoint?.fuel.kind).not.toBe("none");
      expect(entry.fixpoint?.worklistPriority).toContain(entry.passId);
      expect(Object.isFrozen(entry.fixpoint)).toBe(true);
      expect(Object.isFrozen(entry.fixpoint?.worklistPriority)).toBe(true);
    }
  });

  test("production schedule exports the exact invalidation matrix for the verifier", () => {
    expect(OPT_IR_PRODUCTION_INVALIDATION_MATRIX).toEqual([
      {
        mutationKind: "cfg-edit",
        invalidates: ["dominance", "loop-tree", "liveness", "sccp"],
        mustRecomputeBefore: ["verifier", "sccp", "licm", "vectorization", "path-certificates"],
      },
      {
        mutationKind: "operation-replacement",
        invalidates: ["value-numbering", "liveness", "sccp"],
        mustRecomputeBefore: ["gvn", "dce", "sccp", "egraph"],
      },
      {
        mutationKind: "memory-edit",
        invalidates: ["memory-ssa", "alias", "liveness"],
        mustRecomputeBefore: ["memory-optimization", "egraph", "vectorization"],
      },
      {
        mutationKind: "call-edit",
        invalidates: ["call-graph", "scc", "liveness", "effects"],
        mustRecomputeBefore: ["inlining", "specialization", "effect-verifier"],
      },
      {
        mutationKind: "region-edit",
        invalidates: ["alias", "memory-ssa", "effects"],
        mustRecomputeBefore: ["memory-optimization", "egraph", "vectorization"],
      },
      {
        mutationKind: "fact-edit",
        invalidates: ["fact-index", "path-certificates"],
        mustRecomputeBefore: ["fact-gated-passes", "final-verifier"],
      },
    ]);
  });

  test("production schedule validates successfully with the schedule consistency verifier", () => {
    expect(validateProductionOptIrPassSchedule().kind).toBe("ok");
  });

  test("schedule verifier rejects passes scheduled before producers of preconditions", () => {
    const result = validateOptIrPassSchedule([
      passEntry("consumer", {
        requires: ["lowering-ready"],
        produces: ["verified-for-lowering"],
      }),
      passEntry("producer", {
        requires: ["canonical-opt-ir"],
        produces: ["lowering-ready"],
      }),
    ]);

    expect(result).toEqual({
      kind: "error",
      issues: [
        {
          code: "PRECONDITION_PRODUCER_NOT_SCHEDULED",
          passId: optimizationPassId("consumer"),
          order: 0,
          precondition: "lowering-ready",
        },
      ],
    });
  });

  test("schedule verifier rejects invalidated analyses consumed without recomputation", () => {
    const result = validateOptIrPassSchedule(
      [
        passEntry("producer", {
          requires: ["canonical-opt-ir"],
          produces: ["canonical-clean"],
          invalidatesAnalyses: ["dominance"],
        }),
        passEntry("consumer", {
          requires: ["canonical-clean", "dominance"],
          produces: ["verified-for-lowering"],
        }),
      ],
      { initialAvailable: ["canonical-opt-ir", "dominance"] },
    );

    expect(result).toEqual({
      kind: "error",
      issues: [
        {
          analysis: "dominance",
          code: "STALE_ANALYSIS_CONSUMED",
          invalidatedByPassId: optimizationPassId("producer"),
          invalidatedByOrder: 0,
          order: 1,
          passId: optimizationPassId("consumer"),
        },
      ],
    });
  });

  test("schedule verifier accepts invalidated analyses after explicit recomputation", () => {
    expect(
      validateOptIrPassSchedule(
        [
          passEntry("producer", {
            requires: ["canonical-opt-ir"],
            produces: ["canonical-clean"],
            invalidatesAnalyses: ["dominance"],
          }),
          passEntry("recompute-dominance", {
            requires: ["canonical-clean"],
            produces: ["dominance"],
          }),
          passEntry("consumer", {
            requires: ["canonical-clean", "dominance"],
            produces: ["verified-for-lowering"],
          }),
        ],
        { initialAvailable: ["canonical-opt-ir", "dominance"] },
      ),
    ).toEqual({ kind: "ok" });
  });

  test("schedule verifier treats a pass-produced analysis as fresh after local invalidation", () => {
    expect(
      validateOptIrPassSchedule(
        [
          passEntry("recompute-dominance", {
            requires: ["canonical-opt-ir"],
            produces: ["dominance"],
            invalidatesAnalyses: ["dominance"],
          }),
          passEntry("consumer", {
            requires: ["dominance"],
            produces: ["verified-for-lowering"],
          }),
        ],
        { initialAvailable: ["canonical-opt-ir", "dominance"] },
      ),
    ).toEqual({ kind: "ok" });
  });

  test("schedule verifier rejects non-idempotent and unbounded fixpoint members", () => {
    const result = validateOptIrPassSchedule([
      passEntry("not-idempotent", {
        requires: ["canonical-opt-ir"],
        produces: ["clean"],
        idempotent: false,
        fixpointId: "cleanup-fixpoint",
      }),
      passEntry("unbounded", {
        requires: ["clean"],
        produces: ["cleaner"],
        fuel: { kind: "none" },
        fixpointId: "cleanup-fixpoint",
      }),
    ]);

    expect(result).toEqual({
      kind: "error",
      issues: [
        {
          code: "FIXPOINT_PASS_NOT_IDEMPOTENT",
          fixpointId: "cleanup-fixpoint",
          order: 0,
          passId: optimizationPassId("not-idempotent"),
        },
        {
          code: "FIXPOINT_PASS_UNBOUNDED",
          fixpointId: "cleanup-fixpoint",
          order: 1,
          passId: optimizationPassId("unbounded"),
        },
      ],
    });
  });

  test("schedule verifier rejects reused fixpoint ids outside one consecutive group", () => {
    const result = validateOptIrPassSchedule([
      passEntry("first", {
        requires: ["canonical-opt-ir"],
        produces: ["first-clean"],
        fixpointId: "cleanup-fixpoint",
      }),
      passEntry("middle", {
        requires: ["first-clean"],
        produces: ["middle-clean"],
      }),
      passEntry("second", {
        requires: ["middle-clean"],
        produces: ["second-clean"],
        fixpointId: "cleanup-fixpoint",
      }),
    ]);

    expect(result).toEqual({
      kind: "error",
      issues: [
        {
          code: "FIXPOINT_ID_REUSED_NON_CONSECUTIVELY",
          fixpointId: "cleanup-fixpoint",
          order: 2,
          passId: optimizationPassId("second"),
          previousOrder: 0,
        },
      ],
    });
  });

  test("schedule verifier reads scheduling data from the single pass contract", () => {
    const entry = passEntry("consumer", {
      requires: ["canonical-opt-ir"],
      produces: ["verified-for-lowering"],
    });
    const inconsistentEntry = {
      ...entry,
      requires: ["missing-entry-only-precondition"],
      produces: ["entry-only-output"],
      invalidatesAnalyses: ["entry-only-analysis"],
      idempotent: false,
      fuel: { kind: "none" },
    } as OptIrProductionPassScheduleEntry;

    expect(validateOptIrPassSchedule([inconsistentEntry])).toEqual({ kind: "ok" });
  });
});

interface FakePassEntryInput {
  readonly requires: readonly string[];
  readonly produces: readonly string[];
  readonly invalidatesAnalyses?: readonly string[];
  readonly idempotent?: boolean;
  readonly fuel?: OptIrPassFuelPolicy;
  readonly fixpointId?: string;
}

function passEntry(
  passIdValue: string,
  input: FakePassEntryInput,
): OptIrProductionPassScheduleEntry {
  const passId = optimizationPassId(passIdValue);
  const fuel: OptIrPassFuelPolicy = input.fuel ?? { kind: "fixedRounds", rounds: 1 };
  const contract: OptIrPassContract = Object.freeze({
    passId,
    invalidatesByDefault: true,
    preserves: Object.freeze([]),
    derives: Object.freeze([]),
    rewriteObligations: Object.freeze([]),
    scheduling: Object.freeze({
      requires: Object.freeze([...input.requires]),
      produces: Object.freeze([...input.produces]),
      invalidatesAnalyses: Object.freeze([...(input.invalidatesAnalyses ?? [])]),
      idempotent: input.idempotent ?? true,
      fuel,
    }),
    requiresVerifierAfterRun: true,
  });

  return Object.freeze({
    stageId: "construction-cleanup-fixpoint",
    order: 0,
    passId,
    contract,
    requires: contract.scheduling.requires,
    produces: contract.scheduling.produces,
    invalidatesAnalyses: contract.scheduling.invalidatesAnalyses,
    idempotent: contract.scheduling.idempotent,
    fuel: contract.scheduling.fuel,
    fixpoint:
      input.fixpointId === undefined
        ? undefined
        : Object.freeze({
            fixpointId: input.fixpointId,
            fuel: { kind: "fixedRounds", rounds: 4 },
            worklistPriority: Object.freeze([passId]) as readonly OptimizationPassId[],
          }),
  }) as OptIrProductionPassScheduleEntry;
}

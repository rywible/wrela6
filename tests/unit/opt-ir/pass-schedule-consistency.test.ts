import { describe, expect, test } from "bun:test";

import {
  OPT_IR_PRODUCTION_INVALIDATION_MATRIX,
  OPT_IR_PRODUCTION_PASS_SCHEDULE,
  OPT_IR_PRODUCTION_SCHEDULE_STAGE_IDS,
} from "../../../src/opt-ir/policy/pass-order-policy";
import { validateOptIrPassContract } from "../../../src/opt-ir/passes/pass-contract";

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
});

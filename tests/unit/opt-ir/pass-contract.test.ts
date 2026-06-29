import { describe, expect, test } from "bun:test";

import {
  optimizationPassId,
  optIrFactId,
  optIrOriginId,
  optIrRewriteRegionId,
} from "../../../src/opt-ir/ids";
import {
  passInvariantCheckerId,
  passInvariantSchemaId,
  rewriteLegalityObligationId,
  validateOptIrPassContract,
  type OptIrPassContract,
} from "../../../src/opt-ir/passes/pass-contract";

function validContract(overrides: Partial<OptIrPassContract> = {}): OptIrPassContract {
  return {
    passId: optimizationPassId("cleanup"),
    invalidatesByDefault: true,
    preserves: [
      {
        ruleId: "preserve-ownership-identity",
        factKind: "ownership",
        subject: { kind: "identity" },
        scope: { kind: "sameScope" },
        dependencies: { kind: "identity" },
        cfg: { kind: "unchanged" },
        memory: { kind: "unchanged" },
        invalidations: { kind: "rejectTriggered" },
        result: "preserved",
      },
    ],
    derives: [
      {
        ruleId: "derive-clean-cfg",
        factKind: "passDerived",
        dependencies: [optIrFactId(0)],
        result: "newFact",
      },
    ],
    rewriteObligations: [
      {
        obligationId: rewriteLegalityObligationId("cleanup-branch-fold"),
        invariant: {
          kind: "passSpecificInvariant",
          schema: passInvariantSchemaId("cleanupBranchFold"),
          checker: passInvariantCheckerId("cleanup-branch-fold-checker"),
          decomposesTo: [{ kind: "terminalReachabilityEquivalence" }],
        },
        requiredFacts: [optIrFactId(0)],
        factsShape: { minimumFacts: 1, acceptedFactKinds: ["ownership"] },
        original: optIrRewriteRegionId(0),
        replacement: optIrRewriteRegionId(1),
        origin: optIrOriginId(0),
      },
    ],
    scheduling: {
      requires: ["canonical-ssa"],
      produces: ["clean-cfg"],
      invalidatesAnalyses: ["dominance"],
      idempotent: true,
      fuel: { kind: "fixedRounds", rounds: 4 },
    },
    requiresVerifierAfterRun: true,
    ...overrides,
  };
}

describe("OptIR pass contract", () => {
  test("contract shape accepts one complete pass contract with scheduling and rewrite obligations", () => {
    expect(validateOptIrPassContract(validContract())).toEqual({ kind: "ok" });
  });

  test("contract shape rejects missing pass id, non-default invalidation, and missing verifier facet", () => {
    const result = validateOptIrPassContract({
      ...validContract(),
      passId: "" as OptIrPassContract["passId"],
      invalidatesByDefault: false as true,
      requiresVerifierAfterRun: undefined as unknown as boolean,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected contract validation to fail.");
    }
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "PASS_ID_MISSING",
      "INVALIDATES_BY_DEFAULT_REQUIRED",
      "REQUIRES_VERIFIER_AFTER_RUN_REQUIRED",
    ]);
  });

  test("contract shape rejects incomplete scheduling and malformed fuel", () => {
    const result = validateOptIrPassContract({
      ...validContract(),
      scheduling: {
        requires: [],
        produces: [],
        invalidatesAnalyses: [],
        idempotent: true,
        fuel: { kind: "fixedRounds", rounds: 0 },
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected contract validation to fail.");
    }
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "SCHEDULING_REQUIRES_EMPTY",
      "SCHEDULING_PRODUCES_EMPTY",
      "FUEL_FIXED_ROUNDS_INVALID",
    ]);
  });

  test("contract shape rejects rewrite obligations without invariant schema ids or facts shape", () => {
    const contract = validContract({
      rewriteObligations: [
        {
          obligationId: rewriteLegalityObligationId("bad-obligation"),
          invariant: {
            kind: "passSpecificInvariant",
            schema: "" as ReturnType<typeof passInvariantSchemaId>,
            checker: passInvariantCheckerId("checker"),
            decomposesTo: [],
          },
          requiredFacts: [],
          factsShape: { minimumFacts: 0, acceptedFactKinds: [] },
          original: optIrRewriteRegionId(0),
          replacement: optIrRewriteRegionId(1),
          origin: optIrOriginId(0),
        },
      ],
    });

    const result = validateOptIrPassContract(contract);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected contract validation to fail.");
    }
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "REWRITE_OBLIGATION_REQUIRED_FACTS_EMPTY",
      "REWRITE_OBLIGATION_FACTS_SHAPE_EMPTY",
      "PASS_SPECIFIC_INVARIANT_SCHEMA_MISSING",
      "PASS_SPECIFIC_INVARIANT_DECOMPOSITION_EMPTY",
    ]);
  });
});

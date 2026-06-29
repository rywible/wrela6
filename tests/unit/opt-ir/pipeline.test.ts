import { describe, expect, test } from "bun:test";

import { constructOptIr } from "../../../src/opt-ir/public-api";
import {
  optimizeOptIr,
  stableOptimizedOptIrResultKey,
  type OptimizeOptIrInput,
} from "../../../src/opt-ir/passes/pipeline";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import { validConstructOptIrInputForTest } from "../../support/opt-ir/construction-fixtures";

describe("OptIR optimizer pipeline", () => {
  test("runs the fixed production pipeline with required verifier checkpoints", () => {
    const input = validConstructOptIrInputForTest();
    const constructed = constructOptIr(input);
    if (constructed.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    const result = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected optimization to succeed.");
    }

    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
    expect(result.decisionLog.entries().map((entry) => entry.candidateKey)).toEqual(
      expect.arrayContaining([
        "pipeline:00:construction-cleanup",
        "pipeline:01:mandatory-semantic-inlining",
        "pipeline:19:fact-gated-egraph",
        "pipeline:25:final-verification",
      ]),
    );
    expect(result.verificationCheckpoints.map((checkpoint) => checkpoint.kind)).toEqual(
      expect.arrayContaining([
        "after-construction",
        "after-mandatory-inlining",
        "after-scope-expansion-cluster",
        "after-scalar-simplification-cluster",
        "after-memory-region-cluster",
        "after-wrela-cluster",
        "after-fact-gated-egraph",
        "after-vectorization-cluster",
        "after-final-cleanup",
        "before-target-lowering",
      ]),
    );

    const repeated = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
    });
    expect(stableOptimizedOptIrResultKey(result)).toBe(stableOptimizedOptIrResultKey(repeated));
  });

  test("rejects stale external provenance maps instead of accepting optimizer input sidecars", () => {
    const input = validConstructOptIrInputForTest();
    const constructed = constructOptIr(input);
    if (constructed.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    const result = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
      provenance: constructed.provenance,
    } as unknown as OptimizeOptIrInput);

    expect(result).toMatchObject({
      kind: "error",
      diagnostics: [{ stableDetail: "stale-external-provenance:provenance" }],
    });
  });
});

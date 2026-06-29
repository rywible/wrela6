import { describe, expect, test } from "bun:test";

import {
  extractOptIrEGraph,
  type OptIrExtractionCandidate,
} from "../../../src/opt-ir/egraph/extraction";
import { defaultOptIrEGraphExtractionPolicy } from "../../../src/opt-ir/policy/egraph-extraction-policy";
import { runFactGatedEGraphPass } from "../../../src/opt-ir/passes/fact-gated-egraph";
import { optIrOperationId, optIrRewriteRegionId } from "../../../src/opt-ir/ids";

describe("optimized OptIR interpreter e-graph integration", () => {
  test("rejects interpreter-complete disagreements and leaves the original OptIR unchanged", () => {
    const original = { label: "original" };
    const extracted = { label: "rewritten" };

    const result = runFactGatedEGraphPass({
      original,
      extraction: extractOptIrEGraph({
        original,
        candidates: [candidate(extracted)],
        policy: defaultOptIrEGraphExtractionPolicy(),
        tracingEnabled: false,
      }),
      validateTranslation: () => ({
        kind: "failed",
        reason: "interpreter-disagreement",
        disagreements: [
          {
            stableKey: "translation-validation:case:0:0",
            original: { kind: "returned", values: [], observations: { memory: [], effects: [] } },
            replacement: {
              kind: "returned",
              values: [],
              observations: { memory: [], effects: [] },
            },
          },
        ],
      }),
      validators: validationPipeline(),
      tracingEnabled: true,
    });

    expect(result).toMatchObject({
      kind: "unchanged",
      optIr: original,
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "fact-gated-egraph:translation-validation:interpreter-disagreement",
    ]);
  });

  test("runs structural, effect, dominance, fact, and rewrite-legality validation after replacement", () => {
    const original = { label: "original" };
    const extracted = { label: "rewritten" };
    const calls: string[] = [];

    const result = runFactGatedEGraphPass({
      original,
      extraction: extractOptIrEGraph({
        original,
        candidates: [candidate(extracted)],
        policy: defaultOptIrEGraphExtractionPolicy(),
        tracingEnabled: false,
      }),
      validateTranslation: () => ({
        kind: "notApplicable",
        reasons: ["unsupported-interpreter-rule:runtime-call"],
      }),
      validators: validationPipeline(calls),
      tracingEnabled: true,
    });

    expect(result).toMatchObject({
      kind: "changed",
      optIr: extracted,
      translationValidation: {
        kind: "notApplicable",
        reasons: ["unsupported-interpreter-rule:runtime-call"],
      },
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "fact-gated-egraph:translationValidation:notApplicable:unsupported-interpreter-rule:runtime-call",
    ]);
    expect(calls).toEqual([
      "structural:rewritten",
      "effect:rewritten",
      "dominance:rewritten",
      "fact:rewritten",
      "rewriteLegality:rewritten",
    ]);
  });
});

function candidate(extracted: {
  readonly label: string;
}): OptIrExtractionCandidate<typeof extracted> {
  return {
    extracted,
    regionId: optIrRewriteRegionId(1),
    stableRootOperationId: optIrOperationId(1),
    policyRank: 0 as OptIrExtractionCandidate["policyRank"],
    uncertaintyPenalty: 0,
    appliedRuleIds: ["opt-ir.egraph.vector-idiom-preparation"],
  };
}

function validationPipeline(calls: string[] = []) {
  return {
    structural: validator("structural", calls),
    effect: validator("effect", calls),
    dominance: validator("dominance", calls),
    fact: validator("fact", calls),
    rewriteLegality: validator("rewriteLegality", calls),
  };
}

function validator(name: string, calls: string[]) {
  return (optIr: { readonly label: string }) => {
    calls.push(`${name}:${optIr.label}`);
    return { kind: "ok" as const };
  };
}

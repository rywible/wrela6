import { describe, expect, test } from "bun:test";

import {
  extractOptIrEGraph,
  type OptIrExtractionCandidate,
} from "../../../src/opt-ir/egraph/extraction";
import {
  evaluateOptIrFactGate,
  optIrFactGate,
  type OptIrFactGateEvaluationContext,
} from "../../../src/opt-ir/egraph/fact-gated-rule";
import { createDefaultOptIrRuleCatalog } from "../../../src/opt-ir/egraph/rule-catalog";
import { saturateOptIrEGraph } from "../../../src/opt-ir/egraph/saturation";
import { importOperationsIntoEGraphForTest } from "../../../src/opt-ir/egraph/egraph";
import { defaultOptIrEGraphExtractionPolicy } from "../../../src/opt-ir/policy/egraph-extraction-policy";
import { optIrFactId, optIrOperationId, optIrRewriteRegionId } from "../../../src/opt-ir/ids";
import { shuffledOperandImportFixtureForTest } from "../../support/opt-ir/egraph-fixtures";

describe("fact-gated OptIR e-graph rewriting", () => {
  test("catalog exposes production rules and all required fact gate categories", () => {
    const catalog = createDefaultOptIrRuleCatalog();

    expect(catalog.rules.map((rule) => rule.ruleId)).toEqual([
      "opt-ir.egraph.endian-load-folding",
      "opt-ir.egraph.bounds-branch-deletion",
      "opt-ir.egraph.move-copy-erasure",
      "opt-ir.egraph.layout-arithmetic-folding",
      "opt-ir.egraph.parser-state-collapse",
      "opt-ir.egraph.field-disjoint-memory-cse",
      "opt-ir.egraph.platform-wrapper-collapse",
      "opt-ir.egraph.vector-idiom-preparation",
    ]);
    expect(catalog.rules.every((rule) => rule.name.length > 0)).toBeTrue();
    expect(catalog.rules.every((rule) => rule.pattern.operationKinds.length > 0)).toBeTrue();
    expect(catalog.rules.every((rule) => rule.replacement.operationKinds.length > 0)).toBeTrue();
    expect(catalog.rules.every((rule) => rule.preservationRules.length > 0)).toBeTrue();

    const gateKinds = new Set(catalog.rules.flatMap((rule) => collectGateKinds(rule.factGate)));
    expect([...gateKinds].sort()).toEqual([
      "abi",
      "alias",
      "bounds",
      "capabilityFlow",
      "conjunction",
      "effect",
      "layout",
      "none",
      "privateState",
      "terminal",
    ]);
  });

  test("fact gates are evaluated through injected fact answers", () => {
    const gate = optIrFactGate.conjunction([
      optIrFactGate.bounds("access"),
      optIrFactGate.alias("regions"),
      optIrFactGate.none(),
    ]);
    const context = gateContext({ bounds: "yes", alias: "unknown" });

    expect(evaluateOptIrFactGate(gate, context)).toEqual({
      kind: "blocked",
      factsUsed: [optIrFactId(1)],
      missingGateKinds: ["alias"],
      uncertaintyPenalty: 1,
    });
  });

  test("saturation respects iteration, e-node, e-class, and rule application caps", () => {
    const graph = importOperationsIntoEGraphForTest(
      shuffledOperandImportFixtureForTest().operations,
    );
    const catalog = createDefaultOptIrRuleCatalog();
    const saturated = saturateOptIrEGraph({
      graph,
      catalog,
      factContext: gateContext({
        bounds: "yes",
        alias: "yes",
        layout: "yes",
        effect: "yes",
        abi: "yes",
        terminal: "yes",
        capabilityFlow: "yes",
        privateState: "yes",
      }),
      limits: {
        maxIterations: 3,
        maxENodes: 5,
        maxEClasses: 4,
        maxRuleApplications: 2,
      },
    });

    expect(saturated.iterations).toBeLessThanOrEqual(3);
    expect(saturated.eNodeCount).toBeLessThanOrEqual(5);
    expect(saturated.eClassCount).toBeLessThanOrEqual(4);
    expect(saturated.appliedRules).toHaveLength(2);
    expect(saturated.hitCaps).toContain("ruleApplications");
  });

  test("extraction uses checked-in policy, uncertainty penalty, and stable root id tie breaks", () => {
    const policy = defaultOptIrEGraphExtractionPolicy();
    const candidates: readonly OptIrExtractionCandidate[] = [
      extractionCandidate({ label: "higher-root", policyRank: 0, uncertaintyPenalty: 0, root: 9 }),
      extractionCandidate({ label: "penalized", policyRank: 0, uncertaintyPenalty: 1, root: 1 }),
      extractionCandidate({ label: "best", policyRank: 0, uncertaintyPenalty: 0, root: 2 }),
      extractionCandidate({ label: "worse-policy", policyRank: 1, uncertaintyPenalty: 0, root: 0 }),
    ];

    const result = extractOptIrEGraph({
      original: "unchanged-opt-ir",
      candidates,
      policy,
      tracingEnabled: true,
    });

    if (result.kind !== "ok") {
      throw new Error("expected extraction to select a candidate");
    }
    expect(result.extracted).toBe("best");
    expect(result.record).toMatchObject({
      policyId: policy.policyId,
      uncertaintyPenalty: 0,
      stableRootOperationId: optIrOperationId(2),
      rulesApplied: [],
    });
  });

  test("failed extraction returns original OptIR and only emits debug diagnostics when tracing is enabled", () => {
    const untraced = extractOptIrEGraph({
      original: "original-opt-ir",
      candidates: [],
      policy: defaultOptIrEGraphExtractionPolicy(),
      tracingEnabled: false,
    });
    const traced = extractOptIrEGraph({
      original: "original-opt-ir",
      candidates: [],
      policy: defaultOptIrEGraphExtractionPolicy(),
      tracingEnabled: true,
    });

    expect(untraced).toEqual({
      kind: "unchanged",
      optIr: "original-opt-ir",
      diagnostics: [],
    });
    expect(traced.kind).toBe("unchanged");
    expect(traced.optIr).toBe("original-opt-ir");
    expect(traced.diagnostics.map((diagnostic) => String(diagnostic.severity))).toEqual(["debug"]);
  });
});

function collectGateKinds(gate: ReturnType<typeof optIrFactGate.none>): readonly string[] {
  if (gate.kind !== "conjunction") {
    return [gate.kind];
  }
  return [gate.kind, ...gate.gates.flatMap(collectGateKinds)];
}

function gateContext(
  answers: Partial<Record<keyof OptIrFactGateEvaluationContext["answers"], "yes" | "unknown">>,
): OptIrFactGateEvaluationContext {
  const makeAnswer = (kind: keyof OptIrFactGateEvaluationContext["answers"]) => ({
    kind: answers[kind] ?? "unknown",
    factsUsed: answers[kind] === "yes" ? [optIrFactId(1)] : [],
  });
  return {
    answers: {
      bounds: () => makeAnswer("bounds"),
      alias: () => makeAnswer("alias"),
      layout: () => makeAnswer("layout"),
      effect: () => makeAnswer("effect"),
      abi: () => makeAnswer("abi"),
      terminal: () => makeAnswer("terminal"),
      capabilityFlow: () => makeAnswer("capabilityFlow"),
      privateState: () => makeAnswer("privateState"),
    },
  };
}

function extractionCandidate(input: {
  readonly label: string;
  readonly policyRank: number;
  readonly uncertaintyPenalty: number;
  readonly root: number;
}): OptIrExtractionCandidate {
  return {
    extracted: input.label,
    regionId: optIrRewriteRegionId(input.root),
    stableRootOperationId: optIrOperationId(input.root),
    policyRank: input.policyRank as OptIrExtractionCandidate["policyRank"],
    uncertaintyPenalty: input.uncertaintyPenalty,
    appliedRuleIds: [],
  };
}

import { describe, expect, test } from "bun:test";

import { createPassInvariantSchemaRegistry } from "../../../src/opt-ir/verify/pass-invariant-schema";
import { validateRewriteLegality } from "../../../src/opt-ir/verify/rewrite-legality";
import {
  createDefaultOptIrRuleCatalog,
  OPT_IR_EGRAPH_RULE_IDS,
} from "../../../src/opt-ir/egraph/rule-catalog";
import { minimumFactsForGate } from "../../../src/opt-ir/egraph/fact-gated-rule";
import { optIrFactId, optIrOriginId, optIrRewriteRegionId } from "../../../src/opt-ir/ids";

describe("OptIR e-graph rule soundness catalog", () => {
  test("default rule ids are stable, unique, and match the catalog order", () => {
    const catalog = createDefaultOptIrRuleCatalog();

    expect(OPT_IR_EGRAPH_RULE_IDS.map(String)).toEqual(
      catalog.rules.map((rule) => String(rule.ruleId)),
    );
    expect(new Set(OPT_IR_EGRAPH_RULE_IDS).size).toBe(OPT_IR_EGRAPH_RULE_IDS.length);
    expect([...OPT_IR_EGRAPH_RULE_IDS].sort()).not.toEqual(OPT_IR_EGRAPH_RULE_IDS);
  });

  test("every production rule has a replayable invariant schema and preservation obligation", () => {
    const catalog = createDefaultOptIrRuleCatalog();
    const schemas = createPassInvariantSchemaRegistry(catalog.invariantSchemas);

    for (const [index, rule] of catalog.rules.entries()) {
      const minimumFacts = minimumFactsForGate(rule.factGate);
      const requiredFacts = Array.from({ length: minimumFacts }, (_unused, factIndex) =>
        optIrFactId(index * 10 + factIndex),
      );
      const original = optIrRewriteRegionId(index * 2);
      const replacement = optIrRewriteRegionId(index * 2 + 1);
      const origin = optIrOriginId(index);
      const obligation = rule.createRewriteObligation({
        requiredFacts,
        original,
        replacement,
        origin,
      });
      const record = rule.createRewriteRecord({
        recordId: `record-${index}`,
        requiredFacts,
        original,
        replacement,
        origin,
      });

      expect(rule.invariant.kind).toBe("passSpecificInvariant");
      if (rule.invariant.kind !== "passSpecificInvariant") {
        throw new Error("expected pass-specific invariant");
      }
      expect(schemas.get(rule.invariant.schema)).toBeDefined();
      expect(obligation.factsShape.minimumFacts).toBe(minimumFactsForGate(rule.factGate));
      expect(obligation.factsShape.acceptedFactKinds).toEqual(rule.acceptedFactKinds);
      expect(record.ruleId).toBe(rule.ruleId);
      expect(record.original).toBe(original);
      expect(record.replacement).toBe(replacement);
      expect(rule.preservationRules.map((preservation) => preservation.ruleId)).toContain(
        rule.primaryPreservationRuleId,
      );

      expect(
        validateRewriteLegality({
          records: [record],
          obligations: [obligation],
          schemas,
          factKinds: new Map(
            requiredFacts.map((factId, factIndex) => [
              factId,
              rule.acceptedFactKinds[factIndex % rule.acceptedFactKinds.length] ?? "passDerived",
            ]),
          ),
        }),
      ).toEqual({ kind: "ok" });
    }
  });
});

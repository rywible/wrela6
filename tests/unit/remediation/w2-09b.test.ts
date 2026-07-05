import { describe, expect, test } from "bun:test";

import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { createDefaultOptIrRuleCatalog } from "../../../src/opt-ir/egraph/rule-catalog";
import { optIrFactId, optIrOriginId, optIrRewriteRegionId } from "../../../src/opt-ir/ids";
import { createPassInvariantSchemaRegistry } from "../../../src/opt-ir/verify/pass-invariant-schema";
import { validateRewriteLegality } from "../../../src/opt-ir/verify/rewrite-legality";

describe("W2-09b certified fact consumption verification", () => {
  test("rewrite legality rejects consumed fact families absent from certified inputs", () => {
    const catalog = createDefaultOptIrRuleCatalog();
    const rule = catalog.rules.find(
      (candidate) => candidate.ruleId === "opt-ir.egraph.platform-wrapper-collapse",
    );
    if (rule === undefined) {
      throw new Error("expected platform wrapper collapse rule");
    }
    const requiredFacts = [optIrFactId(1), optIrFactId(2), optIrFactId(3), optIrFactId(4)];
    const original = optIrRewriteRegionId(1);
    const replacement = optIrRewriteRegionId(2);
    const origin = optIrOriginId(9);
    const record = rule.createRewriteRecord({
      recordId: "platform-wrapper-record",
      requiredFacts,
      original,
      replacement,
      origin,
    });
    const obligation = rule.createRewriteObligation({
      requiredFacts,
      original,
      replacement,
      origin,
    });

    const result = validateRewriteLegality({
      records: [record],
      obligations: [obligation],
      schemas: createPassInvariantSchemaRegistry(catalog.invariantSchemas),
      factKinds: new Map([
        [optIrFactId(1), "platformEffect"],
        [optIrFactId(2), "layoutAbi"],
        [optIrFactId(3), "terminalClosure"],
        [optIrFactId(4), "capabilityFlow"],
      ]),
      certifiedFactFamilies: new Set(["platformEffect", "layoutAbi", "terminalClosure"]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("expected uncertified consumption to be rejected");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_UNCERTIFIED_FACT_CONSUMPTION"),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "uncertified-fact-consumption:record:platform-wrapper-record:family:capabilityFlow",
    );
  });
});

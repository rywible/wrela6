import { describe, expect, test } from "bun:test";

import { createDefaultOptIrRuleCatalog } from "../../../src/opt-ir/egraph/rule-catalog";
import { minimumFactsForGate } from "../../../src/opt-ir/egraph/fact-gated-rule";
import {
  optIrConstantId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRewriteRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { optIrConstantOperation } from "../../../src/opt-ir/operations";
import { runWrelaMoveCopyWrapperElisionForTest } from "../../../src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("W2-09a declarative fact consumption", () => {
  test("applied rewrite records declare consumed fact families", () => {
    const rule = createDefaultOptIrRuleCatalog().rules.find(
      (candidate) => candidate.ruleId === "opt-ir.egraph.parser-state-collapse",
    );
    if (rule === undefined) {
      throw new Error("expected parser-state collapse rule");
    }
    const requiredFacts = Array.from(
      { length: minimumFactsForGate(rule.factGate) },
      (_unusedValue, index) => optIrFactId(index + 1),
    );

    const decision = rule.createRewriteRecord({
      recordId: "parser-collapse-record",
      requiredFacts,
      original: optIrRewriteRegionId(1),
      replacement: optIrRewriteRegionId(2),
      origin: optIrOriginId(1),
    });

    expect(decision.consumedFactFamilies).toEqual([
      "erasure",
      "exitClosure",
      "packetSource",
      "privateState",
      "terminalClosure",
      "validatedBuffer",
    ]);
  });

  test("wrela pass explanations declare consumed fact families", () => {
    const type = optIrUnsignedIntegerType(32);
    const result = runWrelaMoveCopyWrapperElisionForTest({
      operations: [
        optIrConstantOperation({
          operationId: optIrOperationId(1),
          resultId: optIrValueId(3),
          constant: optIrIntegerConstant({
            constantId: optIrConstantId(1),
            type,
            normalizedValue: 1n,
          }),
          originId: optIrOriginId(1),
        }),
      ],
      candidates: [
        {
          operationId: optIrOperationId(1),
          sourceValue: optIrValueId(2),
          resultValue: optIrValueId(3),
          kind: "copy",
          ownershipFactIds: ["ownership:1"],
          noaliasFactIds: ["noalias:1"],
          erasureFactIds: ["erasure:1"],
          hasObservableCleanup: false,
        },
      ],
    });

    expect(result.explanations[0]?.consumedFactFamilies).toEqual([
      "ownership",
      "noalias",
      "erasure",
    ]);
  });
});

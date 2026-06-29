import { describe, expect, test } from "bun:test";
import {
  OPT_IR_EFFECT_RULE_IDS,
  OPT_IR_OPERATION_KINDS,
  OPT_IR_TYPE_RULE_IDS,
  defineOptIrInterpreterRuleCatalog,
  defineOptIrSemanticsRuleCatalog,
  optIrOperationKindSet,
} from "../../../src/opt-ir/operation-kinds";
import { optIrInterpreterRuleId, optIrSemanticsRuleId } from "../../../src/opt-ir/ids";

describe("OptIR operation schema ids", () => {
  test("operation schema ids expose exact ordered operation kind catalog", () => {
    expect(OPT_IR_OPERATION_KINDS).toEqual([
      "constant",
      "integerUnary",
      "integerBinary",
      "integerCompare",
      "booleanNot",
      "booleanBinary",
      "aggregateConstruct",
      "aggregateExtract",
      "aggregateInsert",
      "layoutOffset",
      "layoutByteRange",
      "layoutEndianDecode",
      "memoryLoad",
      "memoryStore",
      "sourceCall",
      "runtimeCall",
      "platformCall",
      "intrinsicCall",
      "vectorLoad",
      "vectorStore",
      "vectorMaskedLoad",
      "vectorMaskedStore",
      "vectorShuffle",
      "vectorCompare",
      "vectorSelect",
      "vectorByteSwap",
      "proofErasedMarker",
    ]);

    expect(optIrOperationKindSet()).toEqual(new Set(OPT_IR_OPERATION_KINDS));
  });

  test("operation schema ids expose exact branded type and effect rule catalogs", () => {
    expect(OPT_IR_TYPE_RULE_IDS.map((ruleId) => ruleId as string)).toEqual([
      "constant-has-declared-type",
      "same-integer-width",
      "integer-compare-to-bool",
      "same-boolean",
      "aggregate-field-type",
      "layout-value",
      "memory-load-result",
      "memory-store-unit",
      "call-signature-results",
      "vector-lane-result",
      "proof-erased-no-result",
    ]);

    expect(OPT_IR_EFFECT_RULE_IDS.map((ruleId) => ruleId as string)).toEqual([
      "pure",
      "read-region-version",
      "write-region-version",
      "ordered-region-tokens",
      "call-summary-effects",
      "terminal-effects",
      "proof-erased-no-effect",
    ]);
  });

  test("operation schema ids build branded semantic and interpreter rule catalogs", () => {
    const semanticRules = defineOptIrSemanticsRuleCatalog([
      "constant-literal",
      "integer-add-wrapping",
    ]);
    const interpreterRules = defineOptIrInterpreterRuleCatalog(["constant", "integer-add"]);

    expect(semanticRules).toEqual([
      optIrSemanticsRuleId("constant-literal"),
      optIrSemanticsRuleId("integer-add-wrapping"),
    ]);
    expect(interpreterRules).toEqual([
      optIrInterpreterRuleId("constant"),
      optIrInterpreterRuleId("integer-add"),
    ]);
  });
});

import {
  type OptIrEffectRuleId as BrandedOptIrEffectRuleId,
  type OptIrInterpreterRuleId,
  type OptIrSemanticsRuleId,
  type OptIrTypeRuleId as BrandedOptIrTypeRuleId,
  optIrEffectRuleId,
  optIrInterpreterRuleId,
  optIrSemanticsRuleId,
  optIrTypeRuleId,
} from "./ids";

export const OPT_IR_OPERATION_KINDS = [
  "constant",
  "constAddr",
  "integerUnary",
  "integerBinary",
  "integerCompare",
  "booleanNot",
  "booleanBinary",
  "aggregateConstruct",
  "aggregateExtract",
  "aggregateInsert",
  "enumTagStore",
  "enumPayloadStore",
  "enumTagLoad",
  "enumPayloadLoad",
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
  "semanticAtomic",
  "semanticFence",
  "semanticChecksum",
  "semanticPolynomial",
  "semanticCryptoMix",
  "semanticClassifier",
  "semanticRegionMarker",
  "fpNumeric",
  "proofErasedMarker",
] as const;

export type OptIrOperationKind = (typeof OPT_IR_OPERATION_KINDS)[number];

const OPT_IR_TYPE_RULE_ID_NAMES = [
  "constant-has-declared-type",
  "const-address-has-declared-type",
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
  "enum-access-type",
] as const;

export type OptIrTypeRuleId = (typeof OPT_IR_TYPE_RULE_ID_NAMES)[number] & BrandedOptIrTypeRuleId;

export const OPT_IR_TYPE_RULE_IDS = OPT_IR_TYPE_RULE_ID_NAMES.map((ruleId) =>
  optIrTypeRuleId(ruleId),
) as readonly OptIrTypeRuleId[];

const OPT_IR_EFFECT_RULE_ID_NAMES = [
  "pure",
  "read-region-version",
  "write-region-version",
  "ordered-region-tokens",
  "call-summary-effects",
  "terminal-effects",
  "proof-erased-no-effect",
] as const;

export type OptIrEffectRuleId = (typeof OPT_IR_EFFECT_RULE_ID_NAMES)[number] &
  BrandedOptIrEffectRuleId;

export const OPT_IR_EFFECT_RULE_IDS = OPT_IR_EFFECT_RULE_ID_NAMES.map((ruleId) =>
  optIrEffectRuleId(ruleId),
) as readonly OptIrEffectRuleId[];

export function optIrOperationKindSet(): ReadonlySet<OptIrOperationKind> {
  return new Set(OPT_IR_OPERATION_KINDS);
}

export function defineOptIrSemanticsRuleCatalog<const RuleIds extends readonly string[]>(
  ruleIds: RuleIds,
): { readonly [Index in keyof RuleIds]: OptIrSemanticsRuleId } {
  return ruleIds.map((ruleId) => optIrSemanticsRuleId(ruleId)) as {
    readonly [Index in keyof RuleIds]: OptIrSemanticsRuleId;
  };
}

export function defineOptIrInterpreterRuleCatalog<const RuleIds extends readonly string[]>(
  ruleIds: RuleIds,
): { readonly [Index in keyof RuleIds]: OptIrInterpreterRuleId } {
  return ruleIds.map((ruleId) => optIrInterpreterRuleId(ruleId)) as {
    readonly [Index in keyof RuleIds]: OptIrInterpreterRuleId;
  };
}

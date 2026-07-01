import {
  type OptIrEffectRuleId,
  type OptIrOperationKind,
  type OptIrTypeRuleId,
  OPT_IR_EFFECT_RULE_IDS,
  OPT_IR_TYPE_RULE_IDS,
} from "./operation-kinds";
import {
  optIrInterpreterRuleId,
  optIrSemanticsRuleId,
  type OptIrInterpreterRuleId,
  type OptIrSemanticsRuleId,
} from "./ids";

export type EffectfulOptIrOperationKind = Extract<
  OptIrOperationKind,
  | "memoryLoad"
  | "memoryStore"
  | "sourceCall"
  | "runtimeCall"
  | "platformCall"
  | "intrinsicCall"
  | "vectorLoad"
  | "vectorStore"
  | "vectorMaskedLoad"
  | "vectorMaskedStore"
  | "vectorShuffle"
  | "vectorCompare"
  | "vectorSelect"
  | "vectorByteSwap"
  | "semanticAtomic"
  | "semanticFence"
  | "semanticChecksum"
  | "semanticPolynomial"
  | "semanticCryptoMix"
  | "semanticClassifier"
  | "semanticRegionMarker"
  | "fpNumeric"
  | "proofErasedMarker"
>;

export type OptIrOperandSchemaName =
  | "address"
  | "alignment"
  | "boundsAuthority"
  | "byteOffset"
  | "byteWidth"
  | "callArguments"
  | "callTarget"
  | "endian"
  | "erasedProof"
  | "layoutPath"
  | "mask"
  | "memoryRegion"
  | "resultType"
  | "shuffleIndices"
  | "sourceValues"
  | "storeValue"
  | "vector"
  | "vectorType"
  | "volatility";

export type OptIrResultSchemaName =
  | "callSignatureResults"
  | "memoryLoadedValue"
  | "none"
  | "unit"
  | "vectorCompareMask"
  | "vectorLaneResult"
  | "vectorLoadedValue";

export type OptIrEffectSchemaName =
  | "callSummaryEffects"
  | "none"
  | "pure"
  | "readRegionVersion"
  | "writeRegionVersion";

export type OptIrCanonicalFormName =
  | "canonical-call"
  | "canonical-memory-access"
  | "canonical-proof-erased-marker"
  | "canonical-vector-memory-access"
  | "canonical-vector-operation"
  | "canonical-semantic-operation"
  | "canonical-fp-numeric-operation";

export type OptIrLoweringRequirementName =
  | "erase-before-runtime-lowering"
  | "lower-through-call-surface"
  | "lower-through-memory-surface"
  | "lower-through-semantic-surface"
  | "lower-through-fp-numeric-surface"
  | "lower-through-vector-surface";

export interface EffectfulOptIrOperationSchema {
  readonly kind: EffectfulOptIrOperationKind;
  readonly operandSchema: readonly OptIrOperandSchemaName[];
  readonly resultSchema: OptIrResultSchemaName;
  readonly typeRule: OptIrTypeRuleId;
  readonly semanticsRule: OptIrSemanticsRuleId;
  readonly effectSchema: OptIrEffectSchemaName;
  readonly effectRule: OptIrEffectRuleId;
  readonly interpreterRule: OptIrInterpreterRuleId;
  readonly canonicalForm: OptIrCanonicalFormName;
  readonly loweringRequirement: OptIrLoweringRequirementName;
}

export const EFFECTFUL_OPT_IR_OPERATION_SCHEMA_KINDS = [
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
] as const satisfies readonly EffectfulOptIrOperationKind[];

const MEMORY_ACCESS_OPERANDS = [
  "memoryRegion",
  "byteOffset",
  "byteWidth",
  "alignment",
  "resultType",
  "endian",
  "volatility",
  "layoutPath",
  "boundsAuthority",
] as const;

const CALL_OPERANDS = ["callTarget", "callArguments"] as const;

function catalogEntry<RuleId>(ruleIds: readonly RuleId[], index: number, label: string): RuleId {
  const ruleId = ruleIds[index];
  if (ruleId === undefined) {
    throw new RangeError(`Missing OptIR effectful ${label} rule catalog entry at index ${index}.`);
  }
  return ruleId;
}

function schema(input: EffectfulOptIrOperationSchema): EffectfulOptIrOperationSchema {
  return input;
}

const MEMORY_LOAD_RESULT = catalogEntry(OPT_IR_TYPE_RULE_IDS, 6, "memory-load-result");
const MEMORY_STORE_UNIT = catalogEntry(OPT_IR_TYPE_RULE_IDS, 7, "memory-store-unit");
const CALL_SIGNATURE_RESULTS = catalogEntry(OPT_IR_TYPE_RULE_IDS, 8, "call-signature-results");
const VECTOR_LANE_RESULT = catalogEntry(OPT_IR_TYPE_RULE_IDS, 9, "vector-lane-result");
const PROOF_ERASED_NO_RESULT = catalogEntry(OPT_IR_TYPE_RULE_IDS, 10, "proof-erased-no-result");
const PURE_EFFECT = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 0, "pure");
const READ_REGION_VERSION = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 1, "read-region-version");
const WRITE_REGION_VERSION = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 2, "write-region-version");
const ORDERED_REGION_TOKENS = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 3, "ordered-region-tokens");
const CALL_SUMMARY_EFFECTS = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 4, "call-summary-effects");
const PROOF_ERASED_NO_EFFECT = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 6, "proof-erased-no-effect");

export const EFFECTFUL_OPT_IR_OPERATION_SCHEMAS = [
  schema({
    kind: "memoryLoad",
    operandSchema: MEMORY_ACCESS_OPERANDS,
    resultSchema: "memoryLoadedValue",
    typeRule: MEMORY_LOAD_RESULT,
    semanticsRule: optIrSemanticsRuleId("memory-load"),
    effectSchema: "readRegionVersion",
    effectRule: READ_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("memory-load"),
    canonicalForm: "canonical-memory-access",
    loweringRequirement: "lower-through-memory-surface",
  }),
  schema({
    kind: "memoryStore",
    operandSchema: [...MEMORY_ACCESS_OPERANDS, "storeValue"],
    resultSchema: "unit",
    typeRule: MEMORY_STORE_UNIT,
    semanticsRule: optIrSemanticsRuleId("memory-store"),
    effectSchema: "writeRegionVersion",
    effectRule: WRITE_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("memory-store"),
    canonicalForm: "canonical-memory-access",
    loweringRequirement: "lower-through-memory-surface",
  }),
  schema({
    kind: "sourceCall",
    operandSchema: CALL_OPERANDS,
    resultSchema: "callSignatureResults",
    typeRule: CALL_SIGNATURE_RESULTS,
    semanticsRule: optIrSemanticsRuleId("source-call"),
    effectSchema: "callSummaryEffects",
    effectRule: CALL_SUMMARY_EFFECTS,
    interpreterRule: optIrInterpreterRuleId("source-call"),
    canonicalForm: "canonical-call",
    loweringRequirement: "lower-through-call-surface",
  }),
  schema({
    kind: "runtimeCall",
    operandSchema: CALL_OPERANDS,
    resultSchema: "callSignatureResults",
    typeRule: CALL_SIGNATURE_RESULTS,
    semanticsRule: optIrSemanticsRuleId("runtime-call"),
    effectSchema: "callSummaryEffects",
    effectRule: CALL_SUMMARY_EFFECTS,
    interpreterRule: optIrInterpreterRuleId("runtime-call"),
    canonicalForm: "canonical-call",
    loweringRequirement: "lower-through-call-surface",
  }),
  schema({
    kind: "platformCall",
    operandSchema: CALL_OPERANDS,
    resultSchema: "callSignatureResults",
    typeRule: CALL_SIGNATURE_RESULTS,
    semanticsRule: optIrSemanticsRuleId("platform-call"),
    effectSchema: "callSummaryEffects",
    effectRule: CALL_SUMMARY_EFFECTS,
    interpreterRule: optIrInterpreterRuleId("platform-call"),
    canonicalForm: "canonical-call",
    loweringRequirement: "lower-through-call-surface",
  }),
  schema({
    kind: "intrinsicCall",
    operandSchema: CALL_OPERANDS,
    resultSchema: "callSignatureResults",
    typeRule: CALL_SIGNATURE_RESULTS,
    semanticsRule: optIrSemanticsRuleId("intrinsic-call"),
    effectSchema: "callSummaryEffects",
    effectRule: CALL_SUMMARY_EFFECTS,
    interpreterRule: optIrInterpreterRuleId("intrinsic-call"),
    canonicalForm: "canonical-call",
    loweringRequirement: "lower-through-call-surface",
  }),
  schema({
    kind: "vectorLoad",
    operandSchema: [...MEMORY_ACCESS_OPERANDS, "vectorType"],
    resultSchema: "vectorLoadedValue",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-load"),
    effectSchema: "readRegionVersion",
    effectRule: READ_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("vector-load"),
    canonicalForm: "canonical-vector-memory-access",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorStore",
    operandSchema: [...MEMORY_ACCESS_OPERANDS, "vector", "storeValue"],
    resultSchema: "unit",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-store"),
    effectSchema: "writeRegionVersion",
    effectRule: WRITE_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("vector-store"),
    canonicalForm: "canonical-vector-memory-access",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorMaskedLoad",
    operandSchema: [...MEMORY_ACCESS_OPERANDS, "vectorType", "mask"],
    resultSchema: "vectorLoadedValue",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-masked-load"),
    effectSchema: "readRegionVersion",
    effectRule: READ_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("vector-masked-load"),
    canonicalForm: "canonical-vector-memory-access",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorMaskedStore",
    operandSchema: [...MEMORY_ACCESS_OPERANDS, "vector", "storeValue", "mask"],
    resultSchema: "unit",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-masked-store"),
    effectSchema: "writeRegionVersion",
    effectRule: WRITE_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("vector-masked-store"),
    canonicalForm: "canonical-vector-memory-access",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorShuffle",
    operandSchema: ["sourceValues", "shuffleIndices"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-shuffle"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("vector-shuffle"),
    canonicalForm: "canonical-vector-operation",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorCompare",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorCompareMask",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-compare"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("vector-compare"),
    canonicalForm: "canonical-vector-operation",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorSelect",
    operandSchema: ["mask", "sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-select"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("vector-select"),
    canonicalForm: "canonical-vector-operation",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "vectorByteSwap",
    operandSchema: ["vector", "endian"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("vector-byte-swap"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("vector-byte-swap"),
    canonicalForm: "canonical-vector-operation",
    loweringRequirement: "lower-through-vector-surface",
  }),
  schema({
    kind: "semanticAtomic",
    operandSchema: ["sourceValues"],
    resultSchema: "unit",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-atomic"),
    effectSchema: "writeRegionVersion",
    effectRule: WRITE_REGION_VERSION,
    interpreterRule: optIrInterpreterRuleId("semantic-atomic"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticFence",
    operandSchema: ["sourceValues"],
    resultSchema: "unit",
    typeRule: MEMORY_STORE_UNIT,
    semanticsRule: optIrSemanticsRuleId("semantic-fence"),
    effectSchema: "writeRegionVersion",
    effectRule: ORDERED_REGION_TOKENS,
    interpreterRule: optIrInterpreterRuleId("semantic-fence"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticChecksum",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-checksum"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("semantic-checksum"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticPolynomial",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-polynomial"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("semantic-polynomial"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticCryptoMix",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-crypto-mix"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("semantic-crypto-mix"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticClassifier",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-classifier"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("semantic-classifier"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "semanticRegionMarker",
    operandSchema: ["sourceValues"],
    resultSchema: "none",
    typeRule: PROOF_ERASED_NO_RESULT,
    semanticsRule: optIrSemanticsRuleId("semantic-region-marker"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("semantic-region-marker"),
    canonicalForm: "canonical-semantic-operation",
    loweringRequirement: "lower-through-semantic-surface",
  }),
  schema({
    kind: "fpNumeric",
    operandSchema: ["sourceValues"],
    resultSchema: "vectorLaneResult",
    typeRule: VECTOR_LANE_RESULT,
    semanticsRule: optIrSemanticsRuleId("fp-numeric"),
    effectSchema: "pure",
    effectRule: PURE_EFFECT,
    interpreterRule: optIrInterpreterRuleId("fp-numeric"),
    canonicalForm: "canonical-fp-numeric-operation",
    loweringRequirement: "lower-through-fp-numeric-surface",
  }),
  schema({
    kind: "proofErasedMarker",
    operandSchema: ["erasedProof"],
    resultSchema: "none",
    typeRule: PROOF_ERASED_NO_RESULT,
    semanticsRule: optIrSemanticsRuleId("proof-erased-marker"),
    effectSchema: "none",
    effectRule: PROOF_ERASED_NO_EFFECT,
    interpreterRule: optIrInterpreterRuleId("no-runtime-op"),
    canonicalForm: "canonical-proof-erased-marker",
    loweringRequirement: "erase-before-runtime-lowering",
  }),
] as const satisfies readonly EffectfulOptIrOperationSchema[];

const SCHEMAS_BY_KIND: ReadonlyMap<OptIrOperationKind, EffectfulOptIrOperationSchema> = new Map(
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS.map((schemaRecord) => [schemaRecord.kind, schemaRecord]),
);

export function optIrEffectfulOperationSchemaByKind(
  kind: OptIrOperationKind,
): EffectfulOptIrOperationSchema | undefined {
  return SCHEMAS_BY_KIND.get(kind);
}

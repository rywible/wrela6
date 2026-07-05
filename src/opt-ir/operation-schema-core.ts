import {
  type OptIrCanonicalFormId,
  type OptIrEffectRuleId,
  type OptIrInterpreterRuleId,
  type OptIrSemanticsRuleId,
  type OptIrTypeRuleId,
  optIrCanonicalFormId,
} from "./ids";
import {
  OPT_IR_EFFECT_RULE_IDS,
  type OptIrOperationKind,
  OPT_IR_TYPE_RULE_IDS,
  defineOptIrInterpreterRuleCatalog,
  defineOptIrSemanticsRuleCatalog,
} from "./operation-kinds";

export type OptIrCoreOperationKind =
  | "constant"
  | "constAddr"
  | "integerUnary"
  | "integerBinary"
  | "integerCompare"
  | "booleanNot"
  | "booleanBinary"
  | "aggregateConstruct"
  | "aggregateExtract"
  | "aggregateInsert"
  | "enumTagStore"
  | "enumPayloadStore"
  | "enumTagLoad"
  | "enumPayloadLoad"
  | "layoutOffset"
  | "layoutByteRange"
  | "layoutEndianDecode";

export type OptIrOperationTypeFamily = "aggregate" | "any" | "boolean" | "integer" | "layout";

export type OptIrOperationSchemaCardinality = "one" | "many";

export interface OptIrOperandSchema {
  readonly role: string;
  readonly typeFamily?: OptIrOperationTypeFamily;
  readonly cardinality: OptIrOperationSchemaCardinality;
}

export interface OptIrResultSchema {
  readonly role: string;
  readonly typeFamily?: OptIrOperationTypeFamily;
  readonly cardinality: "one";
}

export type OptIrLoweringRequirement = {
  readonly kind: "core";
};

export interface OptIrOperationSchema {
  readonly operationKind: OptIrCoreOperationKind;
  readonly operandSchema: readonly OptIrOperandSchema[];
  readonly resultSchema: readonly OptIrResultSchema[];
  readonly typeRule: OptIrTypeRuleId;
  readonly semanticsRule: OptIrSemanticsRuleId;
  readonly effectRule: OptIrEffectRuleId;
  readonly interpreterRule: OptIrInterpreterRuleId;
  readonly canonicalForm: OptIrCanonicalFormId;
  readonly loweringRequirement: OptIrLoweringRequirement;
}

const [
  CONSTANT_LITERAL_SEMANTICS,
  CONST_ADDRESS_SEMANTICS,
  INTEGER_UNARY_SEMANTICS,
  INTEGER_BINARY_SEMANTICS,
  INTEGER_COMPARE_SEMANTICS,
  BOOLEAN_NOT_SEMANTICS,
  BOOLEAN_BINARY_SEMANTICS,
  AGGREGATE_CONSTRUCT_SEMANTICS,
  AGGREGATE_EXTRACT_SEMANTICS,
  AGGREGATE_INSERT_SEMANTICS,
  ENUM_TAG_STORE_SEMANTICS,
  ENUM_PAYLOAD_STORE_SEMANTICS,
  ENUM_TAG_LOAD_SEMANTICS,
  ENUM_PAYLOAD_LOAD_SEMANTICS,
  LAYOUT_OFFSET_SEMANTICS,
  LAYOUT_BYTE_RANGE_SEMANTICS,
  LAYOUT_ENDIAN_DECODE_SEMANTICS,
] = defineOptIrSemanticsRuleCatalog([
  "constant-literal",
  "const-address",
  "integer-unary",
  "integer-binary",
  "integer-compare",
  "boolean-not",
  "boolean-binary",
  "aggregate-construct",
  "aggregate-extract",
  "aggregate-insert",
  "enum-tag-store",
  "enum-payload-store",
  "enum-tag-load",
  "enum-payload-load",
  "layout-offset",
  "layout-byte-range",
  "layout-endian-decode",
]);

const [
  CONSTANT_LITERAL_INTERPRETER,
  CONST_ADDRESS_INTERPRETER,
  INTEGER_UNARY_INTERPRETER,
  INTEGER_BINARY_INTERPRETER,
  INTEGER_COMPARE_INTERPRETER,
  BOOLEAN_NOT_INTERPRETER,
  BOOLEAN_BINARY_INTERPRETER,
  AGGREGATE_CONSTRUCT_INTERPRETER,
  AGGREGATE_EXTRACT_INTERPRETER,
  AGGREGATE_INSERT_INTERPRETER,
  ENUM_TAG_STORE_INTERPRETER,
  ENUM_PAYLOAD_STORE_INTERPRETER,
  ENUM_TAG_LOAD_INTERPRETER,
  ENUM_PAYLOAD_LOAD_INTERPRETER,
  LAYOUT_OFFSET_INTERPRETER,
  LAYOUT_BYTE_RANGE_INTERPRETER,
  LAYOUT_ENDIAN_DECODE_INTERPRETER,
] = defineOptIrInterpreterRuleCatalog([
  "constant-literal",
  "const-address",
  "integer-unary",
  "integer-binary",
  "integer-compare",
  "boolean-not",
  "boolean-binary",
  "aggregate-construct",
  "aggregate-extract",
  "aggregate-insert",
  "enum-tag-store",
  "enum-payload-store",
  "enum-tag-load",
  "enum-payload-load",
  "layout-offset",
  "layout-byte-range",
  "layout-endian-decode",
]);

function catalogEntry<RuleId>(ruleIds: readonly RuleId[], index: number, label: string): RuleId {
  const ruleId = ruleIds[index];
  if (ruleId === undefined) {
    throw new RangeError(`Missing OptIR ${label} rule catalog entry at index ${index}.`);
  }
  return ruleId;
}

const CONSTANT_HAS_DECLARED_TYPE = catalogEntry(
  OPT_IR_TYPE_RULE_IDS,
  0,
  "constant-has-declared-type",
);
const CONST_ADDRESS_HAS_DECLARED_TYPE = catalogEntry(
  OPT_IR_TYPE_RULE_IDS,
  1,
  "const-address-has-declared-type",
);
const SAME_INTEGER_WIDTH = catalogEntry(OPT_IR_TYPE_RULE_IDS, 2, "same-integer-width");
const INTEGER_COMPARE_TO_BOOL = catalogEntry(OPT_IR_TYPE_RULE_IDS, 3, "integer-compare-to-bool");
const SAME_BOOLEAN = catalogEntry(OPT_IR_TYPE_RULE_IDS, 4, "same-boolean");
const AGGREGATE_FIELD_TYPE = catalogEntry(OPT_IR_TYPE_RULE_IDS, 5, "aggregate-field-type");
const LAYOUT_VALUE = catalogEntry(OPT_IR_TYPE_RULE_IDS, 6, "layout-value");
const ENUM_ACCESS_TYPE = catalogEntry(OPT_IR_TYPE_RULE_IDS, 12, "enum-access-type");
const PURE_EFFECT = catalogEntry(OPT_IR_EFFECT_RULE_IDS, 0, "pure");
const CORE_LOWERING_REQUIREMENT = Object.freeze({ kind: "core" } as const);

function freezeSchema(schema: OptIrOperationSchema): OptIrOperationSchema {
  return Object.freeze({
    ...schema,
    operandSchema: Object.freeze(schema.operandSchema.map((operand) => Object.freeze(operand))),
    resultSchema: Object.freeze(schema.resultSchema.map((result) => Object.freeze(result))),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  });
}

export const OPT_IR_CORE_OPERATION_SCHEMAS = Object.freeze([
  freezeSchema({
    operationKind: "constant",
    operandSchema: [],
    resultSchema: [{ role: "value", cardinality: "one" }],
    typeRule: CONSTANT_HAS_DECLARED_TYPE,
    semanticsRule: CONSTANT_LITERAL_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: CONSTANT_LITERAL_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(0),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "constAddr",
    operandSchema: [],
    resultSchema: [{ role: "address", cardinality: "one" }],
    typeRule: CONST_ADDRESS_HAS_DECLARED_TYPE,
    semanticsRule: CONST_ADDRESS_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: CONST_ADDRESS_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(1),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "integerUnary",
    operandSchema: [{ role: "operand", typeFamily: "integer", cardinality: "one" }],
    resultSchema: [{ role: "result", typeFamily: "integer", cardinality: "one" }],
    typeRule: SAME_INTEGER_WIDTH,
    semanticsRule: INTEGER_UNARY_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: INTEGER_UNARY_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(2),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "integerBinary",
    operandSchema: [
      { role: "left", typeFamily: "integer", cardinality: "one" },
      { role: "right", typeFamily: "integer", cardinality: "one" },
    ],
    resultSchema: [{ role: "result", typeFamily: "integer", cardinality: "one" }],
    typeRule: SAME_INTEGER_WIDTH,
    semanticsRule: INTEGER_BINARY_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: INTEGER_BINARY_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(3),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "integerCompare",
    operandSchema: [
      { role: "left", typeFamily: "integer", cardinality: "one" },
      { role: "right", typeFamily: "integer", cardinality: "one" },
    ],
    resultSchema: [{ role: "predicate", typeFamily: "boolean", cardinality: "one" }],
    typeRule: INTEGER_COMPARE_TO_BOOL,
    semanticsRule: INTEGER_COMPARE_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: INTEGER_COMPARE_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(4),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "booleanNot",
    operandSchema: [{ role: "operand", typeFamily: "boolean", cardinality: "one" }],
    resultSchema: [{ role: "result", typeFamily: "boolean", cardinality: "one" }],
    typeRule: SAME_BOOLEAN,
    semanticsRule: BOOLEAN_NOT_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: BOOLEAN_NOT_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(5),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "booleanBinary",
    operandSchema: [
      { role: "left", typeFamily: "boolean", cardinality: "one" },
      { role: "right", typeFamily: "boolean", cardinality: "one" },
    ],
    resultSchema: [{ role: "result", typeFamily: "boolean", cardinality: "one" }],
    typeRule: SAME_BOOLEAN,
    semanticsRule: BOOLEAN_BINARY_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: BOOLEAN_BINARY_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(6),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "aggregateConstruct",
    operandSchema: [{ role: "field", typeFamily: "any", cardinality: "many" }],
    resultSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
    typeRule: AGGREGATE_FIELD_TYPE,
    semanticsRule: AGGREGATE_CONSTRUCT_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: AGGREGATE_CONSTRUCT_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(7),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "aggregateExtract",
    operandSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
    resultSchema: [{ role: "field", typeFamily: "any", cardinality: "one" }],
    typeRule: AGGREGATE_FIELD_TYPE,
    semanticsRule: AGGREGATE_EXTRACT_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: AGGREGATE_EXTRACT_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(8),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "aggregateInsert",
    operandSchema: [
      { role: "aggregate", typeFamily: "aggregate", cardinality: "one" },
      { role: "field", typeFamily: "any", cardinality: "one" },
    ],
    resultSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
    typeRule: AGGREGATE_FIELD_TYPE,
    semanticsRule: AGGREGATE_INSERT_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: AGGREGATE_INSERT_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(9),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "enumTagStore",
    operandSchema: [{ role: "tag", typeFamily: "integer", cardinality: "one" }],
    resultSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
    typeRule: ENUM_ACCESS_TYPE,
    semanticsRule: ENUM_TAG_STORE_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: ENUM_TAG_STORE_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(13),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "enumPayloadStore",
    operandSchema: [
      { role: "enum", typeFamily: "any", cardinality: "one" },
      { role: "payload", typeFamily: "any", cardinality: "one" },
    ],
    resultSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
    typeRule: ENUM_ACCESS_TYPE,
    semanticsRule: ENUM_PAYLOAD_STORE_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: ENUM_PAYLOAD_STORE_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(14),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "enumTagLoad",
    operandSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
    resultSchema: [{ role: "tag", typeFamily: "integer", cardinality: "one" }],
    typeRule: ENUM_ACCESS_TYPE,
    semanticsRule: ENUM_TAG_LOAD_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: ENUM_TAG_LOAD_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(15),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "enumPayloadLoad",
    operandSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
    resultSchema: [{ role: "payload", typeFamily: "any", cardinality: "one" }],
    typeRule: ENUM_ACCESS_TYPE,
    semanticsRule: ENUM_PAYLOAD_LOAD_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: ENUM_PAYLOAD_LOAD_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(16),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "layoutOffset",
    operandSchema: [{ role: "base", typeFamily: "layout", cardinality: "one" }],
    resultSchema: [{ role: "offset", typeFamily: "layout", cardinality: "one" }],
    typeRule: LAYOUT_VALUE,
    semanticsRule: LAYOUT_OFFSET_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: LAYOUT_OFFSET_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(10),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "layoutByteRange",
    operandSchema: [{ role: "base", typeFamily: "layout", cardinality: "one" }],
    resultSchema: [{ role: "byteRange", typeFamily: "layout", cardinality: "one" }],
    typeRule: LAYOUT_VALUE,
    semanticsRule: LAYOUT_BYTE_RANGE_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: LAYOUT_BYTE_RANGE_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(11),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
  freezeSchema({
    operationKind: "layoutEndianDecode",
    operandSchema: [{ role: "bytes", typeFamily: "layout", cardinality: "one" }],
    resultSchema: [{ role: "value", typeFamily: "integer", cardinality: "one" }],
    typeRule: LAYOUT_VALUE,
    semanticsRule: LAYOUT_ENDIAN_DECODE_SEMANTICS,
    effectRule: PURE_EFFECT,
    interpreterRule: LAYOUT_ENDIAN_DECODE_INTERPRETER,
    canonicalForm: optIrCanonicalFormId(12),
    loweringRequirement: CORE_LOWERING_REQUIREMENT,
  }),
] satisfies readonly OptIrOperationSchema[]);

const CORE_OPERATION_SCHEMA_BY_KIND = new Map<OptIrOperationKind, OptIrOperationSchema>(
  OPT_IR_CORE_OPERATION_SCHEMAS.map((schema) => [schema.operationKind, schema]),
);

export function optIrCoreOperationSchemaForKind(
  operationKind: OptIrCoreOperationKind,
): OptIrOperationSchema;
export function optIrCoreOperationSchemaForKind(
  operationKind: OptIrOperationKind,
): OptIrOperationSchema | undefined;
export function optIrCoreOperationSchemaForKind(
  operationKind: OptIrOperationKind,
): OptIrOperationSchema | undefined {
  return CORE_OPERATION_SCHEMA_BY_KIND.get(operationKind);
}

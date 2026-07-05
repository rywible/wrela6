import { describe, expect, test } from "bun:test";
import { optIrCanonicalFormId } from "../../../src/opt-ir/ids";
import {
  OPT_IR_EFFECT_RULE_IDS,
  OPT_IR_OPERATION_KINDS,
  OPT_IR_TYPE_RULE_IDS,
} from "../../../src/opt-ir/operation-kinds";
import {
  OPT_IR_CORE_OPERATION_SCHEMAS,
  optIrCoreOperationSchemaForKind,
} from "../../../src/opt-ir/operation-schema-core";

const CORE_OPERATION_KINDS = [
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
] as const;

describe("OptIR core operation schemas", () => {
  test("core schema registry is closed to constant, scalar, aggregate, and layout operations", () => {
    expect(OPT_IR_CORE_OPERATION_SCHEMAS.map((schema) => schema.operationKind)).toEqual([
      ...CORE_OPERATION_KINDS,
    ]);

    expect(
      OPT_IR_CORE_OPERATION_SCHEMAS.every((schema) =>
        OPT_IR_OPERATION_KINDS.includes(schema.operationKind),
      ),
    ).toBe(true);
  });

  test("core schemas name validation, semantics, interpreter, canonical, and lowering rules", () => {
    expect(OPT_IR_CORE_OPERATION_SCHEMAS).toMatchObject([
      {
        operationKind: "constant",
        operandSchema: [],
        resultSchema: [{ role: "value", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[0],
        semanticsRule: "constant-literal",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "constant-literal",
        canonicalForm: optIrCanonicalFormId(0),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "constAddr",
        operandSchema: [],
        resultSchema: [{ role: "address", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[1],
        semanticsRule: "const-address",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "const-address",
        canonicalForm: optIrCanonicalFormId(1),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "integerUnary",
        operandSchema: [{ role: "operand", typeFamily: "integer", cardinality: "one" }],
        resultSchema: [{ role: "result", typeFamily: "integer", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[2],
        semanticsRule: "integer-unary",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "integer-unary",
        canonicalForm: optIrCanonicalFormId(2),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "integerBinary",
        operandSchema: [
          { role: "left", typeFamily: "integer", cardinality: "one" },
          { role: "right", typeFamily: "integer", cardinality: "one" },
        ],
        resultSchema: [{ role: "result", typeFamily: "integer", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[2],
        semanticsRule: "integer-binary",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "integer-binary",
        canonicalForm: optIrCanonicalFormId(3),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "integerCompare",
        operandSchema: [
          { role: "left", typeFamily: "integer", cardinality: "one" },
          { role: "right", typeFamily: "integer", cardinality: "one" },
        ],
        resultSchema: [{ role: "predicate", typeFamily: "boolean", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[3],
        semanticsRule: "integer-compare",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "integer-compare",
        canonicalForm: optIrCanonicalFormId(4),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "booleanNot",
        operandSchema: [{ role: "operand", typeFamily: "boolean", cardinality: "one" }],
        resultSchema: [{ role: "result", typeFamily: "boolean", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[4],
        semanticsRule: "boolean-not",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "boolean-not",
        canonicalForm: optIrCanonicalFormId(5),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "booleanBinary",
        operandSchema: [
          { role: "left", typeFamily: "boolean", cardinality: "one" },
          { role: "right", typeFamily: "boolean", cardinality: "one" },
        ],
        resultSchema: [{ role: "result", typeFamily: "boolean", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[4],
        semanticsRule: "boolean-binary",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "boolean-binary",
        canonicalForm: optIrCanonicalFormId(6),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "aggregateConstruct",
        operandSchema: [{ role: "field", typeFamily: "any", cardinality: "many" }],
        resultSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[5],
        semanticsRule: "aggregate-construct",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "aggregate-construct",
        canonicalForm: optIrCanonicalFormId(7),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "aggregateExtract",
        operandSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
        resultSchema: [{ role: "field", typeFamily: "any", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[5],
        semanticsRule: "aggregate-extract",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "aggregate-extract",
        canonicalForm: optIrCanonicalFormId(8),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "aggregateInsert",
        operandSchema: [
          { role: "aggregate", typeFamily: "aggregate", cardinality: "one" },
          { role: "field", typeFamily: "any", cardinality: "one" },
        ],
        resultSchema: [{ role: "aggregate", typeFamily: "aggregate", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[5],
        semanticsRule: "aggregate-insert",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "aggregate-insert",
        canonicalForm: optIrCanonicalFormId(9),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "enumTagStore",
        operandSchema: [{ role: "tag", typeFamily: "integer", cardinality: "one" }],
        resultSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[12],
        semanticsRule: "enum-tag-store",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "enum-tag-store",
        canonicalForm: optIrCanonicalFormId(13),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "enumPayloadStore",
        operandSchema: [
          { role: "enum", typeFamily: "any", cardinality: "one" },
          { role: "payload", typeFamily: "any", cardinality: "one" },
        ],
        resultSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[12],
        semanticsRule: "enum-payload-store",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "enum-payload-store",
        canonicalForm: optIrCanonicalFormId(14),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "enumTagLoad",
        operandSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
        resultSchema: [{ role: "tag", typeFamily: "integer", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[12],
        semanticsRule: "enum-tag-load",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "enum-tag-load",
        canonicalForm: optIrCanonicalFormId(15),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "enumPayloadLoad",
        operandSchema: [{ role: "enum", typeFamily: "any", cardinality: "one" }],
        resultSchema: [{ role: "payload", typeFamily: "any", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[12],
        semanticsRule: "enum-payload-load",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "enum-payload-load",
        canonicalForm: optIrCanonicalFormId(16),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "layoutOffset",
        operandSchema: [{ role: "base", typeFamily: "layout", cardinality: "one" }],
        resultSchema: [{ role: "offset", typeFamily: "layout", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[6],
        semanticsRule: "layout-offset",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "layout-offset",
        canonicalForm: optIrCanonicalFormId(10),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "layoutByteRange",
        operandSchema: [{ role: "base", typeFamily: "layout", cardinality: "one" }],
        resultSchema: [{ role: "byteRange", typeFamily: "layout", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[6],
        semanticsRule: "layout-byte-range",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "layout-byte-range",
        canonicalForm: optIrCanonicalFormId(11),
        loweringRequirement: { kind: "core" },
      },
      {
        operationKind: "layoutEndianDecode",
        operandSchema: [{ role: "bytes", typeFamily: "layout", cardinality: "one" }],
        resultSchema: [{ role: "value", typeFamily: "integer", cardinality: "one" }],
        typeRule: OPT_IR_TYPE_RULE_IDS[6],
        semanticsRule: "layout-endian-decode",
        effectRule: OPT_IR_EFFECT_RULE_IDS[0],
        interpreterRule: "layout-endian-decode",
        canonicalForm: optIrCanonicalFormId(12),
        loweringRequirement: { kind: "core" },
      },
    ]);
  });

  test("core schema lookup is deterministic, closed, and immutable", () => {
    for (const operationKind of CORE_OPERATION_KINDS) {
      const schema = optIrCoreOperationSchemaForKind(operationKind);
      const registeredSchema = OPT_IR_CORE_OPERATION_SCHEMAS.find(
        (candidate) => candidate.operationKind === operationKind,
      );

      expect(registeredSchema).toBeDefined();
      if (registeredSchema === undefined) {
        throw new Error(`Missing core operation schema for ${operationKind}.`);
      }
      expect(schema).toBe(registeredSchema);
      expect(Object.isFrozen(schema)).toBe(true);
      expect(Object.isFrozen(schema.operandSchema)).toBe(true);
      expect(Object.isFrozen(schema.resultSchema)).toBe(true);
    }

    expect(optIrCoreOperationSchemaForKind("memoryLoad")).toBeUndefined();
  });
});

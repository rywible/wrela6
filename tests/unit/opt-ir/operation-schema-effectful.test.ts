import { describe, expect, test } from "bun:test";
import {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMA_KINDS,
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  optIrEffectfulOperationSchemaByKind,
} from "../../../src/opt-ir/operation-schema-effectful";

const EXPECTED_EFFECTFUL_KINDS = [
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

describe("effectful OptIR operation schemas", () => {
  test("defines the exact memory, call, vector, and proof-erased schema records", () => {
    expect(Array.from(EFFECTFUL_OPT_IR_OPERATION_SCHEMA_KINDS)).toEqual(
      Array.from(EXPECTED_EFFECTFUL_KINDS),
    );
    expect(EFFECTFUL_OPT_IR_OPERATION_SCHEMAS.map((schema) => schema.kind)).toEqual(
      Array.from(EXPECTED_EFFECTFUL_KINDS),
    );
  });

  test("schema records name every required contract field", () => {
    for (const schema of EFFECTFUL_OPT_IR_OPERATION_SCHEMAS) {
      expect(schema.operandSchema.length).toBeGreaterThan(0);
      expect(schema.resultSchema).toBeDefined();
      expect(schema.typeRule).toBeDefined();
      expect(schema.semanticsRule).toBeDefined();
      expect(schema.effectRule).toBeDefined();
      expect(schema.interpreterRule).toBeDefined();
      expect(schema.canonicalForm).toBeDefined();
      expect(schema.loweringRequirement).toBeDefined();
    }
  });

  test("uses exact contract rule ids for memory and call operations", () => {
    expect(optIrEffectfulOperationSchemaByKind("memoryLoad")).toMatchObject({
      typeRule: "memory-load-result",
      effectRule: "read-region-version",
    });
    expect(optIrEffectfulOperationSchemaByKind("memoryStore")).toMatchObject({
      typeRule: "memory-store-unit",
      effectRule: "write-region-version",
    });

    for (const kind of ["sourceCall", "runtimeCall", "platformCall", "intrinsicCall"] as const) {
      expect(optIrEffectfulOperationSchemaByKind(kind)).toMatchObject({
        typeRule: "call-signature-results",
        effectRule: "call-summary-effects",
      });
    }
  });

  test("uses exact contract rule ids for vector operations", () => {
    for (const kind of [
      "vectorLoad",
      "vectorStore",
      "vectorMaskedLoad",
      "vectorMaskedStore",
      "vectorShuffle",
      "vectorCompare",
      "vectorSelect",
      "vectorByteSwap",
    ] as const) {
      expect(optIrEffectfulOperationSchemaByKind(kind)).toMatchObject({
        typeRule: "vector-lane-result",
      });
    }

    expect(optIrEffectfulOperationSchemaByKind("vectorLoad")).toMatchObject({
      effectRule: "read-region-version",
    });
    expect(optIrEffectfulOperationSchemaByKind("vectorStore")).toMatchObject({
      effectRule: "write-region-version",
    });
    expect(optIrEffectfulOperationSchemaByKind("vectorMaskedLoad")).toMatchObject({
      effectRule: "read-region-version",
    });
    expect(optIrEffectfulOperationSchemaByKind("vectorMaskedStore")).toMatchObject({
      effectRule: "write-region-version",
    });

    for (const kind of [
      "vectorShuffle",
      "vectorCompare",
      "vectorSelect",
      "vectorByteSwap",
    ] as const) {
      expect(optIrEffectfulOperationSchemaByKind(kind)).toMatchObject({
        effectRule: "pure",
      });
    }
  });

  test("registry lookup is closed and deterministic by operation kind", () => {
    const firstLookups = EXPECTED_EFFECTFUL_KINDS.map((kind) =>
      optIrEffectfulOperationSchemaByKind(kind),
    );
    const secondLookups = EXPECTED_EFFECTFUL_KINDS.map((kind) =>
      optIrEffectfulOperationSchemaByKind(kind),
    );

    expect(firstLookups).toEqual(Array.from(EFFECTFUL_OPT_IR_OPERATION_SCHEMAS));
    expect(secondLookups).toEqual(firstLookups);
    expect(optIrEffectfulOperationSchemaByKind("constant")).toBeUndefined();
  });

  test("proof-erased marker has no runtime result or effect schema", () => {
    expect(optIrEffectfulOperationSchemaByKind("proofErasedMarker")).toMatchObject({
      operandSchema: ["erasedProof"],
      resultSchema: "none",
      typeRule: "proof-erased-no-result",
      effectSchema: "none",
      effectRule: "proof-erased-no-effect",
      interpreterRule: "no-runtime-op",
      loweringRequirement: "erase-before-runtime-lowering",
    });
  });

  test("semantic fence is an ordered effect boundary rather than pure metadata", () => {
    expect(optIrEffectfulOperationSchemaByKind("semanticFence")).toMatchObject({
      resultSchema: "unit",
      effectSchema: "writeRegionVersion",
      effectRule: "ordered-region-tokens",
      interpreterRule: "semantic-fence",
      loweringRequirement: "lower-through-semantic-surface",
    });
  });
});

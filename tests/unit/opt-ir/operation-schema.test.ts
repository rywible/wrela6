import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import {
  OPT_IR_EFFECT_RULE_IDS,
  OPT_IR_OPERATION_KINDS,
  OPT_IR_TYPE_RULE_IDS,
  defineOptIrInterpreterRuleCatalog,
  defineOptIrSemanticsRuleCatalog,
  optIrOperationKindSet,
} from "../../../src/opt-ir/operation-kinds";
import {
  defineOptIrOperation,
  optIrBooleanBinaryOperation,
  optIrConstantOperation,
  optIrMemoryLoadOperation,
  optIrProofErasedMarkerOperation,
  optIrSourceCallOperation,
  optIrVectorShuffleOperation,
} from "../../../src/opt-ir/operations";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import {
  optIrEffectRuleId,
  optIrInterpreterRuleId,
  optIrSemanticsRuleId,
} from "../../../src/opt-ir/ids";
import {
  optIrCallId,
  optIrConstantId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrBooleanType, optIrSignedIntegerType, optIrUnitType } from "../../../src/opt-ir/types";

describe("OptIR operation schema ids", () => {
  test("operation schema ids expose exact ordered operation kind catalog", () => {
    expect(OPT_IR_OPERATION_KINDS).toEqual([
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
    ]);

    expect(optIrOperationKindSet()).toEqual(new Set(OPT_IR_OPERATION_KINDS));
  });

  test("operation schema ids expose exact branded type and effect rule catalogs", () => {
    expect(OPT_IR_TYPE_RULE_IDS.map((ruleId) => ruleId as string)).toEqual([
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

describe("OptIR operation constructors", () => {
  test("constructors derive result types, semantics, and effects from schema metadata", () => {
    const integerType = optIrSignedIntegerType(32);
    const constant = optIrIntegerConstant({
      constantId: optIrConstantId(0),
      type: integerType,
      normalizedValue: 7n,
    });

    const constantOperation = optIrConstantOperation({
      operationId: optIrOperationId(0),
      resultId: optIrValueId(0),
      constant,
      originId: optIrOriginId(0),
      displayName: "late-renamed-constant",
    });

    expect(constantOperation.resultTypes).toEqual([integerType]);
    expect(constantOperation.semantics.semanticsRule).toBe(
      optIrSemanticsRuleId("constant-literal"),
    );
    expect(constantOperation.effects.effectRule).toBe(optIrEffectRuleId("pure"));
    expect(constantOperation.effects.isRuntimePure).toBe(true);

    const booleanOperation = optIrBooleanBinaryOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(1),
      left: optIrValueId(2),
      right: optIrValueId(3),
      operator: "and",
      originId: optIrOriginId(0),
    });

    expect(booleanOperation.resultTypes).toEqual([optIrBooleanType()]);
    expect(booleanOperation.semantics.semanticsRule).toBe(optIrSemanticsRuleId("boolean-binary"));
    expect(booleanOperation.effects.isRuntimePure).toBe(true);

    const callOperation = optIrSourceCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(0),
      target: { kind: "source", functionInstanceId: monoInstanceId("source-instance") },
      argumentIds: [optIrValueId(4)],
      resultIds: [optIrValueId(5)],
      resultTypes: [integerType, optIrUnitType()],
      originId: optIrOriginId(0),
    });

    expect(callOperation.resultTypes).toEqual([integerType, optIrUnitType()]);
    expect(callOperation.semantics.semanticsRule).toBe(optIrSemanticsRuleId("source-call"));
    expect(callOperation.effects.usesCallSummary).toBe(true);
  });

  test("constructors cover vector and proof-erased operation variants with closed metadata", () => {
    const shuffle = optIrVectorShuffleOperation({
      operationId: optIrOperationId(3),
      sourceValueIds: [optIrValueId(0), optIrValueId(1)],
      shuffleIndices: [1, 0],
      resultId: optIrValueId(2),
      resultType: { kind: "vector", laneType: optIrSignedIntegerType(16), laneCount: 2 },
      originId: optIrOriginId(1),
    });

    expect(shuffle.kind).toBe("vectorShuffle");
    expect(shuffle.resultTypes).toEqual([
      { kind: "vector", laneType: optIrSignedIntegerType(16), laneCount: 2 },
    ]);
    expect(shuffle.effects.isRuntimePure).toBe(true);

    const marker = optIrProofErasedMarkerOperation({
      operationId: optIrOperationId(4),
      erasedProof: "range-proof",
      originId: optIrOriginId(1),
    });

    expect(marker.kind).toBe("proofErasedMarker");
    expect(marker.resultTypes).toEqual([]);
    expect(marker.semantics.interpreterRule).toBe(optIrInterpreterRuleId("no-runtime-op"));
    expect(marker.effects.effectRule).toBe(optIrEffectRuleId("proof-erased-no-effect"));
  });

  test("constructors require memory bounds authority and fail closed without it", () => {
    const layoutPath = layoutFactKey("payload.header.length");
    const missingAuthority = optIrMemoryLoadOperation({
      operationId: optIrOperationId(5),
      resultId: optIrValueId(0),
      region: optIrRegionId(0),
      byteOffset: 8n,
      byteWidth: 4,
      alignment: 4,
      valueType: optIrSignedIntegerType(32),
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: undefined,
      originId: optIrOriginId(2),
    });

    expect(missingAuthority.kind).toBe("error");
    if (missingAuthority.kind !== "error") {
      throw new Error("Expected missing bounds authority to fail closed.");
    }
    expect(missingAuthority.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      optIrDiagnosticCode("OPT_IR_MISSING_BOUNDS_AUTHORITY"),
    ]);

    const authorized = optIrMemoryLoadOperation({
      operationId: optIrOperationId(6),
      resultId: optIrValueId(1),
      region: optIrRegionId(0),
      byteOffset: 8n,
      byteWidth: 4,
      alignment: 4,
      valueType: optIrSignedIntegerType(32),
      endian: "little",
      volatility: "volatile",
      layoutPath,
      boundsAuthority: { kind: "certifiedFact", factId: optIrFactId(1) },
      originId: optIrOriginId(2),
    });

    expect(authorized.kind).toBe("ok");
    if (authorized.kind !== "ok") {
      throw new Error("Expected authorized memory load.");
    }
    if (authorized.operation.kind !== "memoryLoad") {
      throw new Error("Expected authorized memory load operation.");
    }
    expect(authorized.operation.resultTypes).toEqual([optIrSignedIntegerType(32)]);
    expect(authorized.operation.memoryAccess).toEqual({
      region: optIrRegionId(0),
      byteOffset: 8n,
      byteWidth: 4,
      alignment: 4,
      valueType: optIrSignedIntegerType(32),
      endian: "little",
      volatility: "volatile",
      layoutPath,
      boundsAuthority: { kind: "certifiedFact", factId: optIrFactId(1) },
    });
    expect(authorized.operation.effects.readsRegionVersion).toBe(true);
  });

  test("constructors recompute stable metadata independently of display names", () => {
    const integerType = optIrSignedIntegerType(64);
    const left = defineOptIrOperation({
      kind: "integerBinary",
      operationId: optIrOperationId(7),
      operandIds: [optIrValueId(0), optIrValueId(1)],
      resultIds: [optIrValueId(2)],
      resultTypes: [integerType],
      attributes: { operator: "add" },
      originId: optIrOriginId(3),
      displayName: "first name",
    });
    const right = defineOptIrOperation({
      kind: "integerBinary",
      operationId: optIrOperationId(7),
      operandIds: [optIrValueId(0), optIrValueId(1)],
      resultIds: [optIrValueId(2)],
      resultTypes: [integerType],
      attributes: { operator: "add" },
      originId: optIrOriginId(3),
      displayName: "renamed during debugging",
    });

    expect(left.stableKey).toBe("integerBinary");
    expect(right.stableKey).toBe("integerBinary");
    expect(left.semantics).toEqual(right.semantics);
    expect(left.effects).toEqual(right.effects);
  });
});

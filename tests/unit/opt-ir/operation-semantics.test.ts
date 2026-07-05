import { describe, expect, test } from "bun:test";
import { optIrCanonicalFormId } from "../../../src/opt-ir/ids";
import {
  deriveOptIrOperationEffectMetadata,
  optIrOperationEffectMetadataForKind,
} from "../../../src/opt-ir/operation-effects";
import {
  OPT_IR_EFFECT_RULE_IDS,
  OPT_IR_OPERATION_KINDS,
  type OptIrEffectRuleId,
} from "../../../src/opt-ir/operation-kinds";
import {
  OPT_IR_CORE_OPERATION_SCHEMAS,
  type OptIrOperationSchema,
} from "../../../src/opt-ir/operation-schema-core";
import {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  type EffectfulOptIrOperationSchema,
} from "../../../src/opt-ir/operation-schema-effectful";
import {
  deriveOptIrOperationSemanticsMetadata,
  optIrOperationSemanticsMetadataForKind,
} from "../../../src/opt-ir/operation-semantics";

const PURE_CORE_KINDS = [
  "constant",
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

function effectRuleAt(index: number): OptIrEffectRuleId {
  const effectRule = OPT_IR_EFFECT_RULE_IDS[index];
  if (effectRule === undefined) {
    throw new Error(`Missing effect rule fixture at index ${index}.`);
  }
  return effectRule;
}

describe("OptIR operation metadata derivation", () => {
  test("derives deterministic semantics metadata for the closed core and effectful registries", () => {
    const first = deriveOptIrOperationSemanticsMetadata({
      coreSchemas: OPT_IR_CORE_OPERATION_SCHEMAS,
      effectfulSchemas: EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
    });
    const second = deriveOptIrOperationSemanticsMetadata({
      effectfulSchemas: [...EFFECTFUL_OPT_IR_OPERATION_SCHEMAS].reverse(),
      coreSchemas: [...OPT_IR_CORE_OPERATION_SCHEMAS].reverse(),
    });

    expect(first.map((metadata) => metadata.operationKind)).toEqual([...OPT_IR_OPERATION_KINDS]);
    expect(second).toEqual(first);
    expect(optIrOperationSemanticsMetadataForKind("constant")).toMatchObject({
      operationKind: "constant",
      stableKey: "constant",
      semanticsRule: "constant-literal",
      interpreterRule: "constant-literal",
      canonicalForm: optIrCanonicalFormId(0),
      loweringRequirement: { kind: "core" },
    });
    expect(optIrOperationSemanticsMetadataForKind("sourceCall")).toMatchObject({
      operationKind: "sourceCall",
      stableKey: "sourceCall",
      semanticsRule: "source-call",
      interpreterRule: "source-call",
      canonicalForm: "canonical-call",
      loweringRequirement: "lower-through-call-surface",
    });
  });

  test("derives effect metadata without caller-authored purity flags", () => {
    for (const kind of PURE_CORE_KINDS) {
      expect(optIrOperationEffectMetadataForKind(kind)).toMatchObject({
        operationKind: kind,
        runtimeEffect: "none",
        isRuntimePure: true,
        readsRegionVersion: false,
        writesRegionVersion: false,
        usesCallSummary: false,
      });
    }

    expect(optIrOperationEffectMetadataForKind("memoryLoad")).toMatchObject({
      runtimeEffect: "readRegionVersion",
      effectRule: "read-region-version",
      isRuntimePure: false,
      readsRegionVersion: true,
      writesRegionVersion: false,
      usesCallSummary: false,
    });
    expect(optIrOperationEffectMetadataForKind("memoryStore")).toMatchObject({
      runtimeEffect: "writeRegionVersion",
      effectRule: "write-region-version",
      isRuntimePure: false,
      readsRegionVersion: false,
      writesRegionVersion: true,
      usesCallSummary: false,
    });
    expect(optIrOperationEffectMetadataForKind("runtimeCall")).toMatchObject({
      runtimeEffect: "callSummaryEffects",
      effectRule: "call-summary-effects",
      isRuntimePure: false,
      usesCallSummary: true,
    });
  });

  test("classifies vector pure operations separately from vector memory effects", () => {
    for (const kind of [
      "vectorShuffle",
      "vectorCompare",
      "vectorSelect",
      "vectorByteSwap",
    ] as const) {
      expect(optIrOperationEffectMetadataForKind(kind)).toMatchObject({
        operationKind: kind,
        runtimeEffect: "none",
        isRuntimePure: true,
      });
    }

    expect(optIrOperationEffectMetadataForKind("vectorLoad")).toMatchObject({
      runtimeEffect: "readRegionVersion",
      readsRegionVersion: true,
      isRuntimePure: false,
    });
    expect(optIrOperationEffectMetadataForKind("vectorMaskedStore")).toMatchObject({
      runtimeEffect: "writeRegionVersion",
      writesRegionVersion: true,
      isRuntimePure: false,
    });
  });

  test("classifies every closed effect rule even before every rule has a production operation", () => {
    const orderedRegionTokens = effectRuleAt(3);
    const terminalEffects = effectRuleAt(5);
    const effectfulSchemas = EFFECTFUL_OPT_IR_OPERATION_SCHEMAS.map((schema) => {
      if (schema.kind === "memoryLoad") {
        return { ...schema, effectRule: orderedRegionTokens };
      }
      if (schema.kind === "platformCall") {
        return { ...schema, effectRule: terminalEffects };
      }
      return schema;
    });

    const metadata = deriveOptIrOperationEffectMetadata({
      coreSchemas: OPT_IR_CORE_OPERATION_SCHEMAS,
      effectfulSchemas,
    });

    expect(metadata.find((entry) => entry.operationKind === "memoryLoad")).toMatchObject({
      runtimeEffect: "orderedRegionTokens",
      usesOrderedRegionTokens: true,
      isRuntimePure: false,
    });
    expect(metadata.find((entry) => entry.operationKind === "platformCall")).toMatchObject({
      runtimeEffect: "terminalEffects",
      hasTerminalEffects: true,
      isRuntimePure: false,
    });
  });

  test("treats proof-erased markers as no runtime effect", () => {
    expect(optIrOperationEffectMetadataForKind("proofErasedMarker")).toMatchObject({
      runtimeEffect: "none",
      effectRule: "proof-erased-no-effect",
      isRuntimePure: true,
      readsRegionVersion: false,
      writesRegionVersion: false,
      usesCallSummary: false,
    });
  });

  test("ignores operation display names while recomputing metadata", () => {
    const renamedCoreSchemas = OPT_IR_CORE_OPERATION_SCHEMAS.map((schema, index) => ({
      ...schema,
      displayName: `core display ${index}`,
    })) as readonly (OptIrOperationSchema & { readonly displayName: string })[];
    const renamedEffectfulSchemas = EFFECTFUL_OPT_IR_OPERATION_SCHEMAS.map((schema, index) => ({
      ...schema,
      displayName: `effectful display ${index}`,
    })) as readonly (EffectfulOptIrOperationSchema & { readonly displayName: string })[];

    expect(
      deriveOptIrOperationSemanticsMetadata({
        coreSchemas: renamedCoreSchemas,
        effectfulSchemas: renamedEffectfulSchemas,
      }),
    ).toEqual(
      deriveOptIrOperationSemanticsMetadata({
        coreSchemas: OPT_IR_CORE_OPERATION_SCHEMAS,
        effectfulSchemas: EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
      }),
    );
    expect(
      deriveOptIrOperationEffectMetadata({
        coreSchemas: renamedCoreSchemas,
        effectfulSchemas: renamedEffectfulSchemas,
      }),
    ).toEqual(
      deriveOptIrOperationEffectMetadata({
        coreSchemas: OPT_IR_CORE_OPERATION_SCHEMAS,
        effectfulSchemas: EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
      }),
    );
  });
});

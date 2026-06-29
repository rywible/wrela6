import { describe, expect, test } from "bun:test";

import {
  createFakeOptIrTranslationValidationEffects,
  createFakeOptIrTranslationValidationMemory,
  validateOptIrEGraphTranslation,
} from "../../../src/opt-ir/egraph/translation-validation";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrConstantId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrInterpreterSlice } from "../../../src/opt-ir/interpreter";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR e-graph translation validation", () => {
  test("derives stable finite inputs from constants, ranges, layout bounds, masks, and integer edges", () => {
    const original = returningSlice([constant(1, 10, 8n), constant(2, 11, 7n), add(3, 12, 10, 11)]);
    const replacement = returningSlice([
      constant(1, 10, 8n),
      constant(2, 11, 7n),
      add(3, 12, 10, 11),
    ]);

    const result = validateOptIrEGraphTranslation({
      original,
      replacement,
      validationContext: {
        operandTypes: [{ valueId: optIrValueId(20), type: optIrUnsignedIntegerType(8) }],
        constants: [0n, 7n],
        rangeFacts: [{ valueId: optIrValueId(20), minimum: 3n, maximum: 5n }],
        layoutBounds: [{ start: 2n, endExclusive: 6n }],
        masks: [0xf0n],
      },
    });

    expect(result.kind).toBe("passed");
    if (result.kind !== "passed") {
      throw new Error("expected translation validation to pass");
    }
    expect(result.inputSet.map((input) => input.stableKey)).toEqual([
      "case:0:0,1,2,3,5,6,7,8,127,128,224,240,255",
    ]);
  });

  test("uses injected fake regions and traces for memory and effect slices", () => {
    const load = memoryLoad(1, 10, 4n);
    const original = returningSlice([load]);
    const replacement = returningSlice([load]);
    const effectEvents: string[][] = [];

    const result = validateOptIrEGraphTranslation({
      original,
      replacement,
      validationContext: { constants: [0x1234n] },
      memoryFactory: (input) =>
        createFakeOptIrTranslationValidationMemory({
          regionValues: [[`${Number(optIrRegionId(1))}:4:2`, input.values[0] ?? 0n]],
          valueType: optIrUnsignedIntegerType(16),
        }),
      effectsFactory: () => {
        const trace = createFakeOptIrTranslationValidationEffects();
        return {
          record: trace.record,
          snapshot: () => {
            const snapshot = trace.snapshot();
            effectEvents.push([...snapshot]);
            return snapshot;
          },
        };
      },
    });

    expect(result.kind).toBe("passed");
    expect(effectEvents).toEqual([["read:1:4:2"], ["read:1:4:2"]]);
  });

  test("rejects interpreter-complete disagreements with stable diagnostics", () => {
    const original = returningSlice([constant(1, 10, 1n)]);
    const replacement = returningSlice([constant(1, 10, 2n)]);

    const result = validateOptIrEGraphTranslation({
      original,
      replacement,
      validationContext: { constants: [1n, 2n] },
    });

    expect(result).toMatchObject({
      kind: "failed",
      reason: "interpreter-disagreement",
    });
    if (result.kind !== "failed") {
      throw new Error("expected failed validation");
    }
    expect(result.disagreements.map((disagreement) => disagreement.stableKey)).toEqual([
      "translation-validation:case:0:0,1,2,3",
    ]);
  });

  test("records catalog-approved notApplicable reasons for non-interpreter-complete slices", () => {
    const opaque = optIrRuntimeCallOperation({
      operationId: optIrOperationId(1),
      callId: 1 as never,
      target: { kind: "runtime", runtimeKey: "opaque.callback" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });

    const result = validateOptIrEGraphTranslation({
      original: returningSlice([opaque]),
      replacement: returningSlice([opaque]),
      validationContext: {},
      approvedNotApplicableReasons: ["unsupported-interpreter-rule:runtime-call"],
    });

    expect(result).toEqual({
      kind: "notApplicable",
      reasons: ["unsupported-interpreter-rule:runtime-call"],
    });
  });

  test("rejects non-interpreter-complete slices without catalog approval", () => {
    const opaque = optIrRuntimeCallOperation({
      operationId: optIrOperationId(1),
      callId: 1 as never,
      target: { kind: "runtime", runtimeKey: "opaque.callback" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });

    const result = validateOptIrEGraphTranslation({
      original: returningSlice([opaque]),
      replacement: returningSlice([opaque]),
      validationContext: {},
      approvedNotApplicableReasons: [],
    });

    expect(result).toEqual({
      kind: "failed",
      reason: "unapproved-not-applicable-reason",
      disagreements: [],
      unapprovedReasons: ["unsupported-interpreter-rule:runtime-call"],
    });
  });
});

function returningSlice(operations: readonly OptIrOperation[]): OptIrInterpreterSlice {
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return",
      operationId: optIrOperationId(100),
      values: operations.at(-1)?.resultIds ?? [],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  return {
    entryBlock: block.blockId,
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    operations,
  };
}

function constant(operation: number, result: number, value: bigint): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operation),
      type: optIrUnsignedIntegerType(8),
      normalizedValue: value,
    }),
    originId: optIrOriginId(1),
  });
}

function add(operation: number, result: number, left: number, right: number): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator: "add",
    resultType: optIrUnsignedIntegerType(8),
    originId: optIrOriginId(1),
  });
}

function memoryLoad(operation: number, result: number, byteOffset: bigint): OptIrOperation {
  const constructed = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    region: optIrRegionId(1),
    byteOffset,
    byteWidth: 2,
    alignment: 2,
    valueType: optIrUnsignedIntegerType(16),
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "test" },
    originId: optIrOriginId(1),
  });
  if (constructed.kind !== "ok") {
    throw new Error("expected memory load fixture");
  }
  return constructed.operation;
}

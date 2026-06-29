import { describe, expect, test } from "bun:test";
import {
  optIrCallId,
  optIrInterpreterRuleId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  interpretOptIrSlice,
  validateOptIrSliceIsInterpreterComplete,
} from "../../../src/opt-ir/interpreter";
import { optIrSourceCallOperation } from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  constantOperationForTest,
  fakeOptIrEffectTraceForTest,
  fakeOptIrMemoryForTest,
  linearSliceForTest,
  optIrBranchingCompareForTest,
  optIrIntegerValueForTest,
  optIrMemoryLoadStoreSliceForTest,
  optIrReturnOfAddForTest,
} from "../../support/opt-ir/opt-ir-interpreter";
import { compareOptIrSlicesForTest } from "../../support/opt-ir/opt-ir-differential";

describe("OptIR interpreter", () => {
  test("interpreter evaluates wrapping integer add", () => {
    const result = interpretOptIrSlice({
      slice: optIrReturnOfAddForTest({ left: 255n, right: 1n, width: 8 }),
    });

    expect(result.kind).toBe("returned");
    if (result.kind !== "returned") {
      throw new Error("Expected slice to return.");
    }
    expect(result.values).toEqual([optIrIntegerValueForTest(8, 0n)]);
  });

  test("interpreter dispatches by schema interpreter rule instead of operation name", () => {
    const integerType = optIrUnsignedIntegerType(8);
    const operation = constantOperationForTest(0, 0, integerType, 9n);
    const renamedOperation = {
      ...operation,
      kind: "sourceCall",
      stableKey: "sourceCall",
      semantics: {
        ...operation.semantics,
        interpreterRule: optIrInterpreterRuleId("constant-literal"),
      },
    } as typeof operation;

    const result = interpretOptIrSlice({
      slice: linearSliceForTest([renamedOperation], [optIrValueId(0)]),
    });

    expect(result.kind).toBe("returned");
    if (result.kind !== "returned") {
      throw new Error("Expected renamed operation to return.");
    }
    expect(result.values).toEqual([optIrIntegerValueForTest(8, 9n)]);
  });

  test("interpreter evaluates integer compare branches and returns selected values", () => {
    const result = interpretOptIrSlice({
      slice: optIrBranchingCompareForTest({ left: 3n, right: 7n, width: 8 }),
    });

    expect(result.kind).toBe("returned");
    if (result.kind !== "returned") {
      throw new Error("Expected branch slice to return.");
    }
    expect(result.values).toEqual([optIrIntegerValueForTest(8, 3n)]);
  });

  test("integer add can trap when configured for checked overflow", () => {
    const result = interpretOptIrSlice({
      slice: optIrReturnOfAddForTest({ left: 255n, right: 1n, width: 8 }),
      overflowMode: "trap",
    });

    expect(result).toEqual({ kind: "trapped", reason: "integer-overflow:add:u8" });
  });

  test("memory interpretation uses injected regions and effect traces", () => {
    const memory = fakeOptIrMemoryForTest();
    const effects = fakeOptIrEffectTraceForTest();
    const result = interpretOptIrSlice({
      slice: optIrMemoryLoadStoreSliceForTest({ stored: 42n, width: 16 }),
      memory,
      effects,
    });

    expect(result.kind).toBe("returned");
    if (result.kind !== "returned") {
      throw new Error("Expected memory slice to return.");
    }
    expect(result.values).toEqual([optIrIntegerValueForTest(16, 42n)]);
    expect(result.observations.memory).toEqual([["0:0:2", optIrIntegerValueForTest(16, 42n)]]);
    expect(result.observations.effects).toEqual(["write:1:0:0", "read:2:0:0"]);
  });

  test("non-interpreter-complete operations are rejected with stable reasons", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(0),
      callId: optIrCallId(0),
      target: { kind: "source", functionInstanceId: monoInstanceId("called") },
      argumentIds: [],
      resultIds: [optIrValueId(0)],
      resultTypes: [optIrUnsignedIntegerType(8)],
      originId: optIrOriginId(0),
    });

    expect(
      validateOptIrSliceIsInterpreterComplete(linearSliceForTest([call], [optIrValueId(0)])),
    ).toEqual({
      kind: "rejected",
      reasons: ["unsupported-interpreter-rule:source-call"],
    });
  });
});

describe("OptIR differential harness", () => {
  test("compares value results plus memory and effect observations", () => {
    const matching = compareOptIrSlicesForTest({
      before: optIrMemoryLoadStoreSliceForTest({ stored: 7n, width: 8 }),
      after: optIrMemoryLoadStoreSliceForTest({ stored: 7n, width: 8 }),
      memoryFactory: fakeOptIrMemoryForTest,
      effectTraceFactory: fakeOptIrEffectTraceForTest,
    });

    expect(matching.kind).toBe("equivalent");

    const different = compareOptIrSlicesForTest({
      before: optIrMemoryLoadStoreSliceForTest({ stored: 7n, width: 8 }),
      after: optIrMemoryLoadStoreSliceForTest({ stored: 8n, width: 8 }),
      memoryFactory: fakeOptIrMemoryForTest,
      effectTraceFactory: fakeOptIrEffectTraceForTest,
    });

    expect(different).toEqual({
      kind: "different",
      differences: ["values", "memory"],
    });
  });
});

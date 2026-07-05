import { describe, expect, test } from "bun:test";

import {
  optIrCallId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { computeValueNumbers, valueNumberFor } from "../../../src/opt-ir/analyses/value-numbering";
import {
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  optIrSemanticChecksumOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { runGvn } from "../../../src/opt-ir/passes/gvn";
import {
  programWithNonCommonableOperationsForTest,
  programWithOrderSensitiveOperationsForTest,
  programWithPureDuplicateOperationsForTest,
  programWithSiblingBranchDuplicateOperationsForTest,
} from "../../support/opt-ir/dataflow-fixtures";

describe("OptIR GVN", () => {
  test("commons pure interpreter-complete operations with identical schema semantics", () => {
    const fixture = programWithPureDuplicateOperationsForTest();

    const result = runGvn({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(result.removedOperationIds).toEqual([optIrOperationId(4)]);
    expect(result.replacements).toEqual([
      {
        removedOperationId: optIrOperationId(4),
        keptOperationId: optIrOperationId(3),
        removedValueId: optIrValueId(13),
        keptValueId: optIrValueId(12),
        valueNumber: "integerBinary|integer-binary|integer-binary|1:10,2:11|operator:add|types:i32",
      },
    ]);
    expect(result.operations.get(optIrOperationId(5))).toMatchObject({
      left: optIrValueId(12),
      right: optIrValueId(12),
    });
    expect(result.worklistOrder).toEqual([
      "function:1",
      "block:1",
      "operation:1",
      "value:10",
      "operation:2",
      "value:11",
      "operation:3",
      "value:12",
      "operation:4",
      "value:13",
      "operation:5",
      "value:14",
    ]);
  });

  test("does not common volatile, runtime, terminal, or effect-token operations", () => {
    const fixture = programWithNonCommonableOperationsForTest();

    const result = runGvn({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(result.removedOperationIds).toEqual([]);
    expect(result.replacements).toEqual([]);
  });

  test("does not common order-sensitive operations with reversed operands", () => {
    const fixture = programWithOrderSensitiveOperationsForTest();

    const result = runGvn({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(result.removedOperationIds).toEqual([]);
    expect(result.replacements).toEqual([]);
  });

  test("does not common equivalent operations from sibling branches", () => {
    const fixture = programWithSiblingBranchDuplicateOperationsForTest();

    const result = runGvn({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(result.removedOperationIds).toEqual([]);
    expect(result.replacements).toEqual([]);
    expect(result.operations.has(optIrOperationId(2))).toBe(true);
    expect(result.operations.has(optIrOperationId(3))).toBe(true);
  });

  test("value numbering is deterministic by function, block, operation, and value id", () => {
    const fixture = programWithPureDuplicateOperationsForTest();

    const result = computeValueNumbers({
      program: fixture.program,
      operations: fixture.operations,
    });

    expect(result.worklistOrder).toEqual([
      "function:1",
      "block:1",
      "operation:1",
      "value:10",
      "operation:2",
      "value:11",
      "operation:3",
      "value:12",
      "operation:4",
      "value:13",
      "operation:5",
      "value:14",
    ]);
  });

  test("semantic contract value numbers use canonical construction keys", () => {
    const resultType = optIrUnsignedIntegerType(32);
    const first = optIrSemanticChecksumOperation({
      operationId: optIrOperationId(11),
      operands: [optIrValueId(1)],
      resultIds: [optIrValueId(2)],
      resultTypes: [resultType],
      semanticContract: {
        widthBits: 32,
        nested: { right: 2, left: 1 },
        polynomial: 0x1edc_6f41n,
      },
      originId: optIrOriginId(11),
    });
    const second = optIrSemanticChecksumOperation({
      operationId: optIrOperationId(12),
      operands: [optIrValueId(1)],
      resultIds: [optIrValueId(3)],
      resultTypes: [resultType],
      semanticContract: {
        polynomial: 0x1edc_6f41n,
        nested: { left: 1, right: 2 },
        widthBits: 32,
      },
      originId: optIrOriginId(12),
    });

    expect(valueNumberFor(first)).toBe(valueNumberFor(second));
  });

  test("call target value numbers are stable for reordered structured targets", () => {
    const resultType = optIrUnsignedIntegerType(32);
    const first = optIrRuntimeCallOperation({
      operationId: optIrOperationId(21),
      callId: optIrCallId(1),
      target: { kind: "runtime", runtimeKey: "runtime.clock" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(2)],
      resultTypes: [resultType],
      originId: optIrOriginId(21),
    });
    const second = optIrRuntimeCallOperation({
      operationId: optIrOperationId(22),
      callId: optIrCallId(2),
      target: { runtimeKey: "runtime.clock", kind: "runtime" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(3)],
      resultTypes: [resultType],
      originId: optIrOriginId(22),
    });

    expect(valueNumberFor(first)).toBe(valueNumberFor(second));
  });

  test("memory bounds value numbers are stable and support bigint runtime guards", () => {
    const resultType = optIrUnsignedIntegerType(8);
    const first = optIrMemoryLoadOperation({
      operationId: optIrOperationId(31),
      resultId: optIrValueId(2),
      region: optIrRegionId(1),
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: resultType,
      endian: "native",
      volatility: "nonVolatile",
      boundsAuthority: {
        kind: "runtimeGuard",
        guard: {
          guardOperation: optIrOperationId(30),
          successEdge: optIrEdgeId(1),
          checkedByteRange: { start: 0n, endExclusive: 8n },
          dominatesAccess: true,
        },
      },
      originId: optIrOriginId(31),
    });
    const second = optIrMemoryLoadOperation({
      operationId: optIrOperationId(32),
      resultId: optIrValueId(3),
      region: optIrRegionId(1),
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: resultType,
      endian: "native",
      volatility: "nonVolatile",
      boundsAuthority: {
        guard: {
          dominatesAccess: true,
          checkedByteRange: { endExclusive: 8n, start: 0n },
          successEdge: optIrEdgeId(1),
          guardOperation: optIrOperationId(30),
        },
        kind: "runtimeGuard",
      },
      originId: optIrOriginId(32),
    });

    if (first.kind !== "ok" || second.kind !== "ok") {
      throw new Error("expected memory load construction to succeed");
    }

    expect(valueNumberFor(first.operation)).toBe(valueNumberFor(second.operation));
  });
});

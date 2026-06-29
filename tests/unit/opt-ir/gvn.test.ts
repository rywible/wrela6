import { describe, expect, test } from "bun:test";

import { optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import { computeValueNumbers } from "../../../src/opt-ir/analyses/value-numbering";
import { runGvn } from "../../../src/opt-ir/passes/gvn";
import {
  programWithNonCommonableOperationsForTest,
  programWithOrderSensitiveOperationsForTest,
  programWithPureDuplicateOperationsForTest,
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
});

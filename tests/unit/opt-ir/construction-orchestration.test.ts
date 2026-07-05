import { describe, expect, test } from "bun:test";

import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { buildConstructionOperationTable } from "../../../src/opt-ir/lower/construction-pipeline";
import { optIrConstantOperation } from "../../../src/opt-ir/operations";
import { constructOptIr } from "../../../src/opt-ir/public-api";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  constructOptIrInputWithMissingAuthorityForTest,
  constructOptIrInputWithUnsupportedOperationForTest,
  constructOptIrInputWithVerifierFailureForTest,
  invalidBoundaryConstructOptIrInputForTest,
  stableOptIrConstructionKey,
  validConstructOptIrInputForTest,
  validConstructOptIrInputWithShuffledTablesForTest,
} from "../../support/opt-ir/construction-fixtures";

describe("OptIR construction orchestration", () => {
  test("returns stable output for changed checked MIR table insertion order", () => {
    const first = constructOptIr(validConstructOptIrInputForTest());
    const second = constructOptIr(validConstructOptIrInputWithShuffledTablesForTest());

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(stableOptIrConstructionKey(first)).toBe(stableOptIrConstructionKey(second));
  });

  test("fails closed for invalid construction boundary", () => {
    const result = constructOptIr(invalidBoundaryConstructOptIrInputForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected invalid boundary to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "OPT_IR_INPUT_CONTRACT_INVALID",
    );
  });

  test("fails closed for unsupported checked MIR operation", () => {
    const result = constructOptIr(constructOptIrInputWithUnsupportedOperationForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected unsupported operation to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION",
    ]);
  });

  test("fails closed for missing required fact authority", () => {
    const result = constructOptIr(constructOptIrInputWithMissingAuthorityForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected missing authority to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH",
    );
  });

  test("fails closed for verifier failure", () => {
    const result = constructOptIr(constructOptIrInputWithVerifierFailureForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected verifier failure to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "OPT_IR_INPUT_CONTRACT_INVALID",
    );
  });

  test("runs construction cleanup and no optimization passes", () => {
    const result = constructOptIr(validConstructOptIrInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "construction-cleanup",
    ]);
  });

  test("construction operation tables reject duplicate operation IDs before verifier input", () => {
    const result = buildConstructionOperationTable([
      constantOperation(1, 10, 1n),
      constantOperation(1, 11, 2n),
    ]);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected duplicate operation IDs to fail.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "operation-table:duplicate-operation-id:1",
    ]);
  });
});

function constantOperation(operationId: number, resultId: number, value: bigint) {
  return optIrConstantOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operationId),
      type: optIrUnsignedIntegerType(8),
      normalizedValue: value,
    }),
    originId: optIrOriginId(1),
  });
}

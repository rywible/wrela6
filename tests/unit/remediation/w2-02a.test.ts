import { describe, expect, test } from "bun:test";

import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { optIrOriginId, optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrAggregateConstructOperation } from "../../../src/opt-ir/operations";
import { optIrFunctionTable } from "../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  optIrVerifierInputForTest,
  validVerifierProgramForTest,
  verifyOptIrProgramForTest,
} from "../../support/opt-ir/verifier-fixtures";

describe("W2-02a aggregate leftover verification", () => {
  test("final OptIR verification rejects unlowered aggregate operations with source origin", () => {
    const fixture = validVerifierProgramForTest();
    const aggregate = optIrAggregateConstructOperation({
      operationId: optIrOperationId(30),
      resultId: optIrValueId(30),
      fieldIds: [optIrValueId(3)],
      resultType: optIrUnsignedIntegerType(32),
      originId: optIrOriginId(77),
    });
    const program = {
      ...fixture.program,
      functions: optIrFunctionTable(
        fixture.program.functions.entries().map((func) => ({
          ...func,
          blocks: func.blocks.map((block, index) =>
            index === 0
              ? { ...block, operations: [...block.operations, aggregate.operationId] }
              : block,
          ),
        })),
      ),
    };

    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program,
        operations: [...fixture.operations, aggregate],
      }),
    );

    expect(result.kind).toBe("error");
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === optIrDiagnosticCode("OPT_IR_UNLOWERED_AGGREGATE"),
    );
    expect(diagnostic?.originId).toBe(optIrOriginId(77));
    expect(diagnostic?.stableDetail).toBe("unlowered-aggregate:aggregateConstruct:30");
  });
});

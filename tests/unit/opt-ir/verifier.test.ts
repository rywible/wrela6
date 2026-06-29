import { describe, expect, test } from "bun:test";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { optIrValueId } from "../../../src/opt-ir/ids";
import {
  cfgEditWithMissingReferencesForTest,
  optIrProgramWithBlockArgumentMismatchForTest,
  optIrProgramWithDominanceViolationForTest,
  optIrProgramWithDuplicateValueDefinitionForTest,
  optIrProgramWithMetadataMismatchForTest,
  optIrProgramWithMissingRegionTokenForTest,
  optIrVerifierInputForTest,
  validVerifierProgramForTest,
  verifyOptIrProgramForTest,
} from "../../support/opt-ir/verifier-fixtures";

describe("OptIR verifier suite", () => {
  test("accepts a structurally valid SSA program", () => {
    const fixture = validVerifierProgramForTest();
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: fixture.operations,
      }),
    );

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("ssa verifier rejects duplicate value definitions", () => {
    const result = verifyOptIrProgramForTest(
      optIrProgramWithDuplicateValueDefinitionForTest(optIrValueId(8)),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DUPLICATE_VALUE_DEFINITION"),
    );
  });

  test("structural verifier rejects predecessor edge argument arity mismatches", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithBlockArgumentMismatchForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_BLOCK_ARGUMENT_MISMATCH"),
    );
  });

  test("ssa verifier rejects value uses before definitions in the same block", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithDominanceViolationForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("operation metadata verifier rejects stale cached metadata", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMetadataMismatchForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_OPERATION_METADATA_MISMATCH"),
    );
  });

  test("region verifier rejects represented effectful region token gaps", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMissingRegionTokenForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_EFFECT_TOKEN_INCOMPLETE"),
    );
  });

  test("cfg edit verifier rejects edits that reference missing old and new CFG pieces", () => {
    const result = verifyOptIrProgramForTest(cfgEditWithMissingReferencesForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_CFG_EDGE_MISSING"),
    );
  });
});

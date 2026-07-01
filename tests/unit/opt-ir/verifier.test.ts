import { describe, expect, test } from "bun:test";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import { optIrValueId } from "../../../src/opt-ir/ids";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import {
  cfgEditWithMissingReferencesForTest,
  optIrProgramWithBlockArgumentMismatchForTest,
  optIrProgramWithDominanceViolationForTest,
  optIrProgramWithDuplicateValueDefinitionForTest,
  optIrProgramWithLaterDominatingDefinitionForTest,
  optIrProgramWithMetadataMismatchForTest,
  optIrProgramWithMissingRegionTokenForTest,
  optIrProgramWithMissingReturnValueDefinitionForTest,
  optIrProgramWithSiblingBranchDominanceViolationForTest,
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

  test("ssa verifier rejects sibling branch values that do not dominate a use", () => {
    const result = verifyOptIrProgramForTest(
      optIrProgramWithSiblingBranchDominanceViolationForTest(),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("ssa verifier rejects terminator values without definitions", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMissingReturnValueDefinitionForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_DOMINANCE_VIOLATION"),
    );
  });

  test("ssa verifier accepts a later-listed block that dominates its successor", () => {
    expect(verifyOptIrProgramForTest(optIrProgramWithLaterDominatingDefinitionForTest())).toEqual({
      kind: "ok",
      diagnostics: [],
    });
  });

  test("operation metadata verifier rejects stale cached metadata", () => {
    const result = verifyOptIrProgramForTest(optIrProgramWithMetadataMismatchForTest());

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_OPERATION_METADATA_MISMATCH"),
    );
  });

  test("operation schema verifier rejects missing required operation results", () => {
    const fixture = validVerifierProgramForTest();
    const malformedConstant = {
      ...fixture.operations[0],
      resultIds: [],
      resultTypes: [],
    } as OptIrOperation;
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: fixture.program,
        operations: [malformedConstant, fixture.operations[1] as OptIrOperation],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "result-count:constant:0:1",
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

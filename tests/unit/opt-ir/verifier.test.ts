import { describe, expect, test } from "bun:test";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import {
  optIrConstantId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrDataConstantFingerprint,
  type OptIrDataConstant,
} from "../../../src/opt-ir/constants";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import { optIrConstantTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import {
  cfgEditWithMissingReferencesForTest,
  optIrProgramWithBlockArgumentMismatchForTest,
  optIrProgramWithDominanceViolationForTest,
  optIrProgramWithDuplicateValueDefinitionForTest,
  optIrProgramWithEntryParameterEdgeForTest,
  optIrProgramWithLaterDominatingDefinitionForTest,
  optIrProgramWithMetadataMismatchForTest,
  optIrProgramWithMissingRegionTokenForTest,
  optIrProgramWithMissingReturnValueDefinitionForTest,
  optIrProgramWithSiblingBranchDominanceViolationForTest,
  optIrVerifierInputForTest,
  validVerifierProgramForTest,
  verifyOptIrProgramForTest,
} from "../../support/opt-ir/verifier-fixtures";
import { targetIdForTest } from "../../support/opt-ir/cfg-fakes";

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

  test("ssa verifier does not require CFG edge arguments for entry parameters", () => {
    expect(verifyOptIrProgramForTest(optIrProgramWithEntryParameterEdgeForTest())).toEqual({
      kind: "ok",
      diagnostics: [],
    });
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

  test("constant-pool verifier accepts a valid data constant", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:hello" }),
        ]),
      }),
    );

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("constant-pool verifier rejects duplicate constant ids", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:first" }),
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:second" }),
        ]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "duplicate-constant-id:1",
    );
  });

  test("constant-pool verifier rejects duplicate data stable keys", () => {
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([
          dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:shared" }),
          dataConstantForTest({ constantId: optIrConstantId(2), stableKey: "utf16:shared" }),
        ]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "duplicate-data-stable-key:utf16:shared",
    );
  });

  test("constant-pool verifier rejects fingerprint mismatches", () => {
    const valid = dataConstantForTest({ constantId: optIrConstantId(1), stableKey: "utf16:hello" });
    const tampered = { ...valid, bytes: [0x68, 0x00, 0x69, 0x00, 0x00, 0x00] };
    const result = verifyOptIrProgramForTest(
      optIrVerifierInputForTest({
        program: programWithConstantsForTest([tampered]),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "data-constant-fingerprint-mismatch:1",
    );
  });
});

function dataConstantForTest(input: {
  readonly constantId: ReturnType<typeof optIrConstantId>;
  readonly stableKey: string;
}): OptIrDataConstant {
  const bytes = [0x68, 0x00, 0x00, 0x00];
  const alignment = 2;
  const section = "rodata";
  return {
    kind: "data",
    constantId: input.constantId,
    type: { kind: "address" },
    normalizedValue: 0n,
    bytes,
    alignment,
    section,
    stableKey: input.stableKey,
    fingerprint: optIrDataConstantFingerprint({
      bytes,
      alignment,
      section,
      stableKey: input.stableKey,
    }),
  };
}

function programWithConstantsForTest(constants: readonly OptIrDataConstant[]) {
  const fixture = validVerifierProgramForTest();
  return optIrProgram({
    ...fixture.program,
    programId: optIrProgramId(700),
    targetId: targetIdForTest("test-target"),
    regions: optIrRegionTable([
      { regionId: optIrRegionId(1), originId: fixture.program.provenance.originIds[0]! },
    ]),
    constants: optIrConstantTable(constants),
  });
}

import { describe, expect, test } from "bun:test";

import { optimizationPassId, optIrOriginId, optIrProgramId } from "../../../src/opt-ir/ids";
import { optIrOptimizationInfo } from "../../../src/opt-ir/optimization-diagnostics";
import {
  changedOptIrPassResult,
  errorOptIrPassResult,
  unchangedOptIrPassResult,
  validateOptIrPassDefinition,
  type OptIrPassDefinition,
} from "../../../src/opt-ir/passes/pass-execution";
import type { OptIrPassContract } from "../../../src/opt-ir/passes/pass-contract";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { targetId } from "../../../src/semantic/ids";

describe("OptIR pass execution foundation", () => {
  test("validates a pass definition against its closed name and existing contract", () => {
    expect(validateOptIrPassDefinition(definitionForTest("cleanup"))).toEqual({ kind: "ok" });
    expect(
      validateOptIrPassDefinition({
        ...definitionForTest("cleanup"),
        contract: { ...contractForTest("licm"), passId: optimizationPassId("licm") },
      }),
    ).toEqual({
      kind: "error",
      issues: [{ code: "PASS_NAME_CONTRACT_MISMATCH", path: "contract.passId" }],
    });
  });

  test("unchanged and changed helpers preserve program identity and diagnostics", () => {
    const program = programForTest();

    expect(unchangedOptIrPassResult(program)).toEqual({
      kind: "ok",
      state: program,
      changed: false,
      diagnostics: [],
    });
    expect(changedOptIrPassResult(program, [])).toEqual({
      kind: "ok",
      state: program,
      changed: true,
      diagnostics: [],
    });
  });

  test("error helper returns canonical diagnostics-only errors", () => {
    const diagnostic = optIrOptimizationInfo({
      passName: "cleanup",
      optimizationCode: "TEST_PASS_ERROR",
      stableDetail: "test-pass-error",
    });

    expect(errorOptIrPassResult([diagnostic])).toEqual({
      kind: "error",
      diagnostics: [diagnostic],
    });
  });
});

function definitionForTest(name: "cleanup" | "licm"): OptIrPassDefinition {
  const passId = optimizationPassId(name);
  return {
    name,
    passId,
    contract: contractForTest(name),
    run(input) {
      return unchangedOptIrPassResult(input.state);
    },
  };
}

function programForTest(): OptIrProgram {
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("pass-execution-test"),
    functions: optIrFunctionTable([]),
    regions: optIrRegionTable([]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [optIrOriginId(1)] },
  });
}

function contractForTest(name: "cleanup" | "licm"): OptIrPassContract {
  return {
    passId: optimizationPassId(name),
    invalidatesByDefault: true,
    preserves: [],
    derives: [],
    rewriteObligations: [],
    scheduling: {
      requires: ["canonical-opt-ir"],
      produces: [`${name}-complete`],
      invalidatesAnalyses: [],
      idempotent: true,
      fuel: { kind: "fixedRounds", rounds: 1 },
    },
    requiresVerifierAfterRun: true,
  };
}

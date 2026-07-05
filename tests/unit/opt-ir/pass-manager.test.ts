import { describe, expect, test } from "bun:test";

import {
  optimizationPassId,
  optIrBlockId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
} from "../../../src/opt-ir/ids";
import { optIrOptimizationInfo } from "../../../src/opt-ir/optimization-diagnostics";
import {
  runOptIrPassPipeline,
  type OptIrPipelinePassDefinition,
} from "../../../src/opt-ir/passes/pass-manager";
import type { OptIrPassName, OptIrPassRunResult } from "../../../src/opt-ir/passes/pass-execution";
import type { OptIrPassContract } from "../../../src/opt-ir/passes/pass-contract";
import { stateChanged } from "../../../src/opt-ir/passes/pipeline-state";
import type { OptIrProductionPassScheduleEntry } from "../../../src/opt-ir/policy/pass-order-policy";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import type { PipelineState } from "../../../src/opt-ir/passes/pipeline-types";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import { createCompilerStageMetadata } from "../../../src/pipeline";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";

describe("OptIR pass manager", () => {
  test("sorts pass diagnostics deterministically while preserving pass order metadata", () => {
    const state = stateForTest();
    const schedule = [
      scheduleEntry(0, "sccp", { rounds: 1 }),
      scheduleEntry(1, "dce", { rounds: 1 }),
    ];

    const result = runOptIrPassPipeline({
      state,
      schedule,
      definitions: new Map([
        [
          "sccp",
          definition("sccp", (current) => ({
            ...current,
            diagnostics: [
              ...current.diagnostics,
              optIrOptimizationInfo({
                passName: "sccp",
                optimizationCode: "SCCP_SECOND",
                stableDetail: "z-detail",
              }),
              optIrOptimizationInfo({
                passName: "sccp",
                optimizationCode: "SCCP_FIRST",
                stableDetail: "a-detail",
              }),
            ],
          })),
        ],
        ["dce", definition("dce", (current) => current)],
      ]),
    });

    expect("kind" in result).toBe(false);
    if ("kind" in result) throw new Error("Expected pass manager to succeed.");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "a-detail",
      "z-detail",
    ]);
    expect(result.decisionLog?.entries().map((entry) => entry.candidateKey)).toEqual([
      "pipeline:00:sccp",
      "pipeline:01:dce",
    ]);
  });

  test("reruns consecutive fixpoint groups until a full round reports no changes", () => {
    let firstRuns = 0;
    let secondRuns = 0;
    const schedule = [
      scheduleEntry(0, "sccp", { rounds: 4, fixpointId: "scalar-simplification-fixpoint" }),
      scheduleEntry(1, "dce", { rounds: 4, fixpointId: "scalar-simplification-fixpoint" }),
    ];

    const result = runOptIrPassPipeline({
      state: stateForTest(),
      schedule,
      definitions: new Map([
        [
          "sccp",
          definition("sccp", (current) => {
            firstRuns += 1;
            return firstRuns === 1 ? { ...current, operations: [{} as never] } : current;
          }),
        ],
        [
          "dce",
          definition("dce", (current) => {
            secondRuns += 1;
            return current;
          }),
        ],
      ]),
    });

    expect("kind" in result).toBe(false);
    expect(firstRuns).toBe(2);
    expect(secondRuns).toBe(2);
  });

  test("fixpoint convergence honors explicit pass changed flags", () => {
    let runs = 0;
    const schedule = [
      scheduleEntry(0, "sccp", { rounds: 4, fixpointId: "scalar-simplification-fixpoint" }),
    ];

    const result = runOptIrPassPipeline({
      state: stateForTest(),
      schedule,
      definitions: new Map([
        [
          "sccp",
          definition("sccp", (current) => {
            runs += 1;
            return { kind: "ok", state: current, changed: runs === 1, diagnostics: [] };
          }),
        ],
      ]),
    });

    expect("kind" in result).toBe(false);
    expect(runs).toBe(2);
  });

  test("records an after-pass checkpoint when the pass contract requires verification", () => {
    const result = runOptIrPassPipeline({
      state: stateForTest(),
      schedule: [scheduleEntry(0, "sccp", { rounds: 1 })],
      definitions: new Map([["sccp", definition("sccp", (current) => current)]]),
    });

    expect("kind" in result).toBe(false);
    if ("kind" in result) throw new Error("Expected pass manager to succeed.");
    expect(result.verificationCheckpoints).toEqual([{ kind: "after-pass", passId: "sccp" }]);
  });

  test("fails closed when required after-pass verification rejects pass output", () => {
    const result = runOptIrPassPipeline({
      state: stateForTest(),
      schedule: [scheduleEntry(0, "sccp", { rounds: 1 })],
      definitions: new Map([
        [
          "sccp",
          definition("sccp", (current) => ({
            ...current,
            program: programWithMissingOperationReferenceForTest(),
            operations: [],
          })),
        ],
      ]),
    });

    expect("kind" in result).toBe(true);
    if (!("kind" in result)) throw new Error("Expected pass manager to fail.");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "missing-operation:99",
    );
  });

  test("emits a structured diagnostic when fixpoint fuel is exhausted", () => {
    const schedule = [
      scheduleEntry(0, "sccp", { rounds: 2, fixpointId: "scalar-simplification-fixpoint" }),
    ];

    const result = runOptIrPassPipeline({
      state: stateForTest(),
      schedule,
      definitions: new Map([
        [
          "sccp",
          definition("sccp", (current) => ({
            kind: "ok",
            state: current,
            changed: true,
            diagnostics: [],
          })),
        ],
      ]),
    });

    expect("kind" in result).toBe(false);
    if ("kind" in result) throw new Error("Expected pass manager to return state.");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        passName: "scalar-simplification-fixpoint",
        optimizationCode: "OPT_IR_FIXPOINT_FUEL_EXHAUSTED",
        stableDetail:
          "fixpoint-fuel-exhausted:scalar-simplification-fixpoint:passes=sccp:rounds=2:last=sccp",
      }),
    );
  });
});

function definition(
  passName: OptIrPassName,
  run: (state: PipelineState) => PipelineState | OptIrPassRunResult<PipelineState>,
): OptIrPipelinePassDefinition {
  const passId = optimizationPassId(passName);
  return {
    name: passName,
    passId,
    contract: contractForTest(passName),
    run({ state }) {
      const result = run(state);
      if ("kind" in result) {
        return result;
      }
      return {
        kind: "ok",
        state: result,
        changed: stateChanged(state, result),
        diagnostics: [],
      };
    },
  };
}

function contractForTest(passName: OptIrPassName): OptIrPassContract {
  const passId = optimizationPassId(passName);
  const fuel = { kind: "fixedRounds" as const, rounds: 1 };
  return {
    passId,
    invalidatesByDefault: true,
    preserves: [],
    derives: [],
    rewriteObligations: [],
    scheduling: {
      requires: [],
      produces: [],
      invalidatesAnalyses: [],
      idempotent: true,
      fuel,
    },
    requiresVerifierAfterRun: true,
  };
}

function stateForTest(): PipelineState {
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("pass-manager-test"),
      functions: optIrFunctionTable([]),
      regions: optIrRegionTable([]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [optIrOriginId(1)] },
    }) as OptIrProgram,
    operations: [],
    optimizationRegions: [],
    facts: emptyOptIrFactSet(),
    diagnostics: [],
    decisionLog: undefined,
    verificationCheckpoints: [],
    metadata: createCompilerStageMetadata(),
  };
}

function programWithMissingOperationReferenceForTest(): OptIrProgram {
  const originId = optIrOriginId(1);
  const block = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [optIrOperationId(99)],
    originId,
  };
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("pass-manager-test"),
    functions: optIrFunctionTable([
      {
        functionId: optIrFunctionId(1),
        monoInstanceId: monoInstanceId("pass-manager::invalid"),
        signature: {} as never,
        blocks: [block],
        edges: { get: () => undefined, has: () => false, entries: () => [] },
        entryBlock: block.blockId,
        originId,
      },
    ]),
    regions: optIrRegionTable([]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
}

function scheduleEntry(
  order: number,
  passId: string,
  options: {
    readonly rounds: number;
    readonly fixpointId?: OptIrProductionPassScheduleEntry["stageId"];
  },
): OptIrProductionPassScheduleEntry {
  const id = optimizationPassId(passId);
  const fuel = { kind: "fixedRounds" as const, rounds: options.rounds };
  const stageId = options.fixpointId ?? "scalar-simplification-fixpoint";
  return {
    stageId,
    order,
    passId: id,
    requires: [],
    produces: [],
    invalidatesAnalyses: [],
    idempotent: true,
    fuel,
    contract: {
      passId: id,
      invalidatesByDefault: true,
      preserves: [],
      derives: [],
      rewriteObligations: [],
      scheduling: {
        requires: [],
        produces: [],
        invalidatesAnalyses: [],
        idempotent: true,
        fuel,
      },
      requiresVerifierAfterRun: true,
    },
    fixpoint:
      options.fixpointId === undefined
        ? undefined
        : {
            fixpointId: options.fixpointId,
            fuel,
            worklistPriority: [id],
          },
  };
}

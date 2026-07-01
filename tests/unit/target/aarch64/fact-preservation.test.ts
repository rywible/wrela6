import { describe, expect, test } from "bun:test";
import { optIrFactId, optIrOperationId, optIrRegionId } from "../../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import { footprintFactRecord } from "../../../../src/opt-ir/facts/footprint-facts";
import { securityFactRecord } from "../../../../src/opt-ir/facts/security-facts";
import {
  preserveAArch64Facts,
  preserveAArch64MachineFactsStageState,
} from "../../../../src/target/aarch64/lower/fact-preservation";
import { createAArch64LoweringState } from "../../../../src/target/aarch64/lower/lowering-context";
import { emptyAArch64PreservedFactSet } from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineInstructionId } from "../../../../src/target/aarch64/machine-ir/ids";
import { optimizedOptIrProgramWithOneFunctionForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 fact preservation", () => {
  test("preserves declared precise subjects", () => {
    const preserved = preserveAArch64Facts({
      optIrFacts: optIrFactSetFromRecords([
        footprintFactRecord({
          factId: optIrFactId(1),
          regionId: optIrRegionId(4),
          start: 0n,
          endExclusive: 8n,
          access: "read",
        }),
        securityFactRecord({
          factId: optIrFactId(2),
          valueId: 12 as never,
          labels: ["secret"],
        }),
      ]),
      selectionRecords: [
        {
          patternId: "memory.load",
          inputFacts: [1, 2],
          machineInstructions: [aarch64MachineInstructionId(40), aarch64MachineInstructionId(41)],
          factPreservationMappings: [
            {
              optIrFactIds: [1],
              subject: { kind: "memoryOperand", instructionId: 40, operandIndex: 1 },
            },
            {
              optIrFactIds: [2],
              subject: { kind: "virtualRegister", vreg: 12 },
            },
          ],
        },
      ],
    });

    expect(preserved.records.map((record) => record.subject)).toEqual([
      { kind: "memoryOperand", instructionId: 40, operandIndex: 1 },
      { kind: "virtualRegister", vreg: 12 },
    ]);
    expect(preserved.records.map((record) => record.lineage.optIrFactIds.map(Number))).toEqual([
      [1],
      [2],
    ]);
  });

  test("does not attach every input fact to every emitted instruction", () => {
    const preserved = preserveAArch64Facts({
      optIrFacts: optIrFactSetFromRecords([
        footprintFactRecord({
          factId: optIrFactId(1),
          regionId: optIrRegionId(4),
          start: 0n,
          endExclusive: 8n,
          access: "read",
        }),
        securityFactRecord({
          factId: optIrFactId(2),
          operationId: optIrOperationId(7),
          labels: ["zeroizationStore"],
        }),
      ]),
      selectionRecords: [
        {
          patternId: "memory.store",
          inputFacts: [1, 2],
          machineInstructions: [aarch64MachineInstructionId(40), aarch64MachineInstructionId(41)],
          factPreservationMappings: [
            {
              optIrFactIds: [1],
              subject: { kind: "memoryOperand", instructionId: 40, operandIndex: 1 },
            },
            {
              optIrFactIds: [2],
              subject: { kind: "machineInstruction", instructionId: 41 },
            },
          ],
        },
      ],
    });

    expect(preserved.records).toHaveLength(2);
    expect(
      preserved.records.some(
        (record) =>
          record.subject.kind === "machineInstruction" &&
          record.lineage.optIrFactIds.map(Number).join(",") === "1,2",
      ),
    ).toBe(false);
  });

  test("drops facts without surviving declared subjects", () => {
    const preserved = preserveAArch64Facts({
      optIrFacts: optIrFactSetFromRecords([
        footprintFactRecord({
          factId: optIrFactId(1),
          regionId: optIrRegionId(4),
          start: 0n,
          endExclusive: 8n,
          access: "read",
        }),
      ]),
      selectionRecords: [
        {
          patternId: "memory.load",
          inputFacts: [1],
          machineInstructions: [],
          factPreservationMappings: [],
        },
      ],
    });

    expect(preserved.records).toEqual([]);
    expect(preserved.droppedFacts).toEqual([
      { optIrFactId: optIrFactId(1), reason: "no-surviving-machine-subject" },
    ]);
  });

  test("stage wrapper keeps explicit mappings even when factsUsed is empty", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const facts = optIrFactSetFromRecords([
      footprintFactRecord({
        factId: optIrFactId(1),
        regionId: optIrRegionId(4),
        start: 0n,
        endExclusive: 8n,
        access: "read",
      }),
    ]);
    const state = createAArch64LoweringState({
      program: fixture.program,
      operations: fixture.operations,
      facts,
      target: fakeAArch64TargetSurface(),
      options: {},
      preservedFacts: emptyAArch64PreservedFactSet(),
    });
    const preserved = preserveAArch64MachineFactsStageState({
      ...state,
      selectionRecords: [
        {
          stageKey: "selector",
          subjectKey: "fixture",
          patternId: "explicit.mapping",
          tier: "helper",
          factsUsed: [],
          emittedOpcodes: [],
          factPreservationMappings: [
            {
              optIrFactIds: [1],
              subject: { kind: "machineInstruction", instructionId: 7 },
            },
          ],
          explanation: [],
        },
      ],
    }).preservedFacts;

    expect(preserved?.records.map((record) => record.subject)).toEqual([
      { kind: "machineInstruction", instructionId: 7 },
    ]);
    expect(preserved?.droppedFacts).toEqual([]);
  });
});

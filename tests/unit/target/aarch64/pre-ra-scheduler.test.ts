import { describe, expect, test } from "bun:test";
import { optIrFactId } from "../../../../src/opt-ir/ids";
import {
  aarch64MachineFactId,
  aarch64MachineInstructionId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  aarch64InstructionOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import { createAArch64MachinePlanningState } from "../../../../src/target/aarch64/plan/machine-planning-state";
import {
  scheduleAArch64MachinePlanningState,
  verifySchedulePreservesDependencies,
} from "../../../../src/target/aarch64/plan/pre-ra-scheduler";
import { dependencyEdgeKey } from "../../../../src/target/aarch64/plan/required-constraints";
import {
  aarch64Gpr64ForTest,
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../support/target/aarch64/machine-ir/builders";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 pre-RA scheduler", () => {
  test("schedules through machine planning state and records dependency-safe order", () => {
    const machineFunction = aarch64MachineFunctionForTest({
      instructions: [
        aarch64MovzForTest({ instructionId: 1, value: 1n }),
        aarch64MovzForTest({ instructionId: 2, value: 2n }),
      ],
    });
    const planningState = createAArch64MachinePlanningState({
      machineFunction,
      preservedFacts: aarch64PreservedFactSet({
        records: [
          aarch64MachineFactRecord({
            factId: aarch64MachineFactId(1),
            subject: {
              kind: "machineEdge",
              edgeKey: dependencyEdgeKey({
                fromInstruction: 1,
                toInstruction: 2,
                kind: "security",
                resource: "constant-time",
                requiredBy: ["security-motion"],
              }),
            },
            lineage: { optIrFactIds: [optIrFactId(1)] },
          }),
        ],
      }),
      targetPlanning: fakeAArch64TargetSurface().planning,
    });

    const scheduled = scheduleAArch64MachinePlanningState({ state: planningState });

    expect(scheduled.revision).toBe(planningState.revision + 1);
    expect(scheduled.scheduleOrderByBlock["1:0"]).toEqual([1, 2]);
    expect(scheduled.machineFunction.schedulePlan).toContain("schedule:block:1:0:1,2");
    expect(verifySchedulePreservesDependencies({ state: scheduled })).toEqual({ kind: "ok" });
  });

  test("keeps terminators after earlier side effects even when the terminator id sorts first", () => {
    const stored = aarch64Gpr64ForTest(1);
    const base = aarch64Gpr64ForTest(2);
    const type = aarch64IntMachineType(64);
    const store = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(100),
      opcode: aarch64OpcodeFormId("str-unsigned-immediate"),
      operands: [
        useVreg(stored, type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: base },
          type,
        }),
      ],
      flags: { mayTrap: false, mayStore: true },
      origin: syntheticAArch64Origin("fixture.store.before.terminator"),
    });
    const terminator = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(1),
      opcode: aarch64OpcodeFormId("ret"),
      operands: [],
      flags: { mayTrap: false, isTerminator: true },
      origin: syntheticAArch64Origin("fixture.low-id.ret"),
    });
    const planningState = createAArch64MachinePlanningState({
      machineFunction: aarch64MachineFunctionForTest({
        instructions: [store],
        terminator,
      }),
      preservedFacts: aarch64PreservedFactSet({ records: [] }),
      targetPlanning: fakeAArch64TargetSurface().planning,
    });

    const scheduled = scheduleAArch64MachinePlanningState({ state: planningState });

    expect(
      planningState.dependencyGraph.edges.some(
        (edge) =>
          edge.fromInstruction === 100 &&
          edge.toInstruction === 1 &&
          edge.kind === "control" &&
          edge.resource === "terminator-order",
      ),
    ).toBe(true);
    expect(scheduled.scheduleOrderByBlock["1:0"]).toEqual([100, 1]);
    expect(scheduled.machineFunction.schedulePlan).toContain("schedule:block:1:0:100,1");
  });
});

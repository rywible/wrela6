import { describe, expect, test } from "bun:test";

import { allocationResult } from "../../../../../src/target/aarch64/backend/allocation/allocation-result";
import { lowerAArch64MachineInstructions } from "../../../../../src/target/aarch64/backend/api/machine-lowering";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64Gpr64ForTest,
  aarch64RetForTest,
} from "../../../../../tests/support/target/aarch64/machine-ir/builders";

const U64 = aarch64IntMachineType(64);

describe("AArch64 machine lowering", () => {
  test("uses the allocation segment covering the instruction order", () => {
    const lowered = lowerAArch64MachineInstructions(
      "split.lowering",
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol: aarch64SymbolId("split.lowering"),
        virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [
              movzForTest(0, 0),
              addForTest({ instructionId: 1, destination: 2, left: 0, right: 1 }),
            ],
            terminator: aarch64RetForTest({ instructionId: 2 }),
          }),
        ],
      }),
      allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:0",
            vreg: 0,
            physical: "x1",
            startOrder: 0,
            endOrder: 1,
            reason: "pre-call",
          },
          {
            liveRangeKey: "live-range:vreg:0",
            vreg: 0,
            physical: "x0",
            startOrder: 1,
            endOrder: 3,
            reason: "post-call",
          },
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "x2",
            startOrder: 0,
            endOrder: 3,
            reason: "assigned",
          },
          {
            liveRangeKey: "live-range:vreg:2",
            vreg: 2,
            physical: "x3",
            startOrder: 1,
            endOrder: 2,
            reason: "assigned",
          },
        ],
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") throw new Error("expected lowered instructions");
    const add = lowered.instructions.find(
      (instruction) => instruction.opcode === "add-shifted-register",
    );
    expect(add?.operands).toEqual([
      { kind: "register", register: "x3" },
      { kind: "register", register: "x0" },
      { kind: "register", register: "x2" },
    ]);
  });

  test("propagates compare vreg subjects to conditional branches through NZCV", () => {
    const lowered = lowerAArch64MachineInstructions(
      "secret.branch",
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(2),
        symbol: aarch64SymbolId("secret.branch"),
        virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [cmpForTest(0, 0, 1)],
            terminator: bCondForTest(1, 1),
          }),
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(1),
            frequency: { kind: "warm" },
            instructions: [],
            terminator: aarch64RetForTest({ instructionId: 2 }),
          }),
        ],
      }),
      allocationResult({
        segments: [
          {
            liveRangeKey: "live-range:vreg:0",
            vreg: 0,
            physical: "x0",
            startOrder: 0,
            endOrder: 2,
            reason: "assigned",
          },
          {
            liveRangeKey: "live-range:vreg:1",
            vreg: 1,
            physical: "x1",
            startOrder: 0,
            endOrder: 2,
            reason: "assigned",
          },
        ],
      }),
    );

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") throw new Error("expected lowered instructions");
    const branch = lowered.instructions.find((instruction) => instruction.opcode === "b-cond");
    expect(branch?.security?.branchConditionSubjectKey).toBe("vreg:0");
  });
});

function movzForTest(instructionId: number, destination: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [defVreg(aarch64Gpr64ForTest(destination), U64), immediateOperand(1n, U64)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`lowering.movz.${instructionId}`),
  });
}

function addForTest(input: {
  readonly instructionId: number;
  readonly destination: number;
  readonly left: number;
  readonly right: number;
}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("add-shifted-register"),
    operands: [
      defVreg(aarch64Gpr64ForTest(input.destination), U64),
      useVreg(aarch64Gpr64ForTest(input.left), U64),
      useVreg(aarch64Gpr64ForTest(input.right), U64),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`lowering.add.${input.instructionId}`),
  });
}

function cmpForTest(instructionId: number, left: number, right: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("cmp-shifted-register"),
    operands: [
      useVreg(aarch64Gpr64ForTest(left), U64),
      useVreg(aarch64Gpr64ForTest(right), U64),
      implicitDefResource({ kind: "NZCV" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`lowering.cmp.${instructionId}`),
  });
}

function bCondForTest(instructionId: number, targetBlock: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("b-cond"),
    operands: [
      implicitUseResource({ kind: "NZCV" }),
      branchTarget(aarch64MachineBlockId(targetBlock)),
      immediateOperand(1n, U64),
    ],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`lowering.bcond.${instructionId}`),
  });
}

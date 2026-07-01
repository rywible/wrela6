import { emptyAArch64PreservedFactSet } from "../../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  defVreg,
  immediateOperand,
  implicitDefResource,
  symbolOperand,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64ScheduleMetadata,
  defaultAArch64ScheduleMetadata,
} from "../../../../../src/target/aarch64/machine-ir/schedule";
import type { AArch64SecurityMetadata } from "../../../../../src/target/aarch64/machine-ir/security";
import { aarch64VirtualRegister } from "../../../../../src/target/aarch64/machine-ir/virtual-register";
import { createAArch64MachinePlanningState } from "../../../../../src/target/aarch64/plan/machine-planning-state";
import { fakeAArch64TargetSurface } from "../target-surface/fakes";

const U64 = aarch64IntMachineType(64);

export function aarch64PlanningStateForTest(input: {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly literalPoolPlan?: readonly string[];
}) {
  return createAArch64MachinePlanningState({
    machineFunction: aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(1),
      symbol: aarch64SymbolId("planning.fixture"),
      virtualRegisters: Array.from({ length: 32 }, (_unused, index) =>
        aarch64RegisterForPlanningTest(index),
      ),
      parameters: [],
      returns: [],
      frameObjects: [],
      blocks: [
        aarch64MachineBlock({
          blockId: aarch64MachineBlockId(0),
          frequency: { kind: "entry" },
          instructions: input.instructions,
        }),
      ],
      literalPoolPlan: input.literalPoolPlan,
    }),
    preservedFacts: emptyAArch64PreservedFactSet(),
    targetPlanning: fakeAArch64TargetSurface().planning,
  });
}

export function aarch64RegisterForPlanningTest(id: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: U64,
    origin: { kind: "synthetic", stableKey: `planning.v${id}` },
  });
}

export function aarch64MovzForPlanningTest(input: {
  readonly instructionId: number;
  readonly output: number;
  readonly value: bigint;
  readonly security?: AArch64SecurityMetadata;
  readonly pressure?: number;
}) {
  const output = aarch64RegisterForPlanningTest(input.output);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [defVreg(output, U64), immediateOperand(input.value, U64)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.movz.${input.instructionId}`),
    schedule: schedule(input.pressure),
    ...(input.security === undefined ? {} : { security: input.security }),
  });
}

export function aarch64AdrpForPlanningTest(input: {
  readonly instructionId: number;
  readonly output: number;
  readonly symbol: string;
  readonly security?: AArch64SecurityMetadata;
}) {
  const output = aarch64RegisterForPlanningTest(input.output);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("adrp"),
    operands: [defVreg(output, U64), symbolOperand(aarch64SymbolId(input.symbol))],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.adrp.${input.instructionId}`),
    schedule: schedule(),
    ...(input.security === undefined ? {} : { security: input.security }),
  });
}

export function aarch64AddImmediateForPlanningTest(input: {
  readonly instructionId: number;
  readonly output: number;
  readonly source: number;
  readonly value: bigint;
}) {
  const output = aarch64RegisterForPlanningTest(input.output);
  const source = aarch64RegisterForPlanningTest(input.source);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("add-immediate"),
    operands: [defVreg(output, U64), useVreg(source, U64), immediateOperand(input.value, U64)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.add.${input.instructionId}`),
    schedule: schedule(),
  });
}

export function aarch64CallForPlanningTest(instructionId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("bl"),
    operands: [
      symbolOperand(aarch64SymbolId("callee")),
      implicitDefResource({ kind: "NZCV" }),
      implicitDefResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
      implicitDefResource({ kind: "vectorState" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.call.${instructionId}`),
    schedule: defaultAArch64ScheduleMetadata("branch"),
  });
}

export function aarch64CmpForPlanningTest(instructionId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("cmp-shifted-register"),
    operands: [
      useVreg(aarch64RegisterForPlanningTest(1), U64),
      useVreg(aarch64RegisterForPlanningTest(2), U64),
      implicitDefResource({ kind: "NZCV" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.cmp.${instructionId}`),
  });
}

export function planningOpcodes(state: ReturnType<typeof aarch64PlanningStateForTest>) {
  return (state.machineFunction.blocks[0]?.instructions ?? []).map((instruction) =>
    String(instruction.opcode),
  );
}

function schedule(pressure = 0) {
  return aarch64ScheduleMetadata({
    ...defaultAArch64ScheduleMetadata("integer"),
    pressure: { gpr: pressure, vector: 0 },
  });
}

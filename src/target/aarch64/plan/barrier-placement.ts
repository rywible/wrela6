import { aarch64MachineInstructionId } from "../machine-ir/ids";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import { aarch64ScheduleMetadata, defaultAArch64ScheduleMetadata } from "../machine-ir/schedule";
import type { AArch64MachinePlanningState } from "./machine-planning-state";
import { updateAArch64MachinePlanningState } from "./machine-planning-state";

export function placeAArch64Barriers(input: { readonly requiredSequences: readonly string[][] }) {
  return Object.freeze({
    insertedBarriers: Object.freeze(
      input.requiredSequences.flatMap((sequence) =>
        sequence.filter((opcode) => opcode === "dmb" || opcode === "dsb"),
      ),
    ),
    hardBoundaries: Object.freeze(
      input.requiredSequences.map(
        (sequence, index) => `barrier-boundary:${index}:${sequence.join("+")}`,
      ),
    ),
  });
}

export function placeAArch64BarriersForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const rewrittenBlocks = input.state.machineFunction.blocks.map((block) =>
    aarch64MachineBlock({
      ...block,
      instructions: insertRequiredBarriers(block.instructions),
    }),
  );
  const changed = rewrittenBlocks.some(
    (block, index) =>
      block.instructions.length !== input.state.machineFunction.blocks[index]?.instructions.length,
  );
  if (!changed) {
    return Object.freeze({
      ...input.state,
      explanations: Object.freeze([
        ...input.state.explanations,
        { key: "barrier-placement", detail: "checked-hard-barrier-boundaries" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "barrier-placement",
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      blocks: rewrittenBlocks,
      schedulePlan: [...input.state.machineFunction.schedulePlan, "barrier-placement:inserted"],
    }),
    explanation: { key: "barrier-placement", detail: "inserted-required-hard-boundaries" },
  });
}

function insertRequiredBarriers(
  instructions: readonly AArch64MachineInstruction[],
): readonly AArch64MachineInstruction[] {
  const rewritten: AArch64MachineInstruction[] = [];
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction === undefined) continue;
    const previous = rewritten[rewritten.length - 1];
    if (requiresPreBarrier(instruction) && !isBarrier(previous)) {
      rewritten.push(barrierFor(instruction, "before"));
    }
    rewritten.push(instruction);
    const next = instructions[index + 1];
    if (requiresPostBarrier(instruction) && !isBarrier(next)) {
      rewritten.push(barrierFor(instruction, "after"));
    }
  }
  return Object.freeze(rewritten);
}

function requiresPreBarrier(instruction: AArch64MachineInstruction): boolean {
  return (
    instruction.memoryOrdering?.order === "deviceOrdered" ||
    isSequentiallyConsistentLoad(instruction)
  );
}

function requiresPostBarrier(instruction: AArch64MachineInstruction): boolean {
  return isSequentiallyConsistentStore(instruction);
}

function isSequentiallyConsistentLoad(instruction: AArch64MachineInstruction): boolean {
  return (
    instruction.memoryOrdering?.order === "sequentiallyConsistent" &&
    instruction.flags.mayLoad === true
  );
}

function isSequentiallyConsistentStore(instruction: AArch64MachineInstruction): boolean {
  return (
    instruction.memoryOrdering?.order === "sequentiallyConsistent" &&
    instruction.flags.mayStore === true
  );
}

function isBarrier(instruction: AArch64MachineInstruction | undefined): boolean {
  return (
    instruction !== undefined &&
    (String(instruction.opcode) === "dmb" || String(instruction.opcode) === "dsb")
  );
}

function barrierFor(
  instruction: AArch64MachineInstruction,
  placement: "before" | "after",
): AArch64MachineInstruction {
  const baseSchedule = defaultAArch64ScheduleMetadata("barrier");
  const baseInstructionId =
    placement === "before"
      ? 700_000_000 + Number(instruction.instructionId)
      : 710_000_000 + Number(instruction.instructionId);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(baseInstructionId),
    opcode: aarch64OpcodeFormId(
      instruction.memoryOrdering?.order === "deviceOrdered" ? "dsb" : "dmb",
    ),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(
      `barrier-placement:${placement}:${String(instruction.instructionId)}`,
    ),
    schedule: aarch64ScheduleMetadata({
      ...baseSchedule,
      motion: { kind: "hardBoundary" },
    }),
  });
}

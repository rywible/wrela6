import { aarch64MachineInstructionId } from "../machine-ir/ids";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import type { AArch64InstructionOperand } from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import { defaultAArch64ScheduleMetadata } from "../machine-ir/schedule";
import type { AArch64MachinePlanningState } from "./machine-planning-state";
import { updateAArch64MachinePlanningState } from "./machine-planning-state";

export function planAArch64Prefetches(input: {
  readonly memoryType: string;
  readonly completeFootprint: boolean;
  readonly crossesOrderedBoundary: boolean;
}) {
  if (input.crossesOrderedBoundary)
    return Object.freeze({
      insertedInstructions: Object.freeze([]),
      rejections: Object.freeze([{ reason: "ordered-device-boundary" }]),
    });
  if (input.memoryType !== "normalCacheable" || !input.completeFootprint)
    return Object.freeze({
      insertedInstructions: Object.freeze([]),
      rejections: Object.freeze([{ reason: "not-prefetchable" }]),
    });
  return Object.freeze({
    insertedInstructions: Object.freeze(["prfm"]),
    rejections: Object.freeze([]),
  });
}

export function planAArch64PrefetchesForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const rewrittenBlocks = input.state.machineFunction.blocks.map((block) =>
    aarch64MachineBlock({
      ...block,
      instructions: insertPrefetches(block.instructions),
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
        { key: "prefetch-planning", detail: "checked-prefetch-boundaries-and-footprints" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "prefetch-planning",
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      blocks: rewrittenBlocks,
      schedulePlan: [...input.state.machineFunction.schedulePlan, "prefetch:normal-load-stream"],
    }),
    explanation: { key: "prefetch-planning", detail: "inserted-normal-cacheable-prefetch" },
  });
}

function insertPrefetches(
  instructions: readonly AArch64MachineInstruction[],
): readonly AArch64MachineInstruction[] {
  const rewritten: AArch64MachineInstruction[] = [];
  let inserted = false;
  for (let index = 0; index < instructions.length; index += 1) {
    const current = instructions[index];
    const next = instructions[index + 1];
    if (
      !inserted &&
      current !== undefined &&
      next !== undefined &&
      isPrefetchableLoadStream(current, next)
    ) {
      const memoryBase = memoryBaseOperand(current);
      if (memoryBase !== undefined) {
        rewritten.push(prefetchInstruction(current, memoryBase));
        inserted = true;
      }
    }
    if (current !== undefined) {
      rewritten.push(current);
    }
  }
  return Object.freeze(rewritten);
}

function isPrefetchableLoadStream(
  first: AArch64MachineInstruction,
  second: AArch64MachineInstruction,
): boolean {
  return (
    String(first.opcode) === "ldr-unsigned-immediate" &&
    String(second.opcode) === "ldr-unsigned-immediate" &&
    first.memoryOrdering?.regionMemoryType === "normalCacheable" &&
    second.memoryOrdering?.regionMemoryType === "normalCacheable" &&
    first.memoryOrdering.atomicity === "nonAtomic" &&
    second.memoryOrdering.atomicity === "nonAtomic" &&
    first.schedule.motion.kind !== "hardBoundary" &&
    second.schedule.motion.kind !== "hardBoundary"
  );
}

function prefetchInstruction(
  load: AArch64MachineInstruction,
  memoryBase: AArch64InstructionOperand,
): AArch64MachineInstruction {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(800_000_000 + Number(load.instructionId)),
    opcode: aarch64OpcodeFormId("prfm"),
    operands: [memoryBase],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`prefetch:${String(load.instructionId)}`),
    schedule: defaultAArch64ScheduleMetadata("load"),
  });
}

function memoryBaseOperand(
  instruction: AArch64MachineInstruction,
): AArch64InstructionOperand | undefined {
  return instruction.operands.find((operand) => operand.role === "memoryBase");
}

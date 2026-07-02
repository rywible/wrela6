import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64PhysicalInstruction } from "../finalization/physical-instruction-ir";
import {
  blockSymbolKey,
  branchTargetBlockIdFromSymbol,
  conditionOperandFromInstruction,
  firstUseVregSubjectKey,
  immediateValueOf,
  invalidLowering,
  localBranchTargetBlockId,
  originStableKey,
  physicalRegisterForOperand,
  type AArch64MachineInstructionLoweringResult,
} from "./machine-lowering-helpers";

export interface AArch64BranchLoweringContext {
  readonly instructionOrder: number;
  readonly nzcvConditionSubjectKey?: string;
}

const LOCAL_BRANCH_OPCODES = new Set(["b", "b-cond", "cbz", "cbnz", "tbz", "tbnz"]);

export function isAArch64LocalBranchOpcode(opcode: string): boolean {
  return LOCAL_BRANCH_OPCODES.has(opcode);
}

export function referencedLocalBranchTargetBlockIds(
  machineFunction: AArch64MachineFunction,
): ReadonlySet<number> {
  const targetBlockIds = new Set<number>();
  for (const block of machineFunction.blocks) {
    for (const instruction of block.instructions) {
      addLocalBranchTargetBlockId(instruction, targetBlockIds);
    }
    if (block.terminator !== undefined) {
      addLocalBranchTargetBlockId(block.terminator, targetBlockIds);
    }
  }
  return targetBlockIds;
}

function addLocalBranchTargetBlockId(
  instruction: AArch64MachineInstruction,
  targetBlockIds: Set<number>,
) {
  if (!isAArch64LocalBranchOpcode(String(instruction.opcode))) return;
  const targetBlockId = localBranchTargetBlockId(instruction);
  if (targetBlockId !== undefined) targetBlockIds.add(targetBlockId);
}

export function blockLabelInstruction(
  functionKey: string,
  blockId: number,
): AArch64PhysicalInstruction {
  return Object.freeze({
    stableKey: `label:${blockSymbolKey(functionKey, blockId)}`,
    opcode: "label",
    operands: Object.freeze([]),
    definedSymbol: Object.freeze({
      stableKey: blockSymbolKey(functionKey, blockId),
      kind: "local-definition",
    }),
  });
}

export function instructionsWithBranchDistances(
  loweredBlocks: readonly {
    readonly blockId: number;
    readonly instructions: readonly AArch64PhysicalInstruction[];
  }[],
): readonly AArch64PhysicalInstruction[] {
  const blockOffsetById = new Map<number, number>();
  const instructionOffsetByStableKey = new Map<string, number>();
  let cursor = 0;
  for (const block of loweredBlocks) {
    blockOffsetById.set(block.blockId, cursor);
    for (const instruction of block.instructions) {
      instructionOffsetByStableKey.set(instruction.stableKey, cursor);
      if (instruction.opcode !== "label") cursor += 4;
    }
  }
  return Object.freeze(
    loweredBlocks.flatMap((block) =>
      block.instructions.map((instruction) => {
        const targetBlockId = branchTargetBlockIdFromSymbol(instruction.branch?.targetKey);
        if (instruction.branch === undefined || targetBlockId === undefined) return instruction;
        const targetOffset = blockOffsetById.get(targetBlockId);
        const sourceOffset = instructionOffsetByStableKey.get(instruction.stableKey);
        if (targetOffset === undefined || sourceOffset === undefined) return instruction;
        return Object.freeze({
          ...instruction,
          branch: Object.freeze({
            ...instruction.branch,
            distanceBytes: targetOffset - sourceOffset,
          }),
        });
      }),
    ),
  );
}

export function lowerLocalBranchInstruction(
  functionKey: string,
  stableKey: string,
  instruction: AArch64MachineInstruction,
  allocation: AArch64AllocationResult,
  overrideRegisters: ReadonlyMap<number, string>,
  context: AArch64BranchLoweringContext,
): AArch64MachineInstructionLoweringResult {
  const opcode = String(instruction.opcode) as NonNullable<
    AArch64PhysicalInstruction["branch"]
  >["kind"];
  const targetBlockId = localBranchTargetBlockId(instruction);
  if (targetBlockId === undefined)
    return invalidLowering(stableKey, `missing-branch-target:${opcode}`);
  const targetKey = blockSymbolKey(functionKey, targetBlockId);
  const branch = {
    kind: opcode,
    targetKey,
    distanceBytes: 4,
    veneerPolicy: "none" as const,
  };
  if (opcode === "b") {
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [{ kind: "symbol", symbol: targetKey }],
        branch,
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  if (opcode === "b-cond") {
    const condition = conditionOperandFromInstruction(instruction);
    if (condition === undefined) return invalidLowering(stableKey, "missing-condition:b-cond");
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [condition, { kind: "symbol", symbol: targetKey }],
        branch,
        ...(context.nzcvConditionSubjectKey === undefined
          ? {}
          : { security: { branchConditionSubjectKey: context.nzcvConditionSubjectKey } }),
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  const testRegister = physicalRegisterForOperand(
    instruction,
    "use",
    allocation,
    overrideRegisters,
    context.instructionOrder,
  );
  if (testRegister === undefined) return invalidLowering(stableKey, `missing-allocation:${opcode}`);
  const conditionSubjectKey = firstUseVregSubjectKey(instruction);
  if (opcode === "cbz" || opcode === "cbnz") {
    return {
      kind: "ok",
      instruction: {
        stableKey,
        opcode,
        operands: [
          { kind: "register", register: testRegister },
          { kind: "symbol", symbol: targetKey },
        ],
        branch,
        ...(conditionSubjectKey === undefined
          ? {}
          : { security: { branchConditionSubjectKey: conditionSubjectKey } }),
        provenanceSource: originStableKey(instruction.origin),
      },
    };
  }
  return {
    kind: "ok",
    instruction: {
      stableKey,
      opcode,
      operands: [
        { kind: "register", register: testRegister },
        { kind: "immediate", value: Number(immediateValueOf(instruction)) },
        { kind: "symbol", symbol: targetKey },
      ],
      branch,
      ...(conditionSubjectKey === undefined
        ? {}
        : { security: { branchConditionSubjectKey: conditionSubjectKey } }),
      provenanceSource: originStableKey(instruction.origin),
    },
  };
}

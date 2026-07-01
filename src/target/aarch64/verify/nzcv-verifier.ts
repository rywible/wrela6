import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type { AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import { aarch64ResourceStableKey } from "../machine-ir/resources";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64NzcvVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "nzcv",
  verify(context) {
    return verifyAArch64Nzcv(context);
  },
};

export function verifyAArch64Nzcv(
  context: AArch64MachineVerifierContext,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const func of context.program.functions.entries()) {
    const entryStates = computeNzcvEntryStates(func);
    for (const block of func.blocks) {
      let state = entryStates.get(block.blockId) ?? emptyNzcvState();
      for (const instruction of [
        ...block.instructions,
        ...(block.terminator === undefined ? [] : [block.terminator]),
      ]) {
        const usesNzcv = hasNzcvOperand(instruction, "implicitUse");
        const definesNzcv = hasNzcvOperand(instruction, "implicitDef");
        if (usesNzcv && state.liveDefinition === undefined) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_NZCV_USE_WITHOUT_DEF",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "resource:NZCV",
              stableDetail: `nzcv-use-without-def:${instruction.instructionId}`,
            }),
          );
        } else if (usesNzcv && state.clobberedDefinition !== undefined) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_NZCV_CLOBBERED_BEFORE_USE",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: `instruction:${state.clobberedDefinition}`,
              stableDetail: `nzcv-clobbered:${state.liveDefinition}:${state.clobberedDefinition}:${instruction.instructionId}`,
            }),
          );
          state = { ...state, clobberedDefinition: undefined };
        }
        if (usesNzcv) {
          state = { liveDefinition: undefined, clobberedDefinition: undefined };
        }
        if (definesNzcv) {
          if (state.liveDefinition !== undefined) {
            state = {
              liveDefinition: Number(instruction.instructionId),
              clobberedDefinition: Number(instruction.instructionId),
            };
          } else {
            state = {
              liveDefinition: Number(instruction.instructionId),
              clobberedDefinition: undefined,
            };
          }
        }
      }
    }
  }
  return diagnostics;
}

interface NzcvState {
  readonly liveDefinition?: number;
  readonly clobberedDefinition?: number;
}

function computeNzcvEntryStates(
  func: AArch64MachineFunction,
): ReadonlyMap<AArch64MachineBlock["blockId"], NzcvState> {
  const entryStates = new Map<AArch64MachineBlock["blockId"], NzcvState>();
  for (const block of func.blocks) {
    if (block.frequency.kind === "entry") {
      entryStates.set(block.blockId, emptyNzcvState());
    }
  }
  const blocksById = new Map(func.blocks.map((block) => [block.blockId, block]));
  let changed = true;
  for (let iteration = 0; changed && iteration < func.blocks.length * 2; iteration += 1) {
    changed = false;
    for (const block of func.blocks) {
      const entryState = entryStates.get(block.blockId);
      if (entryState === undefined) continue;
      const exitState = transferNzcvState(entryState, instructionsForBlock(block));
      for (const successor of successorsForBlock(block, blocksById)) {
        const merged = mergeNzcvStates(entryStates.get(successor.blockId), exitState);
        if (!sameNzcvState(entryStates.get(successor.blockId), merged)) {
          entryStates.set(successor.blockId, merged);
          changed = true;
        }
      }
    }
  }
  return entryStates;
}

function transferNzcvState(
  entryState: NzcvState,
  instructions: readonly AArch64MachineInstruction[],
): NzcvState {
  let state = entryState;
  for (const instruction of instructions) {
    const usesNzcv = hasNzcvOperand(instruction, "implicitUse");
    const definesNzcv = hasNzcvOperand(instruction, "implicitDef");
    if (usesNzcv) {
      state = emptyNzcvState();
    }
    if (definesNzcv) {
      state =
        state.liveDefinition === undefined
          ? { liveDefinition: Number(instruction.instructionId), clobberedDefinition: undefined }
          : {
              liveDefinition: Number(instruction.instructionId),
              clobberedDefinition: Number(instruction.instructionId),
            };
    }
  }
  return state;
}

function mergeNzcvStates(left: NzcvState | undefined, right: NzcvState): NzcvState {
  if (left === undefined) return right;
  return {
    liveDefinition: left.liveDefinition === right.liveDefinition ? left.liveDefinition : undefined,
    clobberedDefinition:
      left.clobberedDefinition === right.clobberedDefinition ? left.clobberedDefinition : undefined,
  };
}

function sameNzcvState(left: NzcvState | undefined, right: NzcvState): boolean {
  return (
    left !== undefined &&
    left.liveDefinition === right.liveDefinition &&
    left.clobberedDefinition === right.clobberedDefinition
  );
}

function emptyNzcvState(): NzcvState {
  return { liveDefinition: undefined, clobberedDefinition: undefined };
}

function instructionsForBlock(block: AArch64MachineBlock): readonly AArch64MachineInstruction[] {
  return [...block.instructions, ...(block.terminator === undefined ? [] : [block.terminator])];
}

function successorsForBlock(
  block: AArch64MachineBlock,
  blocksById: ReadonlyMap<AArch64MachineBlock["blockId"], AArch64MachineBlock>,
): readonly AArch64MachineBlock[] {
  return instructionsForBlock(block).flatMap((instruction) =>
    instruction.operands.flatMap((operand) => {
      if (operand.role !== "branchTarget" || operand.operand.kind !== "block") return [];
      const successor = blocksById.get(operand.operand.block);
      return successor === undefined ? [] : [successor];
    }),
  );
}

function hasNzcvOperand(
  instruction: AArch64MachineInstruction,
  role: "implicitDef" | "implicitUse",
): boolean {
  return instruction.operands.some(
    (operand) =>
      operand.role === role &&
      operand.operand.kind === "resource" &&
      aarch64ResourceStableKey(operand.operand.resource) === "NZCV",
  );
}

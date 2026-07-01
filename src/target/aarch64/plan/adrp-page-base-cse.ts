import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64InstructionOperand, type AArch64InstructionOperand } from "../machine-ir/operands";
import {
  updateAArch64MachinePlanningState,
  type AArch64MachinePlanningState,
} from "./machine-planning-state";

export interface AArch64AdrpPageSharingPolicy {
  readonly samePage?: (left: string, right: string) => boolean;
  readonly sectionKeyForSymbol?: (symbol: string) => string;
  readonly loopDepthForInstruction?: (instruction: AArch64MachineInstruction) => number;
}

export function shareAArch64AdrpPageBasesForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
  readonly policy?: AArch64AdrpPageSharingPolicy;
}): AArch64MachinePlanningState {
  const explanations: string[] = [];
  const rewrittenBlocks = input.state.machineFunction.blocks.map((block) => {
    const rewritten = shareAdrpInBlock(block.instructions, input.policy ?? {}, explanations);
    return aarch64MachineBlock({
      ...block,
      instructions: rewritten,
    });
  });
  const changed = rewrittenBlocks.some((block, index) => {
    const original = input.state.machineFunction.blocks[index];
    return original !== undefined && block.instructions.length !== original.instructions.length;
  });
  if (!changed) {
    return Object.freeze({
      ...input.state,
      explanations: Object.freeze([
        ...input.state.explanations,
        {
          key: "adrp-page-base-cse",
          detail: explanations[0] ?? "checked-page-base-sharing",
        },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "adrp-page-base-cse",
    graphUpdate: { kind: "recompute" },
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      blocks: rewrittenBlocks,
      schedulePlan: [...input.state.machineFunction.schedulePlan, "adrp-page-base-cse:shared"],
    }),
    explanation: {
      key: "adrp-page-base-cse",
      detail: explanations.includes("adrp-share:shared") ? "shared-page-bases" : "checked",
    },
  });
}

function shareAdrpInBlock(
  instructions: readonly AArch64MachineInstruction[],
  policy: AArch64AdrpPageSharingPolicy,
  explanations: string[],
): readonly AArch64MachineInstruction[] {
  const leaders: AdrpLeader[] = [];
  const replacements = new Map<number, AArch64InstructionOperand>();
  const rewritten: AArch64MachineInstruction[] = [];
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = replaceInstructionOperands(instructions[index], replacements);
    if (instruction === undefined) continue;
    if (isCallOrBarrier(instruction)) {
      leaders.length = 0;
      explanations.push("adrp-share-rejected:call-boundary");
    }
    const candidate = adrpCandidate(instruction, policy);
    if (candidate !== undefined) {
      const leader = leaders.find((entry) => compatibleLeader(entry, candidate, policy));
      if (
        leader !== undefined &&
        canReplaceAllUses({
          registerId: Number(candidate.def.operand.register.vreg),
          instructions: instructions.slice(index + 1),
        })
      ) {
        replacements.set(Number(candidate.def.operand.register.vreg), leader.def);
        explanations.push("adrp-share:shared");
        continue;
      }
      if (leaders.some((entry) => !samePage(entry.symbol, candidate.symbol, policy))) {
        explanations.push("adrp-share-rejected:relocation-page-mismatch");
      }
      leaders.push(candidate);
    }
    rewritten.push(instruction);
  }
  return Object.freeze(rewritten);
}

interface AdrpLeader {
  readonly instruction: AArch64MachineInstruction;
  readonly def: AArch64InstructionOperand & { readonly operand: { readonly kind: "vreg" } };
  readonly symbol: string;
  readonly sectionKey: string;
  readonly loopDepth: number;
}

function adrpCandidate(
  instruction: AArch64MachineInstruction,
  policy: AArch64AdrpPageSharingPolicy,
): AdrpLeader | undefined {
  if (String(instruction.opcode) !== "adrp") return undefined;
  if (instruction.schedule.motion.kind !== "insideEffectIsland") return undefined;
  if (hasSensitiveSecurity(instruction)) return undefined;
  const def = instruction.operands.find(
    (
      operand,
    ): operand is AArch64InstructionOperand & { readonly operand: { readonly kind: "vreg" } } =>
      operand.role === "def" && operand.operand.kind === "vreg",
  );
  const symbol = instruction.operands.find(
    (operand) => operand.role === "use" && operand.operand.kind === "symbol",
  );
  if (def === undefined || symbol?.operand.kind !== "symbol") return undefined;
  const symbolKey = String(symbol.operand.symbol);
  return {
    instruction,
    def,
    symbol: symbolKey,
    sectionKey: policy.sectionKeyForSymbol?.(symbolKey) ?? "unknown-section",
    loopDepth: policy.loopDepthForInstruction?.(instruction) ?? 0,
  };
}

function compatibleLeader(
  leader: AdrpLeader,
  candidate: AdrpLeader,
  policy: AArch64AdrpPageSharingPolicy,
): boolean {
  return (
    samePage(leader.symbol, candidate.symbol, policy) &&
    leader.sectionKey === candidate.sectionKey &&
    leader.loopDepth === candidate.loopDepth
  );
}

function samePage(left: string, right: string, policy: AArch64AdrpPageSharingPolicy): boolean {
  return policy.samePage?.(left, right) ?? left === right;
}

function canReplaceAllUses(input: {
  readonly registerId: number;
  readonly instructions: readonly AArch64MachineInstruction[];
}): boolean {
  return input.instructions
    .flatMap((instruction) => instruction.operands)
    .every((operand) => {
      if (
        operand.operand.kind !== "vreg" ||
        Number(operand.operand.register.vreg) !== input.registerId
      ) {
        return true;
      }
      return (
        operand.role === "use" || operand.role === "memoryBase" || operand.role === "memoryIndex"
      );
    });
}

function replaceInstructionOperands(
  instruction: AArch64MachineInstruction | undefined,
  replacements: ReadonlyMap<number, AArch64InstructionOperand>,
): AArch64MachineInstruction | undefined {
  if (instruction === undefined) return undefined;
  let changed = false;
  const operands = instruction.operands.map((operand) => {
    if (
      operand.operand.kind !== "vreg" ||
      (operand.role !== "use" && operand.role !== "memoryBase" && operand.role !== "memoryIndex")
    ) {
      return operand;
    }
    const replacement = replacements.get(Number(operand.operand.register.vreg));
    if (replacement === undefined) return operand;
    changed = true;
    return aarch64InstructionOperand({
      role: operand.role,
      operand: replacement.operand,
      type: operand.type,
    });
  });
  return changed ? aarch64MachineInstruction({ ...instruction, operands }) : instruction;
}

function isCallOrBarrier(instruction: AArch64MachineInstruction): boolean {
  const opcode = String(instruction.opcode);
  return opcode === "bl" || opcode === "blr" || opcode === "dmb" || opcode === "dsb";
}

function hasSensitiveSecurity(instruction: AArch64MachineInstruction): boolean {
  const security = instruction.security;
  return (
    security !== undefined &&
    (security.spillPolicy !== "ordinary" ||
      security.zeroization?.required === true ||
      security.labels.some(
        (label) =>
          label.kind === "secret" ||
          label.kind === "keyLifetime" ||
          label.kind === "noSpill" ||
          label.kind === "wipeOnSpill" ||
          label.kind === "zeroization",
      ))
  );
}

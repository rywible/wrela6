import type { AArch64LoweringState } from "../lower/pipeline-stages";
import { appendAArch64PlanningRecord } from "../lower/pipeline-stages";
import { emptyAArch64PreservedFactSet } from "../machine-ir/fact-set";
import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64MachineTypeStableKey } from "../machine-ir/machine-types";
import { aarch64InstructionOperand, type AArch64InstructionOperand } from "../machine-ir/operands";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import { shareAArch64AdrpPageBasesForPlanningState } from "./adrp-page-base-cse";
import {
  createAArch64MachinePlanningState,
  updateAArch64MachinePlanningState,
  type AArch64MachinePlanningState,
} from "./machine-planning-state";
import { planAArch64LiteralPoolsForPlanningState } from "./literal-pool-planning";
import { markAArch64RematerializationForPlanningState } from "./rematerialization-marking";

const CSE_CANDIDATE_OPCODES = new Set([
  "movz",
  "movn",
  "add-immediate",
  "and-logical-immediate",
  "orr-logical-immediate",
  "eor-logical-immediate",
]);

type VregInstructionOperand = AArch64InstructionOperand & {
  readonly operand: { readonly kind: "vreg" };
};

export function runAArch64PostSelectionCse(input: {
  readonly state: AArch64MachinePlanningState;
  readonly allowSecretLifetimeExtension?: boolean;
}): AArch64MachinePlanningState {
  if (input.allowSecretLifetimeExtension === false) return input.state;
  const csePlanned = csePureProducersForPlanningState({ state: input.state });
  const adrpPlanned = shareAArch64AdrpPageBasesForPlanningState({ state: csePlanned });
  const literalPlanned = planAArch64LiteralPoolsForPlanningState({ state: adrpPlanned });
  return markAArch64RematerializationForPlanningState({ state: literalPlanned });
}

export function runAArch64PostSelectionCseStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (state.machineProgram === undefined) {
    return appendAArch64PlanningRecord(state, {
      stageKey: "post-selection-cse-and-remat",
      subjectKey: "program",
      action: "cse-remat-skipped",
      explanation: ["post-selection-cse-and-remat:missing-machine-program"],
    });
  }
  const preservedFacts = state.preservedFacts ?? emptyAArch64PreservedFactSet();
  const planningStates = state.machineProgram.functions.entries().map((machineFunction) =>
    runAArch64PostSelectionCse({
      state: createAArch64MachinePlanningState({
        machineFunction,
        preservedFacts,
        targetPlanning: state.target.planning,
      }),
    }),
  );
  const nextState = Object.freeze({
    ...state,
    machineProgram: aarch64MachineProgram({
      ...state.machineProgram,
      functions: planningStates.map((planningState) => planningState.machineFunction),
    }),
    dependencyEdges: Object.freeze(
      planningStates.flatMap((planningState) => planningState.dependencyGraph.edges),
    ),
    requiredEdges: Object.freeze(
      planningStates.flatMap((planningState) => planningState.requiredConstraints.edges),
    ),
  });
  return appendAArch64PlanningRecord(nextState, {
    stageKey: "post-selection-cse-and-remat",
    subjectKey: "program",
    action: "cse-remat-planned",
    explanation: [
      `post-selection-cse-and-remat:functions:${planningStates.length}`,
      ...planningStates.flatMap((planningState) =>
        planningState.explanations.map((explanation) => `${explanation.key}:${explanation.detail}`),
      ),
    ],
  });
}

function csePureProducersForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const rewrittenBlocks = input.state.machineFunction.blocks.map((block) => {
    const cseResult = cseInstructionsInBlock({
      instructions: block.instructions,
      terminator: block.terminator,
      state: input.state,
    });
    return aarch64MachineBlock({
      ...block,
      instructions: cseResult.instructions,
      ...(cseResult.terminator === undefined ? {} : { terminator: cseResult.terminator }),
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
        { key: "post-selection-cse", detail: "checked-pure-producer-candidates" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "post-selection-cse",
    graphUpdate: { kind: "recompute" },
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      blocks: rewrittenBlocks,
      schedulePlan: [...input.state.machineFunction.schedulePlan, "post-selection-cse:pure"],
    }),
    explanation: { key: "post-selection-cse", detail: "removed-duplicate-pure-producers" },
  });
}

function cseInstructionsInBlock(input: {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly terminator?: AArch64MachineInstruction;
  readonly state: AArch64MachinePlanningState;
}): {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly terminator?: AArch64MachineInstruction;
} {
  const leaders = new Map<string, VregInstructionOperand>();
  const replacements = new Map<number, AArch64InstructionOperand>();
  const rewritten: AArch64MachineInstruction[] = [];
  for (let index = 0; index < input.instructions.length; index += 1) {
    const instruction = replaceInstructionOperands(input.instructions[index], replacements);
    if (instruction === undefined) continue;
    if (isCallOrBarrier(instruction)) leaders.clear();
    const candidate = pureCseCandidate(instruction, input.state);
    if (candidate !== undefined) {
      const key = cseKey(instruction, candidate.def);
      const leader = leaders.get(key);
      if (
        leader !== undefined &&
        canReplaceAllUses({
          registerId: Number(candidate.def.operand.register.vreg),
          instructions: input.instructions.slice(index + 1),
          terminator: input.terminator,
        })
      ) {
        replacements.set(Number(candidate.def.operand.register.vreg), leader);
        continue;
      }
      leaders.set(key, candidate.def);
    }
    rewritten.push(instruction);
  }
  const terminator = replaceInstructionOperands(input.terminator, replacements);
  return Object.freeze({
    instructions: Object.freeze(rewritten),
    ...(terminator === undefined ? {} : { terminator }),
  });
}

function pureCseCandidate(
  instruction: AArch64MachineInstruction,
  state: AArch64MachinePlanningState,
): { readonly def: VregInstructionOperand } | undefined {
  if (!CSE_CANDIDATE_OPCODES.has(String(instruction.opcode))) return undefined;
  if (
    instruction.flags.mayTrap ||
    instruction.flags.mayLoad === true ||
    instruction.flags.mayStore === true ||
    instruction.flags.isTerminator === true
  ) {
    return undefined;
  }
  if (instruction.schedule.motion.kind !== "insideEffectIsland") return undefined;
  if (hasSensitiveSecurity(instruction)) return undefined;
  if (
    instruction.operands.some(
      (operand) => operand.role === "implicitDef" || operand.role === "tiedDefUse",
    )
  ) {
    return undefined;
  }
  if (state.dependencyGraph.edges.some((edge) => edgeInvolvesNonRegister(edge, instruction))) {
    return undefined;
  }
  const def = instruction.operands.find(
    (
      operand,
    ): operand is AArch64InstructionOperand & { readonly operand: { readonly kind: "vreg" } } =>
      operand.role === "def" && operand.operand.kind === "vreg",
  );
  return def === undefined ? undefined : { def };
}

function cseKey(instruction: AArch64MachineInstruction, def: AArch64InstructionOperand): string {
  return JSON.stringify({
    opcode: String(instruction.opcode),
    defType: aarch64MachineTypeStableKey(def.type),
    operands: instruction.operands
      .filter((operand) => operand.role !== "def")
      .map((operand) => ({
        role: operand.role,
        stableKey: operand.stableKey,
        type: aarch64MachineTypeStableKey(operand.type),
      })),
  });
}

function canReplaceAllUses(input: {
  readonly registerId: number;
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly terminator?: AArch64MachineInstruction;
}): boolean {
  return [...input.instructions, ...(input.terminator === undefined ? [] : [input.terminator])]
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
  if (!changed) return instruction;
  return aarch64MachineInstruction({
    ...instruction,
    operands,
  });
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

function edgeInvolvesNonRegister(
  edge: AArch64MachinePlanningState["dependencyGraph"]["edges"][number],
  instruction: AArch64MachineInstruction,
): boolean {
  const instructionId = Number(instruction.instructionId);
  return (
    edge.kind !== "register" &&
    (edge.fromInstruction === instructionId || edge.toInstruction === instructionId)
  );
}

import { appendAArch64PlanningRecord, type AArch64LoweringState } from "../lower/pipeline-stages";
import { preserveAArch64MachineFactsStageState } from "../lower/fact-preservation";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import { emptyAArch64PreservedFactSet } from "../machine-ir/fact-set";
import { placeAArch64BarriersForPlanningState } from "./barrier-placement";
import {
  createAArch64MachinePlanningState,
  updateAArch64MachinePlanningState,
  type AArch64MachinePlanningState,
} from "./machine-planning-state";
import { planAArch64LoadStorePairsForPlanningState } from "./pair-load-store-planning";
import { planAArch64PrefetchesForPlanningState } from "./prefetch-planning";
import { verifyRequiredEdgesComplete, type AArch64DependencyEdge } from "./required-constraints";

export function scheduleAArch64EffectIsland(input: {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
}): { readonly kind: "ok"; readonly scheduled: readonly number[] } {
  const predecessors = new Map<number, Set<number>>();
  for (const edge of input.dependencyEdges) {
    const existing = predecessors.get(edge.toInstruction) ?? new Set<number>();
    existing.add(edge.fromInstruction);
    predecessors.set(edge.toInstruction, existing);
  }
  const scheduled: number[] = [];
  const scheduledSet = new Set<number>();
  const remaining = new Set(
    input.instructions.map((instruction) => Number(instruction.instructionId)),
  );
  while (remaining.size > 0) {
    const ready = [...remaining].filter((instructionId) =>
      [...(predecessors.get(instructionId) ?? [])].every((predecessor) =>
        scheduledSet.has(predecessor),
      ),
    );
    ready.sort((left, right) => left - right);
    const chosen = ready[0];
    if (chosen === undefined) break;
    scheduled.push(chosen);
    scheduledSet.add(chosen);
    remaining.delete(chosen);
  }
  return Object.freeze({ kind: "ok", scheduled: Object.freeze(scheduled) });
}

export function scheduleAArch64MachinePlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const completeness = verifyRequiredEdgesComplete({
    graphEdges: input.state.dependencyGraph.edges,
    requiredEdges: input.state.requiredConstraints.edges,
  });
  if (completeness.kind === "error") {
    throw new RangeError(
      completeness.diagnostics.map((diagnostic) => diagnostic.stableDetail).join("\n"),
    );
  }
  const scheduleOrderByBlock: Record<string, readonly number[]> = {};
  const scheduleEntries: string[] = [];
  for (const block of input.state.machineFunction.blocks) {
    const instructions = [
      ...block.instructions,
      ...(block.terminator === undefined ? [] : [block.terminator]),
    ];
    const instructionIds = new Set(
      instructions.map((instruction) => Number(instruction.instructionId)),
    );
    const dependencyEdges = input.state.dependencyGraph.edges.filter(
      (edge) => instructionIds.has(edge.fromInstruction) && instructionIds.has(edge.toInstruction),
    );
    const schedule = scheduleAArch64EffectIsland({ instructions, dependencyEdges });
    if (schedule.scheduled.length !== instructions.length) {
      throw new RangeError(
        `pre-ra-scheduler:incomplete-schedule:${Number(input.state.machineFunction.functionId)}:${Number(block.blockId)}`,
      );
    }
    const blockKey = `${Number(input.state.machineFunction.functionId)}:${Number(block.blockId)}`;
    scheduleOrderByBlock[blockKey] = schedule.scheduled;
    scheduleEntries.push(`schedule:block:${blockKey}:${schedule.scheduled.join(",")}`);
  }
  const scheduleCheck = verifySchedulePreservesDependencies({
    state: input.state,
    scheduleOrderByBlock,
  });
  if (scheduleCheck.kind === "error") {
    throw new RangeError(scheduleCheck.reasons.join("\n"));
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "pre-ra-scheduler",
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      schedulePlan: [
        ...input.state.machineFunction.schedulePlan,
        `dependency-graph:edges:${input.state.dependencyGraph.edges.length}`,
        ...scheduleEntries,
      ],
    }),
    scheduleOrderByBlock: Object.freeze(scheduleOrderByBlock),
    explanation: {
      key: "pre-ra-scheduler",
      detail: `scheduled-blocks:${Object.keys(scheduleOrderByBlock).length}`,
    },
  });
}

export function verifySchedulePreservesDependencies(input: {
  readonly state: AArch64MachinePlanningState;
  readonly scheduleOrderByBlock?: Readonly<Record<string, readonly number[]>>;
}): { readonly kind: "ok" } | { readonly kind: "error"; readonly reasons: readonly string[] } {
  const scheduleOrderByBlock = input.scheduleOrderByBlock ?? input.state.scheduleOrderByBlock;
  const reasons: string[] = [];
  for (const block of input.state.machineFunction.blocks) {
    const blockKey = `${Number(input.state.machineFunction.functionId)}:${Number(block.blockId)}`;
    const order = scheduleOrderByBlock[blockKey];
    if (order === undefined) {
      reasons.push(`schedule:block-missing:${blockKey}`);
      continue;
    }
    const positions = new Map(order.map((instructionId, index) => [instructionId, index]));
    for (const edge of input.state.dependencyGraph.edges) {
      const fromIndex = positions.get(edge.fromInstruction);
      const toIndex = positions.get(edge.toInstruction);
      if (fromIndex !== undefined && toIndex !== undefined && fromIndex > toIndex) {
        reasons.push(
          `schedule:dependency-violated:${blockKey}:${edge.fromInstruction}:${edge.toInstruction}:${edge.kind}`,
        );
      }
    }
  }
  return reasons.length === 0
    ? { kind: "ok" }
    : { kind: "error", reasons: Object.freeze(reasons.sort()) };
}

export function planAArch64PairsPrefetchBarriersScheduleStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (state.machineProgram === undefined) {
    return appendAArch64PlanningRecord(state, {
      stageKey: "plan-pairs-prefetch-barriers-schedule",
      subjectKey: "program",
      action: "pairs-prefetch-barriers-schedule-skipped",
      explanation: ["plan-pairs-prefetch-barriers-schedule:missing-machine-program"],
    });
  }
  const planningPreservedFacts =
    state.preservedFacts ??
    preserveAArch64MachineFactsStageState(state).preservedFacts ??
    emptyAArch64PreservedFactSet();
  const scheduleOrderByBlock: Record<string, readonly number[]> = {};
  const planningStates = state.machineProgram.functions.entries().map((machineFunction) => {
    const initialPlanningState = createAArch64MachinePlanningState({
      machineFunction,
      preservedFacts: planningPreservedFacts,
      targetPlanning: state.target.planning,
    });
    const pairPlanned = planAArch64LoadStorePairsForPlanningState({
      state: initialPlanningState,
    });
    const prefetchPlanned = planAArch64PrefetchesForPlanningState({ state: pairPlanned });
    const barrierPlanned = placeAArch64BarriersForPlanningState({ state: prefetchPlanned });
    const planned = scheduleAArch64MachinePlanningState({ state: barrierPlanned });
    Object.assign(scheduleOrderByBlock, planned.scheduleOrderByBlock);
    return planned;
  });
  const functions = planningStates.map((planningState) => planningState.machineFunction);
  const nextState = Object.freeze({
    ...state,
    machineProgram: aarch64MachineProgram({ ...state.machineProgram, functions }),
    preservedFacts: planningPreservedFacts,
    dependencyEdges: Object.freeze(
      planningStates.flatMap((planningState) => planningState.dependencyGraph.edges),
    ),
    requiredEdges: Object.freeze(
      planningStates.flatMap((planningState) => planningState.requiredConstraints.edges),
    ),
    scheduleOrderByBlock: Object.freeze(scheduleOrderByBlock),
  });
  return appendAArch64PlanningRecord(nextState, {
    stageKey: "plan-pairs-prefetch-barriers-schedule",
    subjectKey: "program",
    action: "pairs-prefetch-barriers-schedule-planned",
    explanation: [
      `plan-pairs-prefetch-barriers-schedule:blocks:${Object.keys(scheduleOrderByBlock).length}`,
    ],
  });
}

import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64PlanningTargetSurface } from "../target-surface/target-surface";
import {
  buildAArch64MachineDependencyGraph,
  requiredConstraintsForAArch64Function,
  type AArch64MachineDependencyGraph,
} from "./machine-dependency-graph";
import type { AArch64RequiredConstraintSet } from "./required-constraints";
import { verifyRequiredEdgesComplete } from "./required-constraints";

export interface AArch64PlanningExplanation {
  readonly key: string;
  readonly detail: string;
}

export interface AArch64MachinePlanningState {
  readonly machineFunction: AArch64MachineFunction;
  readonly dependencyGraph: AArch64MachineDependencyGraph;
  readonly requiredConstraints: AArch64RequiredConstraintSet;
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly targetPlanning: AArch64PlanningTargetSurface;
  readonly scheduleOrderByBlock: Readonly<Record<string, readonly number[]>>;
  readonly explanations: readonly AArch64PlanningExplanation[];
  readonly revision: number;
}

export function createAArch64MachinePlanningState(input: {
  readonly machineFunction: AArch64MachineFunction;
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly targetPlanning: AArch64PlanningTargetSurface;
}): AArch64MachinePlanningState {
  const requiredConstraints = requiredConstraintsForAArch64Function(input.machineFunction, {
    preservedFacts: input.preservedFacts,
    targetPlanning: input.targetPlanning,
  });
  return Object.freeze({
    machineFunction: input.machineFunction,
    dependencyGraph: buildAArch64MachineDependencyGraph({
      machineFunction: input.machineFunction,
      requiredConstraints,
    }),
    requiredConstraints,
    preservedFacts: input.preservedFacts,
    targetPlanning: input.targetPlanning,
    scheduleOrderByBlock: Object.freeze({}),
    explanations: [],
    revision: 0,
  });
}

export function updateAArch64MachinePlanningState(input: {
  readonly state: AArch64MachinePlanningState;
  readonly reason: string;
  readonly machineFunction: AArch64MachineFunction;
  readonly graphUpdate?: { readonly kind: "recompute" };
  readonly scheduleOrderByBlock?: Readonly<Record<string, readonly number[]>>;
  readonly explanation?: AArch64PlanningExplanation;
}): AArch64MachinePlanningState {
  if (input.graphUpdate !== undefined && input.graphUpdate.kind !== "recompute") {
    throw new RangeError(`unsupported planning graph update ${input.graphUpdate.kind}`);
  }
  const requiredConstraints = requiredConstraintsForAArch64Function(input.machineFunction, {
    preservedFacts: input.state.preservedFacts,
    targetPlanning: input.state.targetPlanning,
  });
  const dependencyGraph = buildAArch64MachineDependencyGraph({
    machineFunction: input.machineFunction,
    requiredConstraints,
  });
  const completeness = verifyRequiredEdgesComplete({
    graphEdges: dependencyGraph.edges,
    requiredEdges: requiredConstraints.edges,
  });
  if (completeness.kind === "error") {
    throw new RangeError(
      completeness.diagnostics.map((diagnostic) => diagnostic.stableDetail).join("\n"),
    );
  }
  return Object.freeze({
    ...input.state,
    machineFunction: input.machineFunction,
    dependencyGraph,
    requiredConstraints,
    explanations: Object.freeze([
      ...input.state.explanations,
      input.explanation ?? { key: input.reason, detail: input.reason },
    ]),
    scheduleOrderByBlock: input.scheduleOrderByBlock ?? input.state.scheduleOrderByBlock,
    revision: input.state.revision + 1,
  });
}

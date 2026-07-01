import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import { aarch64MachineProgram } from "../machine-ir/machine-program";
import type { AArch64InstructionOperand } from "../machine-ir/operands";
import { appendAArch64PlanningRecord, type AArch64LoweringState } from "../lower/pipeline-stages";
import type { AArch64PlanningTargetSurface } from "../target-surface/target-surface";
import {
  aarch64RequiredConstraintSet,
  compareDependencyEdges,
  type AArch64DependencyEdge,
  type AArch64RequiredConstraintSet,
  type AArch64RequiredConstraintProvider,
} from "./required-constraints";

export interface AArch64MachineDependencyGraph {
  readonly edges: readonly AArch64DependencyEdge[];
}

export interface AArch64RequiredConstraintContext {
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly targetPlanning?: AArch64PlanningTargetSurface;
  readonly providers?: readonly AArch64RequiredConstraintProvider[];
}

export function buildAArch64MachineDependencyGraph(input: {
  readonly machineFunction: AArch64MachineFunction;
  readonly requiredConstraints?: AArch64RequiredConstraintSet;
}): AArch64MachineDependencyGraph {
  const edges: AArch64DependencyEdge[] = [];
  for (const block of input.machineFunction.blocks) {
    const definitions = new Map<number, number>();
    const resourceDefinitions = new Map<string, number>();
    let barrierInstruction: number | undefined;
    let lastMemoryEffectInstruction: number | undefined;
    for (const instruction of [
      ...block.instructions,
      ...(block.terminator === undefined ? [] : [block.terminator]),
    ]) {
      const instructionId = Number(instruction.instructionId);
      for (const operand of instruction.operands) {
        if (operand.operand.kind === "vreg" && isUseOperand(operand)) {
          const definition = definitions.get(Number(operand.operand.register.vreg));
          if (definition !== undefined)
            edges.push(edge(definition, instructionId, "register", "vreg"));
        }
        if (operand.operand.kind === "vreg" && isDefOperand(operand)) {
          definitions.set(Number(operand.operand.register.vreg), instructionId);
        }
        if (operand.operand.kind === "resource") {
          const resourceKey = operand.operand.resource.kind;
          const definition = resourceDefinitions.get(resourceKey);
          if (operand.role === "implicitUse" && definition !== undefined) {
            edges.push(edge(definition, instructionId, "resource", resourceKey));
          }
          if (operand.role === "implicitDef") {
            resourceDefinitions.set(resourceKey, instructionId);
          }
        }
      }
      if (barrierInstruction !== undefined)
        edges.push(edge(barrierInstruction, instructionId, "barrier", "memory-order"));
      if (isMemoryEffectInstruction(instruction)) {
        if (lastMemoryEffectInstruction !== undefined) {
          edges.push(edge(lastMemoryEffectInstruction, instructionId, "memory", "effect"));
        }
        lastMemoryEffectInstruction = instructionId;
      }
      if (String(instruction.opcode) === "dmb" || String(instruction.opcode) === "dsb") {
        barrierInstruction = instructionId;
      }
    }
  }
  return Object.freeze({
    edges: Object.freeze(
      [...(input.requiredConstraints?.edges ?? []), ...edges].sort(compareDependencyEdges),
    ),
  });
}

function isMemoryEffectInstruction(
  instruction: AArch64MachineFunction["blocks"][number]["instructions"][number],
): boolean {
  const opcode = String(instruction.opcode);
  return (
    instruction.flags.mayLoad === true ||
    instruction.flags.mayStore === true ||
    opcode === "bl" ||
    opcode === "blr" ||
    opcode === "dmb" ||
    opcode === "dsb"
  );
}

export function buildAArch64DependencyGraphStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (state.machineProgram === undefined) {
    return appendAArch64PlanningRecord(state, {
      stageKey: "build-dependency-graph",
      subjectKey: "program",
      action: "dependency-graph-skipped",
      explanation: ["build-dependency-graph:missing-machine-program"],
    });
  }
  const functionGraphs = state.machineProgram.functions.entries().map((machineFunction) => {
    const requiredConstraints = requiredConstraintsForAArch64Function(machineFunction, {
      preservedFacts: state.preservedFacts,
      targetPlanning: state.target.planning,
    });
    const dependencyGraph = buildAArch64MachineDependencyGraph({
      machineFunction,
      requiredConstraints,
    });
    return Object.freeze({
      machineFunction,
      requiredEdges: requiredConstraints.edges,
      dependencyEdges: dependencyGraph.edges,
    });
  });
  const requiredEdges = functionGraphs.flatMap((functionGraph) => functionGraph.requiredEdges);
  const dependencyEdges = functionGraphs.flatMap((functionGraph) => functionGraph.dependencyEdges);
  const nextProgram = aarch64MachineProgram({
    ...state.machineProgram,
    functions: functionGraphs.map((functionGraph) =>
      aarch64MachineFunction({
        ...functionGraph.machineFunction,
        schedulePlan: [
          ...functionGraph.machineFunction.schedulePlan,
          `dependency-graph:edges:${functionGraph.dependencyEdges.length}`,
        ],
      }),
    ),
  });
  const nextState = Object.freeze({
    ...state,
    machineProgram: nextProgram,
    dependencyEdges: Object.freeze([...dependencyEdges].sort(compareDependencyEdges)),
    requiredEdges: Object.freeze([...requiredEdges].sort(compareDependencyEdges)),
  });
  return appendAArch64PlanningRecord(nextState, {
    stageKey: "build-dependency-graph",
    subjectKey: "program",
    action: "dependency-graph-built",
    explanation: [`build-dependency-graph:edges:${dependencyEdges.length}`],
  });
}

export function requiredConstraintsForAArch64Function(
  machineFunction: AArch64MachineFunction,
  context: AArch64RequiredConstraintContext = {},
): AArch64RequiredConstraintSet {
  const providers = context.providers ?? defaultAArch64RequiredConstraintProviders;
  const edges = providers.flatMap((provider) =>
    provider.requiredEdgesFor({
      machineFunction,
      preservedFacts: context.preservedFacts,
      targetPlanning: context.targetPlanning,
    }),
  );
  return aarch64RequiredConstraintSet(edges);
}

const defaultAArch64RequiredConstraintProviders: readonly AArch64RequiredConstraintProvider[] =
  Object.freeze([
    {
      providerKey: "machine-ir",
      requiredEdgesFor: ({ machineFunction }) =>
        machineIrRequiredEdgesForAArch64Function(machineFunction),
    },
    {
      providerKey: "preserved-facts",
      requiredEdgesFor: ({ machineFunction, preservedFacts }) =>
        preservedFactRequiredEdgesForAArch64Function(machineFunction, preservedFacts),
    },
  ]);

function machineIrRequiredEdgesForAArch64Function(
  machineFunction: AArch64MachineFunction,
): readonly AArch64DependencyEdge[] {
  const edges: AArch64DependencyEdge[] = [];
  for (const block of machineFunction.blocks) {
    const instructions = [
      ...block.instructions,
      ...(block.terminator === undefined ? [] : [block.terminator]),
    ];
    let previousMemory: number | undefined;
    let previousCall: number | undefined;
    let previousBarrier: number | undefined;
    let previousMayTrap: number | undefined;
    const previousInstructionIds: number[] = [];
    const resourceDefinitions = new Map<string, number>();
    for (const instruction of instructions) {
      const instructionId = Number(instruction.instructionId);
      const isMemory = instruction.flags.mayLoad === true || instruction.flags.mayStore === true;
      const isCall = String(instruction.opcode) === "bl" || String(instruction.opcode) === "blr";
      const isBarrier =
        String(instruction.opcode) === "dmb" || String(instruction.opcode) === "dsb";
      if (previousMemory !== undefined && (isMemory || isCall || isBarrier)) {
        edges.push(edge(previousMemory, instructionId, "memory", "memory-order"));
      }
      if (previousCall !== undefined && (isMemory || isCall || instruction.flags.isTerminator)) {
        edges.push(edge(previousCall, instructionId, "call", "call-effect"));
      }
      if (previousCall !== undefined) {
        for (const resource of abiReturnResourcesUsedByInstruction(instruction)) {
          edges.push(callResultEdge(previousCall, instructionId, resource));
        }
      }
      if (previousBarrier !== undefined && isMemory) {
        edges.push(edge(previousBarrier, instructionId, "barrier", "memory-order"));
      }
      if (previousMayTrap !== undefined && instruction.flags.mayTrap) {
        edges.push(edge(previousMayTrap, instructionId, "mayTrap", "trap-order"));
      }
      if (instruction.flags.isTerminator === true) {
        edges.push(
          ...previousInstructionIds.map((previousInstructionId) =>
            edge(previousInstructionId, instructionId, "control", "terminator-order"),
          ),
        );
      }
      for (const operand of instruction.operands) {
        if (operand.operand.kind !== "resource") {
          continue;
        }
        const resourceKey = operand.operand.resource.kind;
        const definition = resourceDefinitions.get(resourceKey);
        if (operand.role === "implicitUse" && definition !== undefined) {
          edges.push(edge(definition, instructionId, "resource", resourceKey));
        }
        if (operand.role === "implicitDef") {
          resourceDefinitions.set(resourceKey, instructionId);
        }
      }
      if (
        instruction.security?.constantTime === true ||
        instruction.security?.zeroization?.required === true
      ) {
        const predecessor = previousMemory ?? previousCall;
        if (predecessor !== undefined) {
          edges.push(edge(predecessor, instructionId, "security", "security-motion"));
        }
      }
      if (instruction.schedule.errataConstraints.length > 0) {
        const predecessor = previousMemory ?? previousCall ?? previousMayTrap;
        if (predecessor !== undefined) {
          edges.push(
            edge(
              predecessor,
              instructionId,
              "errata",
              instruction.schedule.errataConstraints.join("+"),
            ),
          );
        }
      }
      if (isMemory) previousMemory = instructionId;
      if (isCall) previousCall = instructionId;
      if (isBarrier) previousBarrier = instructionId;
      if (instruction.flags.mayTrap) previousMayTrap = instructionId;
      previousInstructionIds.push(instructionId);
    }
  }
  return edges;
}

function preservedFactRequiredEdgesForAArch64Function(
  machineFunction: AArch64MachineFunction,
  preservedFacts: AArch64PreservedFactSet | undefined,
): readonly AArch64DependencyEdge[] {
  if (preservedFacts === undefined) return [];
  const instructionIds = instructionIdsForFunction(machineFunction);
  return preservedFacts.records.flatMap((record) => {
    if (record.subject.kind !== "machineEdge") return [];
    const parsed = dependencyEdgeFromKey(record.subject.edgeKey);
    if (parsed === undefined) return [];
    if (!instructionIds.has(parsed.fromInstruction) || !instructionIds.has(parsed.toInstruction)) {
      return [];
    }
    return [
      Object.freeze({
        ...parsed,
        requiredBy: Object.freeze([
          "preserved-facts",
          `subject:${record.subject.edgeKey}`,
          ...parsed.requiredBy,
        ]),
      }),
    ];
  });
}

function dependencyEdgeFromKey(edgeKey: string): AArch64DependencyEdge | undefined {
  const match = /^(\d+)->(\d+):([^:]+):(.*)$/.exec(edgeKey);
  if (match === null) return undefined;
  const kind = dependencyEdgeKindFromString(match[3] ?? "");
  if (kind === undefined) return undefined;
  const payload = match[4] ?? "";
  const requiredBySeparator = payload.lastIndexOf(":");
  if (requiredBySeparator < 0) return undefined;
  const resource = payload.slice(0, requiredBySeparator);
  const requiredBy = payload.slice(requiredBySeparator + 1);
  return Object.freeze({
    fromInstruction: Number(match[1]),
    toInstruction: Number(match[2]),
    kind,
    ...(resource.length === 0 ? {} : { resource }),
    requiredBy: Object.freeze(
      requiredBy
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  });
}

function dependencyEdgeKindFromString(value: string): AArch64DependencyEdge["kind"] | undefined {
  switch (value) {
    case "register":
    case "memory":
    case "resource":
    case "call":
    case "barrier":
    case "mayTrap":
    case "errata":
    case "security":
    case "control":
      return value;
    default:
      return undefined;
  }
}

function instructionIdsForFunction(machineFunction: AArch64MachineFunction): ReadonlySet<number> {
  return new Set(
    machineFunction.blocks.flatMap((block) => [
      ...block.instructions.map((instruction) => Number(instruction.instructionId)),
      ...(block.terminator === undefined ? [] : [Number(block.terminator.instructionId)]),
    ]),
  );
}

function edge(
  fromInstruction: number,
  toInstruction: number,
  kind: AArch64DependencyEdge["kind"],
  resource: string,
): AArch64DependencyEdge {
  return Object.freeze({
    fromInstruction,
    toInstruction,
    kind,
    resource,
    requiredBy: Object.freeze([resource]),
  });
}

function callResultEdge(
  fromInstruction: number,
  toInstruction: number,
  resource: string,
): AArch64DependencyEdge {
  return Object.freeze({
    fromInstruction,
    toInstruction,
    kind: "call",
    resource,
    requiredBy: Object.freeze(["call-result", resource]),
  });
}

function abiReturnResourcesUsedByInstruction(
  instruction: AArch64MachineFunction["blocks"][number]["instructions"][number],
): readonly string[] {
  const resources = new Set<string>();
  for (const operand of instruction.operands) {
    if (operand.operand.kind !== "vreg" || !isUseOperand(operand)) {
      continue;
    }
    const origin = operand.operand.register.origin;
    if (origin?.kind !== "synthetic") {
      continue;
    }
    const match = /:abi-return:([^:]+):/.exec(origin.stableKey);
    if (match !== null && match[1] !== undefined) {
      resources.add(`abi-return:${match[1]}`);
    }
  }
  return Object.freeze([...resources].sort());
}

function isUseOperand(operand: AArch64InstructionOperand): boolean {
  return (
    operand.role === "use" ||
    operand.role === "tiedDefUse" ||
    operand.role === "memoryBase" ||
    operand.role === "memoryIndex"
  );
}

function isDefOperand(operand: AArch64InstructionOperand): boolean {
  return operand.role === "def" || operand.role === "tiedDefUse";
}

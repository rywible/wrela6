import type { AArch64DependencyEdge } from "../plan/required-constraints";
import { verifyRequiredEdgesComplete } from "../plan/required-constraints";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64SchedulerVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "scheduler",
  verify(context) {
    if (context.dependencyEdges === undefined || context.requiredEdges === undefined) {
      return [];
    }
    return [
      ...verifyAArch64ScheduleMetadata(context),
      ...verifyAArch64Schedule({
        graphEdges: context.dependencyEdges,
        requiredEdges: context.requiredEdges,
        context,
      }),
    ];
  },
};

export function verifyAArch64Schedule(input: {
  readonly graphEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
  readonly context: AArch64MachineVerifierContext;
}) {
  const completeness = verifyRequiredEdgesComplete({
    graphEdges: input.graphEdges,
    requiredEdges: input.requiredEdges,
  });
  return completeness.kind === "ok" ? [] : completeness.diagnostics;
}

function verifyAArch64ScheduleMetadata(context: AArch64MachineVerifierContext) {
  return context.program.functions.entries().flatMap((machineFunction) => {
    const diagnostics = [];
    const functionId = Number(machineFunction.functionId);
    const instructionIds = new Set(
      machineFunction.blocks.flatMap((block) => instructionIdsForBlock(block)),
    );
    if (instructionIds.size === 0) {
      return [];
    }

    const dependencyPlan = dependencyPlanCount(machineFunction.schedulePlan);
    const expectedDependencyEdges = (context.dependencyEdges ?? []).filter(
      (edge) => instructionIds.has(edge.fromInstruction) || instructionIds.has(edge.toInstruction),
    );
    if (dependencyPlan.kind !== "ok") {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
          ownerKey: `function:${functionId}`,
          rootCauseKey: "machine-planning",
          stableDetail: dependencyPlan.reason,
        }),
      );
    } else if (dependencyPlan.edgeCount !== expectedDependencyEdges.length) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
          ownerKey: `function:${functionId}`,
          rootCauseKey: "machine-planning",
          stableDetail: `dependency-graph-count-mismatch:${dependencyPlan.edgeCount}:${expectedDependencyEdges.length}`,
        }),
      );
    }

    const scheduleEntries = machineFunction.schedulePlan.filter((entry) =>
      entry.startsWith("schedule:block:"),
    );
    if (scheduleEntries.length === 0) {
      diagnostics.push(
        context.makeDiagnostic({
          code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
          ownerKey: `function:${functionId}`,
          rootCauseKey: "machine-planning",
          stableDetail: "planning-metadata-missing",
        }),
      );
      return diagnostics;
    }

    const parsedSchedules = new Map<string, readonly number[]>();
    for (const entry of scheduleEntries) {
      const parsed = parseBlockScheduleEntry(entry);
      if (parsed.kind === "error") {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
            ownerKey: `function:${functionId}`,
            rootCauseKey: "machine-planning",
            stableDetail: parsed.reason,
          }),
        );
        continue;
      }
      if (parsed.functionId !== functionId) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
            ownerKey: `function:${functionId}`,
            rootCauseKey: "machine-planning",
            stableDetail: `schedule-function-mismatch:${parsed.functionId}:${functionId}`,
          }),
        );
        continue;
      }
      parsedSchedules.set(`${parsed.functionId}:${parsed.blockId}`, parsed.order);
    }

    for (const block of machineFunction.blocks) {
      const blockKey = `${functionId}:${Number(block.blockId)}`;
      const expectedOrder = instructionIdsForBlock(block);
      const persistedOrder = parsedSchedules.get(blockKey);
      if (persistedOrder === undefined) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
            ownerKey: `block:${blockKey}`,
            rootCauseKey: "machine-planning",
            stableDetail: `schedule-block-missing:${blockKey}`,
          }),
        );
        continue;
      }
      if (!sameInstructionSet(expectedOrder, persistedOrder)) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
            ownerKey: `block:${blockKey}`,
            rootCauseKey: "machine-planning",
            stableDetail: `schedule-block-coverage-invalid:${blockKey}:expected:${expectedOrder.join(",")}:actual:${persistedOrder.join(",")}`,
          }),
        );
      }
      const stateOrder = context.scheduleOrderByBlock?.[blockKey];
      if (stateOrder !== undefined && !sameOrder(stateOrder, persistedOrder)) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
            ownerKey: `block:${blockKey}`,
            rootCauseKey: "machine-planning",
            stableDetail: `schedule-state-mismatch:${blockKey}`,
          }),
        );
      }
      diagnostics.push(
        ...verifyBlockDependencyOrder({
          context,
          blockKey,
          order: persistedOrder,
          stableDetailPrefix: "schedule-order-violates-edge",
          dependencyEdges: expectedDependencyEdges.filter(
            (edge) =>
              expectedOrder.includes(edge.fromInstruction) &&
              expectedOrder.includes(edge.toInstruction),
          ),
        }),
      );
      diagnostics.push(
        ...verifyBlockDependencyOrder({
          context,
          blockKey,
          order: expectedOrder,
          stableDetailPrefix: "physical-order-violates-edge",
          dependencyEdges: expectedDependencyEdges.filter(
            (edge) =>
              expectedOrder.includes(edge.fromInstruction) &&
              expectedOrder.includes(edge.toInstruction),
          ),
        }),
      );
    }

    return diagnostics;
  });
}

function verifyBlockDependencyOrder(input: {
  readonly context: AArch64MachineVerifierContext;
  readonly blockKey: string;
  readonly order: readonly number[];
  readonly stableDetailPrefix: string;
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
}) {
  const positions = new Map(input.order.map((instructionId, index) => [instructionId, index]));
  return input.dependencyEdges.flatMap((edge) => {
    const fromIndex = positions.get(edge.fromInstruction);
    const toIndex = positions.get(edge.toInstruction);
    if (fromIndex === undefined || toIndex === undefined || fromIndex <= toIndex) {
      return [];
    }
    return [
      input.context.makeDiagnostic({
        code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
        ownerKey: `block:${input.blockKey}`,
        rootCauseKey: edge.requiredBy.join(","),
        stableDetail: `${input.stableDetailPrefix}:${edge.fromInstruction}:${edge.toInstruction}:${edge.kind}`,
      }),
    ];
  });
}

function dependencyPlanCount(
  schedulePlan: readonly string[],
):
  | { readonly kind: "ok"; readonly edgeCount: number }
  | { readonly kind: "error"; readonly reason: string } {
  const entry = [...schedulePlan]
    .reverse()
    .find((candidate) => candidate.startsWith("dependency-graph:"));
  if (entry === undefined) {
    return { kind: "error", reason: "planning-metadata-missing" };
  }
  const match = /^dependency-graph:edges:(\d+)$/.exec(entry);
  if (match === null) {
    return { kind: "error", reason: `dependency-graph-entry-malformed:${entry}` };
  }
  return { kind: "ok", edgeCount: Number(match[1]) };
}

function parseBlockScheduleEntry(entry: string):
  | {
      readonly kind: "ok";
      readonly functionId: number;
      readonly blockId: number;
      readonly order: readonly number[];
    }
  | { readonly kind: "error"; readonly reason: string } {
  const match = /^schedule:block:(\d+):(\d+):(.*)$/.exec(entry);
  if (match === null) {
    return { kind: "error", reason: `schedule-block-entry-malformed:${entry}` };
  }
  const orderText = match[3] ?? "";
  const order =
    orderText === ""
      ? []
      : orderText.split(",").map((part) => (part.length === 0 ? Number.NaN : Number(part)));
  if (order.some((instructionId) => !Number.isInteger(instructionId) || instructionId < 0)) {
    return { kind: "error", reason: `schedule-block-order-malformed:${entry}` };
  }
  return {
    kind: "ok",
    functionId: Number(match[1]),
    blockId: Number(match[2]),
    order: Object.freeze(order),
  };
}

function instructionIdsForBlock(
  block: ReturnType<
    AArch64MachineVerifierContext["program"]["functions"]["entries"]
  >[number]["blocks"][number],
): readonly number[] {
  return [
    ...block.instructions.map((instruction) => Number(instruction.instructionId)),
    ...(block.terminator === undefined ? [] : [Number(block.terminator.instructionId)]),
  ];
}

function sameInstructionSet(left: readonly number[], right: readonly number[]): boolean {
  return sameOrder([...left].sort(compareNumber), [...right].sort(compareNumber));
}

function sameOrder(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

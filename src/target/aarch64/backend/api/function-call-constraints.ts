import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64ReconciledCallBoundary } from "../abi/call-boundary-reconciliation";
import type { AArch64LoweringCallBoundary } from "./machine-lowering";

export interface AArch64CallLocationConstraint {
  readonly vreg: number;
  readonly instructionOrder: number;
  readonly register: string;
}

export function callLocationConstraintsForFunction(
  machineFunction: AArch64MachineFunction,
  boundaries: readonly AArch64ReconciledCallBoundary[],
): readonly AArch64CallLocationConstraint[] {
  const boundaryByInstructionId = boundaryByCallInstructionId(boundaries);
  return Object.freeze(
    orderedMachineInstructions(machineFunction).flatMap(
      (point): AArch64CallLocationConstraint[] => {
        const boundary = boundaryByInstructionId.get(point.instructionId);
        if (boundary === undefined) return [];
        const argumentVregs = point.instruction.operands.flatMap((operand) =>
          operand.role === "use" && operand.operand.kind === "vreg"
            ? [Number(operand.operand.register.vreg)]
            : [],
        );
        return callAssignmentRegisters(boundary.argumentLocations)
          .slice(0, argumentVregs.length)
          .flatMap((register, index) => {
            const vreg = argumentVregs[index];
            return vreg === undefined ? [] : [{ vreg, instructionOrder: point.order, register }];
          });
      },
    ),
  );
}

export function loweringCallBoundaries(
  machineFunction: AArch64MachineFunction,
  boundaries: readonly AArch64ReconciledCallBoundary[],
): readonly AArch64LoweringCallBoundary[] {
  const boundaryByInstructionId = boundaryByCallInstructionId(boundaries);
  return Object.freeze(
    orderedMachineInstructions(machineFunction).flatMap((point): AArch64LoweringCallBoundary[] => {
      const boundary = boundaryByInstructionId.get(point.instructionId);
      if (boundary === undefined) return [];
      return [
        {
          instructionId: point.instructionId,
          argumentRegisters: callAssignmentRegisters(boundary.argumentLocations),
          resultRegisters: callAssignmentRegisters(boundary.resultLocations),
        },
      ];
    }),
  );
}

export function constraintsByVirtualRegister(
  constraints: readonly AArch64CallLocationConstraint[],
): ReadonlyMap<number, readonly AArch64CallLocationConstraint[]> {
  const byVreg = new Map<number, AArch64CallLocationConstraint[]>();
  for (const constraint of constraints) {
    const entries = byVreg.get(constraint.vreg) ?? [];
    entries.push(constraint);
    byVreg.set(constraint.vreg, entries);
  }
  return new Map(
    [...byVreg.entries()].map(([vreg, entries]) => [
      vreg,
      Object.freeze(entries.sort((left, right) => left.instructionOrder - right.instructionOrder)),
    ]),
  );
}

export function requiredPhysicalRegisterForSegment(
  segment: { readonly startOrder: number; readonly endOrder: number },
  constraints: readonly AArch64CallLocationConstraint[] | undefined,
): { readonly requiredPhysicalRegister?: string } {
  const constraint = constraints?.find(
    (candidate) =>
      candidate.instructionOrder >= segment.startOrder &&
      candidate.instructionOrder <= segment.endOrder,
  );
  return constraint === undefined
    ? {}
    : {
        requiredPhysicalRegister: constraint.register,
      };
}

function boundaryByCallInstructionId(
  boundaries: readonly AArch64ReconciledCallBoundary[],
): ReadonlyMap<number, AArch64ReconciledCallBoundary> {
  return new Map(
    boundaries.flatMap((boundary) => {
      const instructionId = instructionIdFromCallKey(boundary.callKey);
      return instructionId === undefined ? [] : [[instructionId, boundary] as const];
    }),
  );
}

function orderedMachineInstructions(machineFunction: AArch64MachineFunction): readonly {
  readonly instructionId: number;
  readonly order: number;
  readonly instruction: AArch64MachineFunction["blocks"][number]["instructions"][number];
}[] {
  const points: {
    readonly instructionId: number;
    readonly order: number;
    readonly instruction: AArch64MachineFunction["blocks"][number]["instructions"][number];
  }[] = [];
  for (const block of machineFunction.blocks) {
    for (const instruction of block.instructions) {
      points.push({
        instructionId: Number(instruction.instructionId),
        order: points.length,
        instruction,
      });
    }
    if (block.terminator !== undefined) {
      points.push({
        instructionId: Number(block.terminator.instructionId),
        order: points.length,
        instruction: block.terminator,
      });
    }
  }
  return Object.freeze(points);
}

function callAssignmentRegisters(
  assignments: readonly AArch64ReconciledCallBoundary["argumentLocations"][number][],
): readonly string[] {
  return Object.freeze(
    assignments.flatMap((assignment) => {
      const location = assignment.location;
      if (location.kind === "gpr" || location.kind === "vector") return [location.register];
      if (location.kind === "vectorGroup") return [...location.registers];
      return [];
    }),
  );
}

function instructionIdFromCallKey(callKey: string): number | undefined {
  const match = /:insn:(\d+)$/.exec(callKey);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

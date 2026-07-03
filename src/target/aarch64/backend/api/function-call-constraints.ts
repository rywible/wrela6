import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64VirtualRegisterOrigin } from "../../machine-ir/virtual-register";
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
  const constraints: AArch64CallLocationConstraint[] = [];
  let previousCall:
    | {
        readonly order: number;
      }
    | undefined;
  for (const point of orderedMachineInstructions(machineFunction)) {
    if (isCallInstruction(point.instruction)) {
      const boundary = boundaryByInstructionId.get(point.instructionId);
      constraints.push(...callArgumentLocationConstraints(point, boundary));
      previousCall = { order: point.order };
      continue;
    }
    if (previousCall !== undefined) {
      constraints.push(...callReturnLocationConstraints(point.instruction, previousCall.order));
    }
  }
  return uniqueCallLocationConstraints(constraints);
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

function callArgumentLocationConstraints(
  point: {
    readonly order: number;
    readonly instruction: AArch64MachineInstruction;
  },
  boundary: AArch64ReconciledCallBoundary | undefined,
): readonly AArch64CallLocationConstraint[] {
  const boundaryRegisters = callAssignmentRegisters(boundary?.argumentLocations ?? []);
  const argumentConstraints = callArgumentOperands(point.instruction).flatMap((operand, index) => {
    if (operand.operand.kind !== "vreg") return [];
    const vreg = Number(operand.operand.register.vreg);
    const register =
      abiRegisterFromSyntheticOrigin(operand.operand.register.origin, "abi-arg") ??
      boundaryRegisters[index];
    return register === undefined ? [] : [{ vreg, instructionOrder: point.order, register }];
  });
  return Object.freeze([
    ...indirectCallTargetLocationConstraints(point, argumentConstraints),
    ...argumentConstraints,
  ]);
}

function indirectCallTargetLocationConstraints(
  point: {
    readonly order: number;
    readonly instruction: AArch64MachineInstruction;
  },
  argumentConstraints: readonly AArch64CallLocationConstraint[],
): readonly AArch64CallLocationConstraint[] {
  if (String(point.instruction.opcode) !== "blr" || argumentConstraints.length === 0) {
    return Object.freeze([]);
  }
  const target = point.instruction.operands.find(
    (operand) => operand.role === "use" && operand.operand.kind === "vreg",
  );
  return Object.freeze(
    target?.operand.kind !== "vreg"
      ? []
      : [
          {
            vreg: Number(target.operand.register.vreg),
            instructionOrder: point.order,
            register: "x16",
          },
        ],
  );
}

function callReturnLocationConstraints(
  instruction: AArch64MachineInstruction,
  callOrder: number,
): readonly AArch64CallLocationConstraint[] {
  return Object.freeze(
    instruction.operands.flatMap((operand) => {
      if (operand.operand.kind !== "vreg") return [];
      if (!isUseOperand(operand.role)) return [];
      const register = abiRegisterFromSyntheticOrigin(
        operand.operand.register.origin,
        "abi-return",
      );
      return register === undefined
        ? []
        : [
            {
              vreg: Number(operand.operand.register.vreg),
              instructionOrder: callOrder,
              register,
            },
          ];
    }),
  );
}

function callArgumentOperands(
  instruction: AArch64MachineInstruction,
): readonly AArch64MachineInstruction["operands"][number][] {
  const operands = instruction.operands.filter(
    (operand) => operand.role === "use" && operand.operand.kind === "vreg",
  );
  return String(instruction.opcode) === "blr" ? Object.freeze(operands.slice(1)) : operands;
}

function abiRegisterFromSyntheticOrigin(
  origin: AArch64VirtualRegisterOrigin | undefined,
  prefix: "abi-arg" | "abi-return",
): string | undefined {
  if (origin?.kind !== "synthetic") return undefined;
  const match = new RegExp(`(?:^|:)${prefix}:(intReg|vectorReg):(\\d+):`).exec(origin.stableKey);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const registerIndex = Number(match[2]);
  if (!Number.isInteger(registerIndex)) return undefined;
  return match[1] === "intReg" ? `x${registerIndex}` : `v${registerIndex}`;
}

function isCallInstruction(instruction: AArch64MachineInstruction): boolean {
  const opcode = String(instruction.opcode);
  return opcode === "bl" || opcode === "blr";
}

function isUseOperand(role: AArch64MachineInstruction["operands"][number]["role"]): boolean {
  return role === "use" || role === "tiedDefUse" || role === "memoryBase" || role === "memoryIndex";
}

function uniqueCallLocationConstraints(
  constraints: readonly AArch64CallLocationConstraint[],
): readonly AArch64CallLocationConstraint[] {
  const byKey = new Map<string, AArch64CallLocationConstraint>();
  for (const constraint of constraints) {
    byKey.set(
      `${constraint.vreg}:${constraint.instructionOrder}:${constraint.register}`,
      constraint,
    );
  }
  return Object.freeze([...byKey.values()]);
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

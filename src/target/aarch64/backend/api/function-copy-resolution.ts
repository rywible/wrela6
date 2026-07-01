import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64AbiLocation as AArch64MachineAbiLocation } from "../../machine-ir/abi-location";
import type { AArch64AllocationResult } from "../allocation/allocation-result";
import type { AArch64ParallelCopy, AArch64ResolvedMove } from "../allocation/move-resolution";
import type {
  AArch64PhysicalInstruction,
  AArch64PhysicalOperand,
} from "../finalization/physical-instruction-ir";
import type { AArch64BackendTargetSurface } from "./backend-target-surface";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "./diagnostics";
import { commitAArch64InstructionRewrite } from "./backend-rewrite-application";
import { aarch64PhysicalRegisterStorageKey } from "./physical-register-helpers";

export function physicalRegisterAliasPairs(target: AArch64BackendTargetSurface): readonly {
  readonly left: string;
  readonly right: string;
}[] {
  const registersByStorageKey = new Map<string, string[]>();
  for (const register of target.registerModel.registers) {
    const storageKey = aarch64PhysicalRegisterStorageKey(register.stableKey, register.aliasSet);
    if (storageKey === undefined) continue;
    const registers = registersByStorageKey.get(storageKey) ?? [];
    registers.push(register.stableKey);
    registersByStorageKey.set(storageKey, registers);
  }
  return Object.freeze(
    [...registersByStorageKey.values()]
      .flatMap((registers) =>
        registers
          .sort(compareCodeUnitStrings)
          .flatMap((left, leftIndex) =>
            registers.slice(leftIndex + 1).map((right) => ({ left, right })),
          ),
      )
      .sort((left, right) => {
        const leftKey = `${left.left}:${left.right}`;
        const rightKey = `${right.left}:${right.right}`;
        return compareCodeUnitStrings(leftKey, rightKey);
      }),
  );
}

export function parallelCopiesForFunctionEntry(
  machineFunction: AArch64MachineFunction,
  allocation: AArch64AllocationResult,
): readonly AArch64ParallelCopy[] {
  return Object.freeze(
    machineFunction.parameters
      .flatMap((parameter): AArch64ParallelCopy[] => {
        const vreg = vregFromAbiValueKey(parameter.valueKey);
        const sourceRegister = registerForMachineAbiLocation(parameter.location);
        if (vreg === undefined || sourceRegister === undefined) return [];
        const destinationRegister = firstAllocatedRegisterForVreg(allocation, vreg);
        if (destinationRegister === undefined || destinationRegister === sourceRegister) return [];
        return [
          {
            sourceRegister,
            destinationRegister,
            value: parameter.valueKey,
          },
        ];
      })
      .sort(
        (left, right) =>
          compareCodeUnitStrings(left.destinationRegister, right.destinationRegister) ||
          compareCodeUnitStrings(left.sourceRegister, right.sourceRegister) ||
          compareCodeUnitStrings(left.value, right.value),
      ),
  );
}

export function physicalMoveInstructionsForResolvedCopies(
  functionKey: string,
  moves: readonly AArch64ResolvedMove[],
):
  | { readonly kind: "ok"; readonly instructions: readonly AArch64PhysicalInstruction[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] } {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const instructions: AArch64PhysicalInstruction[] = [];
  for (const [index, move] of moves.entries()) {
    const instruction = physicalMoveInstructionForResolvedCopy(functionKey, index, move);
    if (instruction === undefined) {
      diagnostics.push(
        moveResolutionDiagnostic(
          `move-resolution:unsupported-physical-move:${move.value}:${move.sourceRegister}->${move.destinationRegister}`,
        ),
      );
    } else {
      instructions.push(instruction);
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
  }
  if (instructions.length === 0) return { kind: "ok", instructions: Object.freeze([]) };
  const committed = commitAArch64InstructionRewrite({
    kind: "move-resolution",
    source: { stableKey: `${functionKey}:move-resolution`, opcode: "move-resolution" },
    replacements: instructions,
  });
  return committed.kind === "ok"
    ? { kind: "ok", instructions: committed.value.instructions }
    : { kind: "error", diagnostics: committed.diagnostics };
}

function firstAllocatedRegisterForVreg(
  allocation: AArch64AllocationResult,
  vreg: number,
): string | undefined {
  return allocation
    .segmentsFor(vreg)
    .filter((segment) => !segment.physical.startsWith("slot:"))
    .sort(
      (left, right) =>
        left.startOrder - right.startOrder ||
        left.endOrder - right.endOrder ||
        compareCodeUnitStrings(left.physical, right.physical),
    )[0]?.physical;
}

function registerForMachineAbiLocation(location: AArch64MachineAbiLocation): string | undefined {
  if (location.kind === "intReg") return `x${location.index}`;
  if (location.kind === "vectorReg") return `v${location.index}`;
  if (location.kind === "indirectResultPointer") return `x${location.index}`;
  return undefined;
}

function vregFromAbiValueKey(valueKey: string): number | undefined {
  const match = /^(?:vreg:|v)(\d+)$/.exec(valueKey);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function physicalMoveInstructionForResolvedCopy(
  functionKey: string,
  index: number,
  move: AArch64ResolvedMove,
): AArch64PhysicalInstruction | undefined {
  const stableKey = `${functionKey}:move-resolution:${index}:${move.value}`;
  if (isGeneralRegister(move.sourceRegister) && isGeneralRegister(move.destinationRegister)) {
    const operands: readonly AArch64PhysicalOperand[] = Object.freeze([
      { kind: "register", register: move.destinationRegister },
      { kind: "register", register: zeroRegisterForMove(move.destinationRegister) },
      { kind: "register", register: move.sourceRegister },
    ]);
    return Object.freeze({
      stableKey,
      opcode: "orr-shifted-register",
      operands,
      provenanceSource: `move:${move.value}`,
    });
  }
  if (isVectorRegister(move.sourceRegister) && isVectorRegister(move.destinationRegister)) {
    const operands: readonly AArch64PhysicalOperand[] = Object.freeze([
      { kind: "register", register: move.destinationRegister },
      { kind: "register", register: move.sourceRegister },
    ]);
    return Object.freeze({
      stableKey,
      opcode: "mov-vector",
      operands,
      provenanceSource: `move:${move.value}`,
    });
  }
  return undefined;
}

function isGeneralRegister(register: string): boolean {
  return /^(?:x|w)\d+$/.test(register);
}

function isVectorRegister(register: string): boolean {
  return /^(?:v|q|d|s|h|b)\d+$/.test(register);
}

function zeroRegisterForMove(destinationRegister: string): string {
  return destinationRegister.startsWith("w") ? "wzr" : "xzr";
}

function moveResolutionDiagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FINALIZATION_INVALID",
    ownerKey: "move-resolution",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}

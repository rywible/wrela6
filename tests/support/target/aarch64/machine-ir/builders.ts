import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import type {
  AArch64AbiBinding,
  AArch64AbiLocation,
} from "../../../../../src/target/aarch64/machine-ir/abi-location";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  implicitDefResource,
  symbolOperand,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../../src/target/aarch64/machine-ir/virtual-register";

export function aarch64Gpr64ForTest(id: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
    origin: { kind: "synthetic", stableKey: `fixture.gpr64.${id}` },
  });
}

export function aarch64MovzForTest(input: {
  readonly instructionId?: number;
  readonly value: bigint;
  readonly originStableKey?: string;
}) {
  const register = aarch64Gpr64ForTest(input.instructionId ?? 0);
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 0),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [defVreg(register, type), immediateOperand(input.value, type)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(input.originStableKey ?? `fixture.movz.${input.value}`),
  });
}

export function aarch64AddForTest(input: { readonly instructionId?: number }) {
  const output = aarch64Gpr64ForTest(2);
  const left = aarch64Gpr64ForTest(0);
  const right = aarch64Gpr64ForTest(1);
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 2),
    opcode: aarch64OpcodeFormId("add-shifted-register"),
    operands: [defVreg(output, type), useVreg(left, type), useVreg(right, type)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin("fixture.add"),
  });
}

export function aarch64RetForTest(input: { readonly instructionId?: number } = {}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 99),
    opcode: aarch64OpcodeFormId("ret"),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin("fixture.ret"),
  });
}

export function aarch64TrapForTest(input: { readonly instructionId?: number } = {}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 98),
    opcode: aarch64OpcodeFormId("trap"),
    operands: [],
    flags: { mayTrap: true, isTerminator: true },
    origin: syntheticAArch64Origin("fixture.trap"),
  });
}

export function aarch64CallForTest(input: {
  readonly instructionId?: number;
  readonly callee?: string;
}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 50),
    opcode: aarch64OpcodeFormId("bl"),
    operands: [
      symbolOperand(aarch64SymbolId(input.callee ?? "helper")),
      implicitDefResource({ kind: "NZCV" }),
      implicitDefResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
      implicitDefResource({ kind: "vectorState" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.call.${input.callee ?? "helper"}`),
  });
}

export function aarch64IndirectCallForTest(input: {
  readonly instructionId?: number;
  readonly targetVreg?: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 51),
    opcode: aarch64OpcodeFormId("blr"),
    operands: [
      useVreg(aarch64Gpr64ForTest(input.targetVreg ?? 0), type),
      implicitDefResource({ kind: "NZCV" }),
      implicitDefResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
      implicitDefResource({ kind: "vectorState" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.indirect-call.${input.instructionId ?? 51}`),
  });
}

export function aarch64LdrUnsignedImmediateForTest(input: {
  readonly instructionId?: number;
  readonly destination?: number;
  readonly base?: number;
  readonly offsetBytes?: bigint;
  readonly originStableKey?: string;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 60),
    opcode: aarch64OpcodeFormId("ldr-unsigned-immediate"),
    operands: [
      defVreg(aarch64Gpr64ForTest(input.destination ?? 0), type),
      aarch64InstructionOperand({
        role: "memoryBase",
        operand: { kind: "vreg", register: aarch64Gpr64ForTest(input.base ?? 1) },
        type,
      }),
      immediateOperand(input.offsetBytes ?? 0n, type),
    ],
    flags: { mayTrap: false, mayLoad: true },
    origin: syntheticAArch64Origin(input.originStableKey ?? "fixture.ldr.unsigned"),
  });
}

export function aarch64Rev16ForTest(input: {
  readonly instructionId?: number;
  readonly destination?: number;
  readonly source?: number;
  readonly originStableKey?: string;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 61),
    opcode: aarch64OpcodeFormId("rev16"),
    operands: [
      defVreg(aarch64Gpr64ForTest(input.destination ?? 2), type),
      useVreg(aarch64Gpr64ForTest(input.source ?? 0), type),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(input.originStableKey ?? "fixture.rev16"),
  });
}

export function aarch64BarrierForTest(input: {
  readonly instructionId?: number;
  readonly opcode: "dmb" | "dsb";
  readonly originStableKey?: string;
}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 62),
    opcode: aarch64OpcodeFormId(input.opcode),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(input.originStableKey ?? `fixture.${input.opcode}`),
  });
}

export function aarch64MachineFunctionForTest(
  input: {
    readonly functionId?: number;
    readonly symbol?: string;
    readonly parameters?: readonly AArch64AbiBinding[];
    readonly returns?: readonly AArch64AbiLocation[];
    readonly instructions?: readonly ReturnType<typeof aarch64MachineInstruction>[];
    readonly terminator?: ReturnType<typeof aarch64MachineInstruction>;
  } = {},
) {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(input.functionId ?? 1),
    symbol: aarch64SymbolId(input.symbol ?? "fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
    parameters: input.parameters ?? [],
    returns: input.returns ?? [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: input.instructions ?? [],
        ...(input.terminator === undefined ? {} : { terminator: input.terminator }),
      }),
    ],
  });
}

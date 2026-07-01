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
import {
  defVreg,
  immediateOperand,
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
}) {
  const register = aarch64Gpr64ForTest(input.instructionId ?? 0);
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId ?? 0),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [defVreg(register, type), immediateOperand(input.value, type)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.movz.${input.value}`),
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

export function aarch64MachineFunctionForTest(
  input: {
    readonly instructions?: readonly ReturnType<typeof aarch64MachineInstruction>[];
    readonly terminator?: ReturnType<typeof aarch64MachineInstruction>;
  } = {},
) {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(1),
    symbol: aarch64SymbolId("fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
    parameters: [],
    returns: [],
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

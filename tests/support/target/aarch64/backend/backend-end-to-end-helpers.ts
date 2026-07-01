import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  symbolOperand,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64CallForTest,
  aarch64Gpr64ForTest,
  aarch64MovzForTest,
  aarch64RetForTest,
} from "../machine-ir/builders";

export function spillPressureFunctionForTest(
  input: { readonly terminator?: ReturnType<typeof aarch64MachineInstruction> } = {},
) {
  const registers = Array.from({ length: 12 }, (_unused, registerIndex) =>
    aarch64Gpr64ForTest(registerIndex),
  );
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(7),
    symbol: aarch64SymbolId("spill.pressure"),
    virtualRegisters: registers,
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          ...Array.from({ length: 8 }, (_unused, instructionIndex) =>
            aarch64MovzForTest({
              instructionId: instructionIndex,
              value: BigInt(instructionIndex + 1),
            }),
          ),
          addForVregs({ instructionId: 8, destination: 8, left: 0, right: 1 }),
          addForVregs({ instructionId: 9, destination: 9, left: 2, right: 3 }),
          addForVregs({ instructionId: 10, destination: 10, left: 4, right: 5 }),
          addForVregs({ instructionId: 11, destination: 11, left: 6, right: 7 }),
        ],
        ...(input.terminator === undefined ? {} : { terminator: input.terminator }),
      }),
    ],
  });
}

export function containsMoveWideImmediate(bytes: readonly number[], value: number): boolean {
  const lowImmediateByte = (value << 5) & 0xff;
  const highImmediateByte = (value >> 3) & 0xff;
  for (let index = 0; index + 3 < bytes.length; index += 1) {
    const firstByte = bytes[index];
    const secondByte = bytes[index + 1];
    const thirdByte = bytes[index + 2];
    const fourthByte = bytes[index + 3];
    if (
      firstByte !== undefined &&
      firstByte >= lowImmediateByte &&
      firstByte <= lowImmediateByte + 31 &&
      secondByte === highImmediateByte &&
      thirdByte === 0x80 &&
      fourthByte === 0xd2
    ) {
      return true;
    }
  }
  return false;
}

export function branchingFunctionForTest() {
  const type = aarch64IntMachineType(64);
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(8),
    symbol: aarch64SymbolId("fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          aarch64MovzForTest({ instructionId: 0, value: 7n }),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(1),
            opcode: aarch64OpcodeFormId("add-immediate"),
            operands: [
              defVreg(aarch64Gpr64ForTest(1), type),
              useVreg(aarch64Gpr64ForTest(0), type),
              immediateOperand(0n, type),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("fixture.add-immediate"),
          }),
        ],
        terminator: aarch64BranchForTest({ instructionId: 2, targetBlock: 1 }),
      }),
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(1),
        frequency: { kind: "warm" },
        instructions: [aarch64MovzForTest({ instructionId: 3, value: 3n })],
        terminator: aarch64RetForTest({ instructionId: 4 }),
      }),
    ],
  });
}

export function secretBranchFunctionForTest() {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(9),
    symbol: aarch64SymbolId("fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0)],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [aarch64MovzForTest({ instructionId: 0, value: 1n })],
        terminator: aarch64CbnzForTest({ instructionId: 1, conditionVreg: 0, targetBlock: 1 }),
      }),
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(1),
        frequency: { kind: "warm" },
        instructions: [],
        terminator: aarch64RetForTest({ instructionId: 2 }),
      }),
    ],
  });
}

export function secretCompareBranchFunctionForTest() {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(11),
    symbol: aarch64SymbolId("fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1)],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [aarch64CmpForTest({ instructionId: 0, left: 0, right: 1 })],
        terminator: aarch64BCondForTest({ instructionId: 1, targetBlock: 1 }),
      }),
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(1),
        frequency: { kind: "warm" },
        instructions: [],
        terminator: aarch64RetForTest({ instructionId: 2 }),
      }),
    ],
  });
}

export function multiReturnFramedFunctionForTest() {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(10),
    symbol: aarch64SymbolId("fixture.function"),
    virtualRegisters: [aarch64Gpr64ForTest(0)],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [aarch64CallForTest({ instructionId: 1, callee: "helper" })],
        terminator: aarch64RetForTest({ instructionId: 2 }),
      }),
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(1),
        frequency: { kind: "warm" },
        instructions: [aarch64MovzForTest({ instructionId: 3, value: 9n })],
        terminator: aarch64RetForTest({ instructionId: 4 }),
      }),
    ],
  });
}

function aarch64BranchForTest(input: {
  readonly instructionId: number;
  readonly targetBlock: number;
}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("b"),
    operands: [branchTarget(aarch64MachineBlockId(input.targetBlock))],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`fixture.branch.${input.instructionId}`),
  });
}

function aarch64CbnzForTest(input: {
  readonly instructionId: number;
  readonly conditionVreg: number;
  readonly targetBlock: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("cbnz"),
    operands: [
      useVreg(aarch64Gpr64ForTest(input.conditionVreg), type),
      branchTarget(aarch64MachineBlockId(input.targetBlock)),
    ],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`fixture.cbnz.${input.instructionId}`),
  });
}

function aarch64CmpForTest(input: {
  readonly instructionId: number;
  readonly left: number;
  readonly right: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("cmp-shifted-register"),
    operands: [
      useVreg(aarch64Gpr64ForTest(input.left), type),
      useVreg(aarch64Gpr64ForTest(input.right), type),
      implicitDefResource({ kind: "NZCV" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.cmp.${input.instructionId}`),
  });
}

function aarch64BCondForTest(input: {
  readonly instructionId: number;
  readonly targetBlock: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("b-cond"),
    operands: [
      implicitUseResource({ kind: "NZCV" }),
      branchTarget(aarch64MachineBlockId(input.targetBlock)),
      immediateOperand(1n, type),
    ],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`fixture.bcond.${input.instructionId}`),
  });
}

export function aarch64CallWithArgumentForTest(input: {
  readonly instructionId: number;
  readonly callee: string;
  readonly argumentVreg: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("bl"),
    operands: [
      symbolOperand(aarch64SymbolId(input.callee)),
      implicitDefResource({ kind: "NZCV" }),
      implicitDefResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
      implicitDefResource({ kind: "vectorState" }),
      useVreg(aarch64Gpr64ForTest(input.argumentVreg), type),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.call.arg.${input.instructionId}`),
  });
}

export function hasByteSequence(bytes: readonly number[], sequence: readonly number[]): boolean {
  for (let offset = 0; offset + sequence.length <= bytes.length; offset += 1) {
    if (sequence.every((byte, index) => bytes[offset + index] === byte)) return true;
  }
  return false;
}

export function retWordOffsets(bytes: readonly number[]): readonly number[] {
  return wordOffsets(bytes, [0xc0, 0x03, 0x5f, 0xd6]);
}

export function movzZeroOffsets(bytes: readonly number[]): readonly number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    if (bytes[offset + 1] === 0x00 && bytes[offset + 2] === 0x80 && bytes[offset + 3] === 0xd2) {
      offsets.push(offset);
    }
  }
  return offsets;
}

export function storeWordOffsets(bytes: readonly number[]): readonly number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    if (bytes[offset + 3] === 0xf9) offsets.push(offset);
  }
  return offsets;
}

export function wordOffsets(
  bytes: readonly number[],
  word: readonly [number, number, number, number],
) {
  const offsets: number[] = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    if (
      bytes[offset] === word[0] &&
      bytes[offset + 1] === word[1] &&
      bytes[offset + 2] === word[2] &&
      bytes[offset + 3] === word[3]
    ) {
      offsets.push(offset);
    }
  }
  return offsets;
}

function addForVregs(input: {
  readonly instructionId: number;
  readonly destination: number;
  readonly left: number;
  readonly right: number;
}) {
  const type = aarch64IntMachineType(64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("add-shifted-register"),
    operands: [
      defVreg(aarch64Gpr64ForTest(input.destination), type),
      useVreg(aarch64Gpr64ForTest(input.left), type),
      useVreg(aarch64Gpr64ForTest(input.right), type),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.spill.add.${input.instructionId}`),
  });
}

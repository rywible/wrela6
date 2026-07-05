import { aarch64FrameObject } from "../../../../src/target/aarch64/machine-ir/frame-object";
import {
  aarch64FrameObjectId,
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import type { AArch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import type { AArch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  defVreg,
  immediateOperand,
  implicitDefResource,
  symbolOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import type { AArch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";

export type BackendStressShape =
  | "call-heavy"
  | "spill-heavy"
  | "wide-constant"
  | "parallel-copy"
  | "large-frame";

export interface GeneratedBackendStressProgram {
  readonly caseKey: string;
  readonly seed: number;
  readonly shape: BackendStressShape;
  readonly machineFunction: AArch64MachineFunction;
  readonly expectedReturnValue: bigint;
}

const shapes: readonly BackendStressShape[] = Object.freeze([
  "call-heavy",
  "spill-heavy",
  "wide-constant",
  "parallel-copy",
  "large-frame",
]);

const i64 = aarch64IntMachineType(64);
const mask64 = (1n << 64n) - 1n;

export function generateBackendStressCorpus(input: {
  readonly seed: number;
  readonly cases: number;
}): readonly GeneratedBackendStressProgram[] {
  return Object.freeze(
    Array.from({ length: input.cases }, (_unused, caseIndex) =>
      generateStressProgram({
        seed: input.seed + caseIndex,
        shape: shapes[caseIndex % shapes.length]!,
      }),
    ),
  );
}

export function generateStressProgram(input: {
  readonly seed: number;
  readonly shape: BackendStressShape;
}): GeneratedBackendStressProgram {
  const random = seededRandom(input.seed);
  const registerCount = registerCountForShape(input.shape);
  const registers = Array.from({ length: registerCount }, (_unused, registerIndex) =>
    gpr64(registerIndex, input.seed),
  );
  const instructions: AArch64MachineInstruction[] = [];
  let instructionId = 0;
  const emit = (instruction: AArch64MachineInstruction) => instructions.push(instruction);
  const constants = Array.from({ length: seedConstantCount(input.shape) }, () => nextU16(random));

  for (const [constantIndex, value] of constants.entries()) {
    emit(movz(instructionId, registers[constantIndex]!, BigInt(value), input.seed));
    instructionId += 1;
  }

  if (input.shape === "wide-constant") {
    const destination = registers[constants.length]!;
    const low = BigInt(nextU16(random));
    const high = BigInt(nextU16(random));
    emit(movz(instructionId, destination, low, input.seed));
    instructionId += 1;
    emit(movk(instructionId, destination, high, 16n, input.seed));
    instructionId += 1;
  }

  const accumulator = registers[registerCount - 1]!;
  emit(movz(instructionId, accumulator, BigInt(nextU16(random)), input.seed));
  let expected = instructionImmediate(instructions[instructions.length - 1]!);
  instructionId += 1;

  const rounds = arithmeticRoundsForShape(input.shape);
  for (let round = 0; round < rounds; round += 1) {
    const sourceIndex = round % constants.length;
    const source = registers[sourceIndex]!;
    emit(add(instructionId, accumulator, accumulator, source, input.seed));
    expected = (expected + BigInt(constants[sourceIndex]!)) & mask64;
    instructionId += 1;
    if (input.shape === "call-heavy" && round % 2 === 1) {
      emit(call(instructionId, `stress.helper.${round}`, input.seed));
      instructionId += 1;
    }
  }

  const frameObjects =
    input.shape === "large-frame"
      ? [
          aarch64FrameObject({
            frameObjectId: aarch64FrameObjectId(0),
            kind: "local",
            size: 5120 + (nextU16(random) % 8) * 16,
            alignment: 16,
          }),
        ]
      : [];

  const machineFunction = aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(input.seed),
    symbol: aarch64SymbolId(`stress.${input.shape}.${input.seed}`),
    virtualRegisters: registers,
    parameters: input.shape === "parallel-copy" ? entryParameters(registers.slice(0, 4)) : [],
    returns: [],
    frameObjects,
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions,
        terminator: ret(instructionId, accumulator, input.seed),
      }),
    ],
  });

  return Object.freeze({
    caseKey: `stress:${input.shape}:${input.seed}`,
    seed: input.seed,
    shape: input.shape,
    machineFunction,
    expectedReturnValue: expected,
  });
}

function registerCountForShape(shape: BackendStressShape): number {
  switch (shape) {
    case "spill-heavy":
      return 22;
    case "parallel-copy":
      return 10;
    case "call-heavy":
      return 12;
    case "large-frame":
      return 8;
    case "wide-constant":
      return 7;
  }
}

function seedConstantCount(shape: BackendStressShape): number {
  return shape === "spill-heavy" ? 18 : shape === "parallel-copy" ? 6 : 5;
}

function arithmeticRoundsForShape(shape: BackendStressShape): number {
  return shape === "spill-heavy" ? 20 : shape === "call-heavy" ? 8 : 6;
}

function gpr64(id: number, seed: number): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: i64,
    origin: { kind: "synthetic", stableKey: `stress.${seed}.v${id}` },
  });
}

function movz(
  instructionId: number,
  destination: AArch64VirtualRegister,
  value: bigint,
  seed: number,
): AArch64MachineInstruction {
  return instruction(instructionId, "movz", seed, [
    defVreg(destination, i64),
    immediateOperand(value, i64),
  ]);
}

function movk(
  instructionId: number,
  destination: AArch64VirtualRegister,
  value: bigint,
  shift: bigint,
  seed: number,
): AArch64MachineInstruction {
  return instruction(instructionId, "movk", seed, [
    {
      ...defVreg(destination, i64),
      role: "tiedDefUse",
      stableKey: `tiedDefUse:${destination.vreg}`,
    },
    immediateOperand(value, i64),
    immediateOperand(shift, i64),
  ]);
}

function add(
  instructionId: number,
  destination: AArch64VirtualRegister,
  left: AArch64VirtualRegister,
  right: AArch64VirtualRegister,
  seed: number,
): AArch64MachineInstruction {
  return instruction(instructionId, "add-shifted-register", seed, [
    defVreg(destination, i64),
    useVreg(left, i64),
    useVreg(right, i64),
  ]);
}

function call(instructionId: number, callee: string, seed: number): AArch64MachineInstruction {
  return instruction(instructionId, "bl", seed, [
    symbolOperand(aarch64SymbolId(callee)),
    implicitDefResource({ kind: "NZCV" }),
    implicitDefResource({ kind: "FPCR" }),
    implicitDefResource({ kind: "FPSR" }),
    implicitDefResource({ kind: "vectorState" }),
  ]);
}

function ret(
  instructionId: number,
  source: AArch64VirtualRegister,
  seed: number,
): AArch64MachineInstruction {
  return instruction(instructionId, "ret", seed, [useVreg(source, i64)]);
}

function instruction(
  instructionId: number,
  opcode: string,
  seed: number,
  operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"],
): AArch64MachineInstruction {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands,
    flags: {
      mayTrap: false,
      isTerminator: opcode === "ret",
    },
    origin: syntheticAArch64Origin(`stress.${seed}.${instructionId}.${opcode}`),
  });
}

function entryParameters(registers: readonly AArch64VirtualRegister[]) {
  return Object.freeze(
    registers.map((register, index) =>
      Object.freeze({
        valueKey: `stress.param.${index}`,
        location: Object.freeze({ kind: "intReg" as const, index }),
      }),
    ),
  );
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function nextU16(random: () => number): number {
  return (random() >>> 8) & 0xffff;
}

function instructionImmediate(instructionValue: AArch64MachineInstruction): bigint {
  const operand = instructionValue.operands.find(
    (candidate) => candidate.operand.kind === "immediate",
  );
  return operand?.operand.kind === "immediate" ? operand.operand.value : 0n;
}

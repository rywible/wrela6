import {
  aarch64MachineBlockId,
  type AArch64MachineBlockId,
  type AArch64VirtualRegisterId,
} from "../machine-ir/ids";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import type { AArch64InstructionOperand } from "../machine-ir/operands";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import {
  advanceAArch64MachineEffectToken,
  initialAArch64MachineEffectState,
  type AArch64MachineEffectState,
} from "./machine-effect-state";
import {
  aarch64MachineMemoryState,
  readLittleEndianInteger,
  writeLittleEndianInteger,
  type AArch64MachineMemoryState,
} from "./machine-memory-state";

export interface AArch64NzcvState {
  readonly negative: boolean;
  readonly zero: boolean;
  readonly carry: boolean;
  readonly overflow: boolean;
}

export interface AArch64InterpreterDiagnostic {
  readonly code: "aarch64.interpreter.unsupported-opcode" | "aarch64.interpreter.step-limit";
  readonly message: string;
  readonly opcode?: string;
}

export type AArch64MachineIrInterpreterResult =
  | AArch64ReturnedResult
  | AArch64TrappedResult
  | AArch64UnsupportedResult;

export interface AArch64ReturnedResult extends AArch64InterpreterSnapshot {
  readonly kind: "returned";
  readonly returnValue?: bigint;
}

export interface AArch64TrappedResult extends AArch64InterpreterSnapshot {
  readonly kind: "trapped";
  readonly trap: { readonly reason: "trap-instruction" | "step-limit" };
}

export interface AArch64UnsupportedResult extends AArch64InterpreterSnapshot {
  readonly kind: "unsupported";
  readonly diagnostic: AArch64InterpreterDiagnostic;
}

interface AArch64InterpreterSnapshot {
  readonly registers: ReadonlyMap<AArch64VirtualRegisterId, bigint>;
  readonly memory: AArch64MachineMemoryState;
  readonly memoryBytes: readonly number[];
  readonly effects: AArch64MachineEffectState;
  readonly nzcv: AArch64NzcvState;
  readonly trace: readonly string[];
}

interface MutableAArch64InterpreterState {
  readonly registers: Map<AArch64VirtualRegisterId, bigint>;
  memory: AArch64MachineMemoryState;
  effects: AArch64MachineEffectState;
  nzcv: AArch64NzcvState;
}

export function runAArch64MachineIrInterpreter(input: {
  readonly function: AArch64MachineFunction;
  readonly inputs: readonly bigint[];
  readonly maxSteps: number;
  readonly memory?: AArch64MachineMemoryState;
}): AArch64MachineIrInterpreterResult {
  const blocks = new Map(input.function.blocks.map((block) => [block.blockId, block]));
  const entry = input.function.blocks.find((block) => block.frequency.kind === "entry");
  if (entry === undefined) {
    return unsupported(snapshot(stateFor(input), []), "entry");
  }

  let state = stateFor(input);
  const inputRegisters = inputRegistersForFunction(input.function);
  input.inputs.forEach((value, index) => {
    const register = inputRegisters[index];
    if (register !== undefined) {
      state.registers.set(register.vreg, maskToWidth(value, inputRegisterWidth(register)));
    }
  });

  let blockId = entry.blockId;
  let instructionIndex = 0;
  const trace: string[] = [];

  for (let step = 0; step < input.maxSteps; step += 1) {
    const block = blocks.get(blockId);
    if (block === undefined) {
      return unsupported(snapshot(state, trace), "b");
    }
    const instruction =
      instructionIndex < block.instructions.length
        ? block.instructions[instructionIndex]
        : block.terminator;
    if (instruction === undefined) {
      return returned(snapshot(state, trace), undefined);
    }
    trace.push(instruction.opcode);

    const result = executeInstruction(state, instruction);
    if (result.kind === "unsupported") {
      return { kind: "unsupported", diagnostic: result.diagnostic, ...snapshot(state, trace) };
    }
    state = result.state;

    if (result.kind === "return") {
      return returned(snapshot(state, trace), result.value);
    }
    if (result.kind === "trap") {
      return { kind: "trapped", trap: { reason: "trap-instruction" }, ...snapshot(state, trace) };
    }
    if (result.kind === "branch") {
      blockId = result.blockId;
      instructionIndex = 0;
    } else {
      instructionIndex += 1;
    }
  }

  return { kind: "trapped", trap: { reason: "step-limit" }, ...snapshot(state, trace) };
}

function stateFor(input: {
  readonly memory?: AArch64MachineMemoryState;
}): MutableAArch64InterpreterState {
  return {
    registers: new Map(),
    memory: input.memory ?? aarch64MachineMemoryState(),
    effects: initialAArch64MachineEffectState(),
    nzcv: Object.freeze({ negative: false, zero: false, carry: false, overflow: false }),
  };
}

function inputRegistersForFunction(
  func: AArch64MachineFunction,
): readonly (AArch64VirtualRegister | undefined)[] {
  if (func.parameters.length === 0) {
    return func.virtualRegisters;
  }
  const registersByValueKey = new Map<string, AArch64VirtualRegister>();
  for (const register of func.virtualRegisters) {
    if (register.origin?.kind === "optIrValue") {
      registersByValueKey.set(`optir.value:${String(register.origin.valueId)}`, register);
    }
  }
  const parameterRegisters = func.parameters.map((parameter) =>
    registersByValueKey.get(parameter.valueKey),
  );
  return parameterRegisters.some((register) => register !== undefined)
    ? parameterRegisters
    : func.virtualRegisters;
}

function inputRegisterWidth(register: AArch64VirtualRegister): number {
  if (register.type.kind === "integer") {
    return register.type.width;
  }
  if (register.type.kind === "vector") {
    return vectorWidthBits(register.type);
  }
  return 64;
}

function executeInstruction(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
):
  | { readonly kind: "continue"; readonly state: MutableAArch64InterpreterState }
  | {
      readonly kind: "branch";
      readonly state: MutableAArch64InterpreterState;
      readonly blockId: AArch64MachineBlockId;
    }
  | {
      readonly kind: "return";
      readonly state: MutableAArch64InterpreterState;
      readonly value?: bigint;
    }
  | { readonly kind: "trap"; readonly state: MutableAArch64InterpreterState }
  | { readonly kind: "unsupported"; readonly diagnostic: AArch64InterpreterDiagnostic } {
  switch (instruction.opcode) {
    case "movz":
      setDef(state, instruction, moveWideImmediate(instruction));
      return { kind: "continue", state };
    case "movn":
      setDef(state, instruction, ~moveWideImmediate(instruction));
      return { kind: "continue", state };
    case "movi":
      setDef(state, instruction, operandValue(state, explicitOperand(instruction, 1)));
      return { kind: "continue", state };
    case "mov-vector":
      setDef(state, instruction, registerValue(state, explicitOperand(instruction, 1)));
      return { kind: "continue", state };
    case "movk": {
      const current = registerValue(state, explicitOperand(instruction, 0));
      const shift = moveWideShift(instruction);
      const mask = 0xffffn << shift;
      setDef(
        state,
        instruction,
        (current & ~mask) | ((unsignedImmediate(instruction, 0) & 0xffffn) << shift),
      );
      return { kind: "continue", state };
    }
    case "add-shifted-register":
    case "add-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) +
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "sub-shifted-register":
    case "sub-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) -
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "and-shifted-register":
    case "and-logical-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) &
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "orr-shifted-register":
    case "orr-logical-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) |
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "eor-shifted-register":
    case "eor-logical-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) ^
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "mul":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) *
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "udiv": {
      const divisor = operandValue(state, explicitOperand(instruction, 2));
      if (divisor === 0n) return { kind: "trap", state };
      setDef(state, instruction, registerValue(state, explicitOperand(instruction, 1)) / divisor);
      return { kind: "continue", state };
    }
    case "sdiv": {
      const divisor = signed64(operandValue(state, explicitOperand(instruction, 2)));
      if (divisor === 0n) return { kind: "trap", state };
      const dividend = signed64(registerValue(state, explicitOperand(instruction, 1)));
      setDef(state, instruction, dividend / divisor);
      return { kind: "continue", state };
    }
    case "lsl":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) <<
          (operandValue(state, explicitOperand(instruction, 2)) & 63n),
      );
      return { kind: "continue", state };
    case "lsl-immediate":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) <<
          (unsignedImmediate(instruction, 2) & 63n),
      );
      return { kind: "continue", state };
    case "lsr":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) >>
          (operandValue(state, explicitOperand(instruction, 2)) & 63n),
      );
      return { kind: "continue", state };
    case "asr": {
      const width = integerWidth(explicitOperand(instruction, 0));
      setDef(
        state,
        instruction,
        signedInteger(registerValue(state, explicitOperand(instruction, 1)), width) >>
          (operandValue(state, explicitOperand(instruction, 2)) & 63n),
      );
      return { kind: "continue", state };
    }
    case "cmp-shifted-register": {
      const left = registerValue(state, explicitOperand(instruction, 0));
      const right = operandValue(state, explicitOperand(instruction, 1));
      state.nzcv = compareNzcv(left, right);
      return { kind: "continue", state };
    }
    case "ccmp": {
      if (conditionHolds(state.nzcv, conditionImmediate(instruction))) {
        const left = registerValue(state, explicitOperand(instruction, 0));
        const right = operandValue(state, explicitOperand(instruction, 1));
        state.nzcv = compareNzcv(left, right);
      } else {
        state.nzcv = nzcvFromImmediate(unsignedImmediate(instruction, 2));
      }
      return { kind: "continue", state };
    }
    case "csel":
      setDef(
        state,
        instruction,
        conditionHolds(state.nzcv, conditionImmediate(instruction))
          ? registerValue(state, explicitOperand(instruction, 1))
          : registerValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "cset":
      setDef(
        state,
        instruction,
        conditionHolds(state.nzcv, conditionImmediate(instruction)) ? 1n : 0n,
      );
      return { kind: "continue", state };
    case "ldr-unsigned-immediate":
    case "ldr-register-offset": {
      const address = memoryAddress(state, instruction);
      setDef(
        state,
        instruction,
        readLittleEndianInteger(state.memory, address, accessByteWidth(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "ldar": {
      const address = memoryAddress(state, instruction);
      setDef(
        state,
        instruction,
        readLittleEndianInteger(state.memory, address, accessByteWidth(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "ldp-signed-offset": {
      const address = memoryAddress(state, instruction);
      setDefAt(state, instruction, 0, readLittleEndianInteger(state.memory, address, 8));
      setDefAt(state, instruction, 1, readLittleEndianInteger(state.memory, address + 8n, 8));
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "str-unsigned-immediate": {
      const address = memoryAddress(state, instruction);
      state.memory = writeLittleEndianInteger(
        state.memory,
        address,
        accessByteWidth(instruction, 0),
        registerValue(state, explicitOperand(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "stlr": {
      const address = memoryAddress(state, instruction);
      state.memory = writeLittleEndianInteger(
        state.memory,
        address,
        accessByteWidth(instruction, 0),
        registerValue(state, explicitOperand(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "stp-signed-offset": {
      const address = memoryAddress(state, instruction);
      state.memory = writeLittleEndianInteger(
        state.memory,
        address,
        8,
        registerValue(state, explicitOperand(instruction, 0)),
      );
      state.memory = writeLittleEndianInteger(
        state.memory,
        address + 8n,
        8,
        registerValue(state, explicitOperand(instruction, 1)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "ldadd":
    case "ldadda":
    case "ldaddl":
    case "ldaddal": {
      const address = memoryAddress(state, instruction);
      const original = readLittleEndianInteger(state.memory, address, 8);
      setDefAt(state, instruction, 1, original);
      state.memory = writeLittleEndianInteger(
        state.memory,
        address,
        8,
        original + registerValue(state, explicitOperand(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    }
    case "rev":
      setDef(
        state,
        instruction,
        byteReverse(registerValue(state, explicitOperand(instruction, 1)), 8),
      );
      return { kind: "continue", state };
    case "rev16":
      setDef(
        state,
        instruction,
        byteReverse(registerValue(state, explicitOperand(instruction, 1)), 2),
      );
      return { kind: "continue", state };
    case "rev32":
      setDef(
        state,
        instruction,
        byteReverse(registerValue(state, explicitOperand(instruction, 1)), 4),
      );
      return { kind: "continue", state };
    case "vector-rev":
      setDef(
        state,
        instruction,
        byteReverse(registerValue(state, explicitOperand(instruction, 1)), 16),
      );
      return { kind: "continue", state };
    case "adrp":
      setDef(state, instruction, 0n);
      return { kind: "continue", state };
    case "add-pageoff":
      setDef(
        state,
        instruction,
        registerValue(state, explicitOperand(instruction, 1)) +
          operandValue(state, explicitOperand(instruction, 2)),
      );
      return { kind: "continue", state };
    case "dmb":
    case "dsb":
    case "prfm":
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    case "ld1":
      setDef(
        state,
        instruction,
        readLittleEndianInteger(
          state.memory,
          memoryAddress(state, instruction),
          accessByteWidth(instruction, 0),
        ),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    case "st1":
      state.memory = writeLittleEndianInteger(
        state.memory,
        memoryAddress(state, instruction),
        accessByteWidth(instruction, 0),
        registerValue(state, explicitOperand(instruction, 0)),
      );
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    case "tbl":
    case "tbx":
    case "cmeq":
    case "crc32":
    case "pmull":
    case "aes-sha-round":
    case "dotprod":
    case "sqrdmulh":
    case "sqadd-saturating":
    case "sqrdmlah":
    case "fmadd":
    case "fmla":
    case "fcvt-fp16":
      return unsupportedOpcode(instruction.opcode);
    case "bsl":
      setDef(
        state,
        instruction,
        (registerValue(state, explicitOperand(instruction, 1)) &
          operandValue(state, explicitOperand(instruction, 2))) |
          (~registerValue(state, explicitOperand(instruction, 1)) &
            operandValue(state, explicitOperand(instruction, 3))),
      );
      return { kind: "continue", state };
    case "b":
      return { kind: "branch", state, blockId: branchBlock(instruction) };
    case "b-cond":
      return conditionHolds(state.nzcv, conditionImmediate(instruction))
        ? { kind: "branch", state, blockId: branchBlock(instruction) }
        : { kind: "continue", state };
    case "cbz":
      return registerValue(state, explicitOperand(instruction, 0)) === 0n
        ? { kind: "branch", state, blockId: branchBlock(instruction) }
        : { kind: "continue", state };
    case "cbnz":
      return registerValue(state, explicitOperand(instruction, 0)) !== 0n
        ? { kind: "branch", state, blockId: branchBlock(instruction) }
        : { kind: "continue", state };
    case "tbz": {
      const value = registerValue(state, explicitOperand(instruction, 0));
      const bit = operandValue(state, explicitOperand(instruction, 1));
      return ((value >> bit) & 1n) === 0n
        ? { kind: "branch", state, blockId: branchBlock(instruction) }
        : { kind: "continue", state };
    }
    case "bl":
    case "blr":
      state.effects = advanceAArch64MachineEffectToken(state.effects);
      return { kind: "continue", state };
    case "br":
      return { kind: "branch", state, blockId: indirectBranchBlock(state, instruction) };
    case "ret":
      return { kind: "return", state, value: returnValue(state, instruction) };
    case "trap":
      return { kind: "trap", state };
    default:
      return unsupportedOpcode(instruction.opcode);
  }
}

function unsupportedOpcode(opcode: string): {
  readonly kind: "unsupported";
  readonly diagnostic: AArch64InterpreterDiagnostic;
} {
  return {
    kind: "unsupported",
    diagnostic: {
      code: "aarch64.interpreter.unsupported-opcode",
      message: `Unsupported AArch64 interpreter opcode: ${opcode}.`,
      opcode,
    },
  };
}

function setDef(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
  value: bigint,
): void {
  setDefAt(state, instruction, 0, value);
}

function setDefAt(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
  index: number,
  value: bigint,
): void {
  const destination = explicitOperand(instruction, index);
  if (destination.operand.kind !== "vreg") {
    throw new TypeError("destination operand must be a virtual register.");
  }
  state.registers.set(
    destination.operand.register.vreg,
    maskToWidth(value, integerWidth(destination)),
  );
}

function registerValue(
  state: MutableAArch64InterpreterState,
  operand: AArch64InstructionOperand,
): bigint {
  if (operand.operand.kind !== "vreg") {
    throw new TypeError("operand must be a virtual register.");
  }
  return state.registers.get(operand.operand.register.vreg) ?? 0n;
}

function operandValue(
  state: MutableAArch64InterpreterState,
  operand: AArch64InstructionOperand,
): bigint {
  if (operand.operand.kind === "immediate") {
    return operand.operand.value;
  }
  return registerValue(state, operand);
}

function accessByteWidth(instruction: AArch64MachineInstruction, explicitIndex: number): number {
  const type = explicitOperand(instruction, explicitIndex).type;
  switch (type.kind) {
    case "integer":
    case "float":
      return Math.max(1, Math.ceil(type.width / 8));
    case "pointer":
      return 8;
    case "vector":
      return Math.max(1, Math.ceil(vectorWidthBits(type) / 8));
    case "token":
    case "resourceToken":
      return 0;
  }
}

function vectorWidthBits(
  type: Extract<AArch64InstructionOperand["type"], { readonly kind: "vector" }>,
): number {
  const lane = type.laneType;
  const laneWidth =
    lane.kind === "integer" || lane.kind === "float"
      ? lane.width
      : lane.kind === "pointer"
        ? 64
        : 0;
  return laneWidth * type.laneCount;
}

function explicitOperand(
  instruction: AArch64MachineInstruction,
  index: number,
): AArch64InstructionOperand {
  const operand = instruction.operands.filter(
    (entry) => entry.role !== "implicitDef" && entry.role !== "implicitUse",
  )[index];
  if (operand === undefined) {
    throw new RangeError(`missing explicit operand ${index} for ${instruction.opcode}.`);
  }
  return operand;
}

function unsignedImmediate(
  instruction: AArch64MachineInstruction,
  fallbackExplicitIndex: number,
): bigint {
  const immediate = instruction.operands.find(
    (operand, index) => operand.operand.kind === "immediate" && index >= fallbackExplicitIndex,
  );
  if (immediate?.operand.kind !== "immediate") {
    throw new RangeError(`missing immediate for ${instruction.opcode}.`);
  }
  return immediate.operand.value;
}

function moveWideImmediate(instruction: AArch64MachineInstruction): bigint {
  return (unsignedImmediate(instruction, 0) & 0xffffn) << moveWideShift(instruction);
}

function moveWideShift(instruction: AArch64MachineInstruction): bigint {
  const immediates = instruction.operands.filter((operand) => operand.operand.kind === "immediate");
  const shiftOperand = immediates[1];
  if (shiftOperand?.operand.kind !== "immediate") return 0n;
  return shiftOperand.operand.value;
}

function conditionImmediate(instruction: AArch64MachineInstruction): bigint {
  const immediate = instruction.operands
    .filter((operand) => operand.operand.kind === "immediate")
    .at(-1);
  if (immediate?.operand.kind !== "immediate") {
    throw new RangeError(`missing condition immediate for ${instruction.opcode}.`);
  }
  return immediate.operand.value;
}

function nzcvFromImmediate(value: bigint): AArch64NzcvState {
  return Object.freeze({
    negative: (value & 0b1000n) !== 0n,
    zero: (value & 0b0100n) !== 0n,
    carry: (value & 0b0010n) !== 0n,
    overflow: (value & 0b0001n) !== 0n,
  });
}

function memoryAddress(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
): bigint {
  const base = instruction.operands.find((operand) => operand.role === "memoryBase");
  if (base === undefined) {
    throw new RangeError(`missing memory base for ${instruction.opcode}.`);
  }
  const offset = instruction.operands.find((operand) => operand.operand.kind === "immediate");
  const index = instruction.operands.find((operand) => operand.role === "memoryIndex");
  return (
    registerValue(state, base) +
    (offset?.operand.kind === "immediate" ? offset.operand.value : 0n) +
    (index === undefined ? 0n : registerValue(state, index))
  );
}

function branchBlock(instruction: AArch64MachineInstruction): AArch64MachineBlockId {
  const target = instruction.operands.find((operand) => operand.role === "branchTarget");
  if (target?.operand.kind !== "block") {
    throw new RangeError(`missing branch target for ${instruction.opcode}.`);
  }
  return target.operand.block;
}

function indirectBranchBlock(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
): AArch64MachineBlockId {
  const target = registerValue(state, explicitOperand(instruction, 0));
  return aarch64MachineBlockId(Number(target));
}

function returnValue(
  state: MutableAArch64InterpreterState,
  instruction: AArch64MachineInstruction,
): bigint | undefined {
  const operand = instruction.operands.find((entry) => entry.operand.kind === "vreg");
  return operand === undefined ? undefined : registerValue(state, operand);
}

function compareNzcv(left: bigint, right: bigint): AArch64NzcvState {
  const result = maskToWidth(left - right, 64);
  return Object.freeze({
    negative: (result & (1n << 63n)) !== 0n,
    zero: result === 0n,
    carry: left >= right,
    overflow: signedOverflowSub(left, right, result),
  });
}

function conditionHolds(nzcv: AArch64NzcvState, condition: bigint): boolean {
  switch (condition) {
    case 0n:
      return nzcv.zero;
    case 1n:
      return !nzcv.zero;
    case 2n:
      return nzcv.carry;
    case 3n:
      return !nzcv.carry;
    case 4n:
      return nzcv.carry && !nzcv.zero;
    case 5n:
      return nzcv.negative !== nzcv.overflow;
    case 6n:
      return nzcv.zero || nzcv.negative !== nzcv.overflow;
    case 7n:
      return !nzcv.zero && nzcv.negative === nzcv.overflow;
    case 8n:
      return !nzcv.carry || nzcv.zero;
    default:
      return false;
  }
}

function signedOverflowSub(left: bigint, right: bigint, result: bigint): boolean {
  const sign = 1n << 63n;
  return ((left ^ right) & (left ^ result) & sign) !== 0n;
}

function signed64(value: bigint): bigint {
  return signedInteger(value, 64);
}

function signedInteger(value: bigint, width: number): bigint {
  const masked = maskToWidth(value, width);
  const sign = 1n << BigInt(width - 1);
  const range = 1n << BigInt(width);
  return masked >= sign ? masked - range : masked;
}

function integerWidth(operand: AArch64InstructionOperand): number {
  if (operand.type.kind === "integer") {
    return operand.type.width;
  }
  if (operand.type.kind === "float") {
    return operand.type.width;
  }
  if (operand.type.kind === "vector") {
    return vectorWidthBits(operand.type);
  }
  return 64;
}

function maskToWidth(value: bigint, width: number): bigint {
  return value & ((1n << BigInt(width)) - 1n);
}

function byteReverse(value: bigint, widthBytes: number): bigint {
  let result = 0n;
  for (let index = 0; index < widthBytes; index += 1) {
    result = (result << 8n) | ((value >> BigInt(index * 8)) & 0xffn);
  }
  return result;
}

function snapshot(
  state: MutableAArch64InterpreterState,
  trace: readonly string[],
): AArch64InterpreterSnapshot {
  const memory = aarch64MachineMemoryState(state.memory.bytes);
  return {
    registers: new Map(state.registers),
    memory,
    memoryBytes: memory.bytes,
    effects: state.effects,
    nzcv: state.nzcv,
    trace: Object.freeze([...trace]),
  };
}

function returned(
  snapshotRecord: AArch64InterpreterSnapshot,
  value: bigint | undefined,
): AArch64ReturnedResult {
  return {
    kind: "returned",
    ...(value === undefined ? {} : { returnValue: value }),
    ...snapshotRecord,
  };
}

function unsupported(
  snapshotRecord: AArch64InterpreterSnapshot,
  opcode: string,
): AArch64UnsupportedResult {
  return {
    kind: "unsupported",
    diagnostic: {
      code: "aarch64.interpreter.unsupported-opcode",
      message: `Unsupported AArch64 interpreter opcode: ${opcode}.`,
      opcode,
    },
    ...snapshotRecord,
  };
}

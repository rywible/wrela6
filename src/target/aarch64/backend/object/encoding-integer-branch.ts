import {
  encodingError,
  encodingOk,
  registerNumber,
  writeU32Le,
  type AArch64EncodeInput,
  type AArch64InstructionFamilyEncoder,
} from "./encoding-core";

export const aarch64IntegerBranchEncoderFamilies = Object.freeze([
  {
    family: "integer-branch",
    opcodes: Object.freeze([
      "movz",
      "movk",
      "movn",
      "add-immediate",
      "sub-immediate",
      "add-shifted-register",
      "sub-shifted-register",
      "and-shifted-register",
      "and-logical-immediate",
      "orr-shifted-register",
      "orr-logical-immediate",
      "eor-shifted-register",
      "eor-logical-immediate",
      "mul",
      "udiv",
      "sdiv",
      "lsl",
      "lsr",
      "cmp-shifted-register",
      "cset",
      "csel",
      "ccmp",
      "b-cond",
      "cbz",
      "cbnz",
      "tbz",
      "tbnz",
      "b",
      "bl",
      "br",
      "blr",
      "ret",
      "trap",
      "dmb",
      "dsb",
    ]),
    encode: encodeIntegerBranchInstruction,
  },
] satisfies readonly AArch64InstructionFamilyEncoder[]);

function encodeIntegerBranchInstruction(input: AArch64EncodeInput) {
  if (MOVE_WIDE_BASES.has(input.instruction.opcode)) return encodeMoveWide(input);
  if (input.instruction.opcode === "add-immediate" || input.instruction.opcode === "sub-immediate")
    return encodeAddSubImmediate(input);
  if (LOGICAL_IMMEDIATE_BASES.has(input.instruction.opcode))
    return encodeLogicalImmediate(input, LOGICAL_IMMEDIATE_BASES.get(input.instruction.opcode)!);
  if (REGISTER_THREE_OPERAND_BASES.has(input.instruction.opcode))
    return encodeThreeRegisterInstruction(
      input,
      REGISTER_THREE_OPERAND_BASES.get(input.instruction.opcode)!,
    );
  if (input.instruction.opcode === "cmp-shifted-register")
    return encodeCompareShiftedRegister(input);
  if (input.instruction.opcode === "cset") return encodeCset(input);
  if (input.instruction.opcode === "csel") return encodeCsel(input);
  if (input.instruction.opcode === "ccmp") return encodeCcmp(input);
  if (input.instruction.opcode === "b-cond") return encodeConditionalBranch(input);
  if (input.instruction.opcode === "cbz" || input.instruction.opcode === "cbnz")
    return encodeCompareAndBranch(input);
  if (input.instruction.opcode === "tbz" || input.instruction.opcode === "tbnz")
    return encodeTestAndBranch(input);
  if (input.instruction.opcode === "b" || input.instruction.opcode === "bl")
    return encodeBranch26(input);
  if (input.instruction.opcode === "br" || input.instruction.opcode === "blr")
    return encodeBranchRegister(input);
  if (input.instruction.opcode === "ret") return encodingOk({ bytes: writeU32Le(0xd65f03c0) });
  if (input.instruction.opcode === "trap") return encodingOk({ bytes: writeU32Le(0xd4200000) });
  if (input.instruction.opcode === "dmb") return encodingOk({ bytes: writeU32Le(0xd5033bbf) });
  if (input.instruction.opcode === "dsb") return encodingOk({ bytes: writeU32Le(0xd5033b9f) });
  return encodingError(`encoding:unsupported-opcode:${input.instruction.opcode}`);
}

const MOVE_WIDE_BASES = new Map<string, number>([
  ["movz", 0xd2800000],
  ["movk", 0xf2800000],
  ["movn", 0x92800000],
]);

const REGISTER_THREE_OPERAND_BASES = new Map<string, number>([
  ["add-shifted-register", 0x8b000000],
  ["sub-shifted-register", 0xcb000000],
  ["and-shifted-register", 0x8a000000],
  ["orr-shifted-register", 0xaa000000],
  ["eor-shifted-register", 0xca000000],
  ["mul", 0x9b007c00],
  ["udiv", 0x9ac00800],
  ["sdiv", 0x9ac00c00],
  ["lsl", 0x9ac02000],
  ["lsr", 0x9ac02400],
]);

const LOGICAL_SHIFTED_REGISTER_OPCODES = new Set([
  "and-shifted-register",
  "orr-shifted-register",
  "eor-shifted-register",
]);

const LOGICAL_IMMEDIATE_BASES = new Map<string, number>([
  ["and-logical-immediate", 0x92000000],
  ["orr-logical-immediate", 0xb2000000],
  ["eor-logical-immediate", 0xd2000000],
]);

function encodeMoveWide(input: AArch64EncodeInput) {
  const [destination, immediate, shift] = input.instruction.operands;
  if (destination?.kind !== "register" || immediate?.kind !== "immediate") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  if (immediate.value < 0n || immediate.value > 0xffffn) {
    return encodingError(
      `encoding:immediate-out-of-range:${input.instruction.opcode}:${immediate.value.toString()}`,
    );
  }
  const shiftValue = shift?.kind === "immediate" ? shift.value : 0n;
  if (shiftValue < 0n || shiftValue > 48n || shiftValue % 16n !== 0n) {
    return encodingError(
      `encoding:move-wide-shift-invalid:${input.instruction.opcode}:${shiftValue.toString()}`,
    );
  }
  const destinationNumber = registerNumber(input, destination.register);
  if (destinationNumber < 0 || destinationNumber > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${destination.register}`,
    );
  }
  const word =
    MOVE_WIDE_BASES.get(input.instruction.opcode)! |
    (Number(shiftValue / 16n) << 21) |
    (Number(immediate.value) << 5) |
    destinationNumber;
  return encodingOk({ bytes: writeU32Le(word) });
}

function encodeAddSubImmediate(input: AArch64EncodeInput) {
  const [destination, source, immediate] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    source?.kind !== "register" ||
    immediate?.kind !== "immediate"
  ) {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  if (immediate.value < 0n || immediate.value > 0xfffn) {
    return encodingError(
      `encoding:immediate-out-of-range:${input.instruction.opcode}:${immediate.value.toString()}`,
    );
  }
  const destinationNumber = registerNumber(input, destination.register);
  const sourceNumber = registerNumber(input, source.register);
  if (
    destinationNumber < 0 ||
    destinationNumber > 31 ||
    sourceNumber < 0 ||
    sourceNumber > 31 ||
    isZeroRegisterAlias(input, destination.register) ||
    isZeroRegisterAlias(input, source.register)
  ) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${destination.register}:${source.register}`,
    );
  }
  const baseWord = input.instruction.opcode === "sub-immediate" ? 0xd1000000 : 0x91000000;
  return encodingOk({
    bytes: writeU32Le(
      baseWord | (Number(immediate.value) << 10) | (sourceNumber << 5) | destinationNumber,
    ),
  });
}

function isZeroRegisterAlias(input: AArch64EncodeInput, register: string): boolean {
  const aliasSet = input.registerModel.aliasSetOf(register);
  return aliasSet === "xzr" || aliasSet === "zr" || register === "xzr" || register === "wzr";
}

function encodeLogicalImmediate(input: AArch64EncodeInput, baseWord: number) {
  const [destination, source, immediate] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    source?.kind !== "register" ||
    immediate?.kind !== "immediate"
  ) {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const lowMaskWidth = lowContiguousMaskWidth(immediate.value);
  if (lowMaskWidth === undefined) {
    return encodingError(
      `encoding:logical-immediate-unsupported:${input.instruction.opcode}:${immediate.value.toString()}`,
    );
  }
  const destinationNumber = registerNumber(input, destination.register);
  const sourceNumber = registerNumber(input, source.register);
  if (destinationNumber < 0 || destinationNumber > 30 || sourceNumber < 0 || sourceNumber > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${destination.register}:${source.register}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(
      baseWord | (1 << 22) | ((lowMaskWidth - 1) << 10) | (sourceNumber << 5) | destinationNumber,
    ),
  });
}

function lowContiguousMaskWidth(value: bigint): number | undefined {
  if (value <= 0n) return undefined;
  for (let width = 1; width < 64; width += 1) {
    if ((1n << BigInt(width)) - 1n === value) return width;
  }
  return undefined;
}

function encodeThreeRegisterInstruction(input: AArch64EncodeInput, baseWord: number) {
  const [destination, left, right] = input.instruction.operands;
  if (destination?.kind !== "register" || left?.kind !== "register" || right?.kind !== "register") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const leftNumber = registerNumber(input, left.register);
  const rightNumber = registerNumber(input, right.register);
  const allowZeroSources = LOGICAL_SHIFTED_REGISTER_OPCODES.has(input.instruction.opcode);
  if (
    !isPlainGeneralRegisterNumber(destinationNumber) ||
    !isThreeRegisterSource(input, left.register, leftNumber, allowZeroSources) ||
    !isThreeRegisterSource(input, right.register, rightNumber, allowZeroSources)
  ) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${destination.register}:${left.register}:${right.register}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(baseWord | (rightNumber << 16) | (leftNumber << 5) | destinationNumber),
  });
}

function isPlainGeneralRegisterNumber(registerNumberToCheck: number): boolean {
  return registerNumberToCheck >= 0 && registerNumberToCheck <= 30;
}

function isThreeRegisterSource(
  input: AArch64EncodeInput,
  register: string,
  registerNumberToCheck: number,
  allowZeroRegister: boolean,
): boolean {
  if (isPlainGeneralRegisterNumber(registerNumberToCheck)) return true;
  return allowZeroRegister && registerNumberToCheck === 31 && isZeroRegisterAlias(input, register);
}

function encodeCompareShiftedRegister(input: AArch64EncodeInput) {
  const [left, right] = input.instruction.operands;
  if (left?.kind !== "register" || right?.kind !== "register") {
    return encodingError("encoding:unresolved-operands:cmp-shifted-register");
  }
  const leftNumber = registerNumber(input, left.register);
  const rightNumber = registerNumber(input, right.register);
  if (leftNumber < 0 || leftNumber > 30 || rightNumber < 0 || rightNumber > 30) {
    return encodingError(
      `encoding:illegal-register:cmp-shifted-register:${left.register}:${right.register}`,
    );
  }
  return encodingOk({ bytes: writeU32Le(0xeb00001f | (rightNumber << 16) | (leftNumber << 5)) });
}

function encodeCset(input: AArch64EncodeInput) {
  const [destination, condition] = input.instruction.operands;
  if (destination?.kind !== "register" || condition?.kind !== "condition") {
    return encodingError("encoding:unresolved-operands:cset");
  }
  const destinationNumber = registerNumber(input, destination.register);
  const conditionCode = branchConditionCode(condition.condition);
  if (destinationNumber < 0 || destinationNumber > 30) {
    return encodingError(`encoding:illegal-register:cset:${destination.register}`);
  }
  if (conditionCode === undefined)
    return encodingError(`encoding:invalid-condition:cset:${condition.condition}`);
  return encodingOk({
    bytes: writeU32Le(
      0x9a800400 |
        (31 << 16) |
        (invertConditionCode(conditionCode) << 12) |
        (31 << 5) |
        destinationNumber,
    ),
  });
}

function encodeCsel(input: AArch64EncodeInput) {
  const [destination, left, right, condition] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    left?.kind !== "register" ||
    right?.kind !== "register" ||
    condition?.kind !== "condition"
  ) {
    return encodingError("encoding:unresolved-operands:csel");
  }
  const destinationNumber = registerNumber(input, destination.register);
  const leftNumber = registerNumber(input, left.register);
  const rightNumber = registerNumber(input, right.register);
  const conditionCode = branchConditionCode(condition.condition);
  if (
    destinationNumber < 0 ||
    destinationNumber > 30 ||
    leftNumber < 0 ||
    leftNumber > 30 ||
    rightNumber < 0 ||
    rightNumber > 30
  ) {
    return encodingError(
      `encoding:illegal-register:csel:${destination.register}:${left.register}:${right.register}`,
    );
  }
  if (conditionCode === undefined)
    return encodingError(`encoding:invalid-condition:csel:${condition.condition}`);
  return encodingOk({
    bytes: writeU32Le(
      0x9a800000 |
        (rightNumber << 16) |
        (conditionCode << 12) |
        (leftNumber << 5) |
        destinationNumber,
    ),
  });
}

function encodeCcmp(input: AArch64EncodeInput) {
  const [left, right, nzcv, condition] = input.instruction.operands;
  if (
    left?.kind !== "register" ||
    right?.kind !== "register" ||
    nzcv?.kind !== "immediate" ||
    condition?.kind !== "condition"
  ) {
    return encodingError("encoding:unresolved-operands:ccmp");
  }
  const leftNumber = registerNumber(input, left.register);
  const rightNumber = registerNumber(input, right.register);
  const conditionCode = branchConditionCode(condition.condition);
  if (leftNumber < 0 || leftNumber > 30 || rightNumber < 0 || rightNumber > 30) {
    return encodingError(`encoding:illegal-register:ccmp:${left.register}:${right.register}`);
  }
  if (nzcv.value < 0n || nzcv.value > 15n) {
    return encodingError(`encoding:immediate-out-of-range:ccmp:${nzcv.value.toString()}`);
  }
  if (conditionCode === undefined)
    return encodingError(`encoding:invalid-condition:ccmp:${condition.condition}`);
  return encodingOk({
    bytes: writeU32Le(
      0xfa400000 |
        (rightNumber << 16) |
        (conditionCode << 12) |
        (leftNumber << 5) |
        Number(nzcv.value),
    ),
  });
}

function encodeConditionalBranch(input: AArch64EncodeInput) {
  const [condition, target] = input.instruction.operands;
  if (
    condition?.kind !== "condition" ||
    target?.kind !== "relocation-target" ||
    input.instruction.relocation === undefined
  ) {
    return encodingError("encoding:missing-relocation-record:b-cond");
  }
  const conditionCode = branchConditionCode(condition.condition);
  if (conditionCode === undefined) {
    return encodingError(`encoding:invalid-condition:b-cond:${condition.condition}`);
  }
  if (input.instruction.relocation.family !== "branch19") {
    return encodingError(
      `encoding:relocation-family-mismatch:b-cond:${input.instruction.relocation.family}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(0x54000000 | conditionCode),
    relocationHole: {
      family: "branch19",
      patchOffsetBytes: 0,
      bitRange: [5, 23],
      target: target.target,
    },
  });
}

function encodeCompareAndBranch(input: AArch64EncodeInput) {
  const [register, target] = input.instruction.operands;
  if (
    register?.kind !== "register" ||
    target?.kind !== "relocation-target" ||
    input.instruction.relocation === undefined
  ) {
    return encodingError(`encoding:missing-relocation-record:${input.instruction.opcode}`);
  }
  if (input.instruction.relocation.family !== "branch19") {
    return encodingError(
      `encoding:relocation-family-mismatch:${input.instruction.opcode}:${input.instruction.relocation.family}`,
    );
  }
  const registerNumberValue = registerNumber(input, register.register);
  if (registerNumberValue < 0 || registerNumberValue > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${register.register}`,
    );
  }
  const registerWidth = compareBranchRegisterWidth(register.register);
  if (registerWidth === undefined) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${register.register}`,
    );
  }
  const baseWord =
    (input.instruction.opcode === "cbnz" ? 0x35000000 : 0x34000000) |
    (registerWidth === 64 ? 0x80000000 : 0);
  return encodingOk({
    bytes: writeU32Le(baseWord | registerNumberValue),
    relocationHole: {
      family: "branch19",
      patchOffsetBytes: 0,
      bitRange: [5, 23],
      target: target.target,
    },
  });
}

function encodeTestAndBranch(input: AArch64EncodeInput) {
  const [register, bitIndex, target] = input.instruction.operands;
  if (
    register?.kind !== "register" ||
    bitIndex?.kind !== "immediate" ||
    target?.kind !== "relocation-target" ||
    input.instruction.relocation === undefined
  ) {
    return encodingError(`encoding:missing-relocation-record:${input.instruction.opcode}`);
  }
  if (input.instruction.relocation.family !== "branch14") {
    return encodingError(
      `encoding:relocation-family-mismatch:${input.instruction.opcode}:${input.instruction.relocation.family}`,
    );
  }
  if (bitIndex.value < 0n || bitIndex.value > 63n) {
    return encodingError(
      `encoding:immediate-out-of-range:${input.instruction.opcode}:${bitIndex.value.toString()}`,
    );
  }
  const registerNumberValue = registerNumber(input, register.register);
  if (registerNumberValue < 0 || registerNumberValue > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${register.register}`,
    );
  }
  const registerWidth = compareBranchRegisterWidth(register.register);
  if (registerWidth === undefined) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${register.register}`,
    );
  }
  if (registerWidth === 32 && bitIndex.value > 31n) {
    return encodingError(
      `encoding:test-branch-bit-width-mismatch:${input.instruction.opcode}:${register.register}:${bitIndex.value.toString()}`,
    );
  }
  const bit = Number(bitIndex.value);
  const baseWord = input.instruction.opcode === "tbnz" ? 0x37000000 : 0x36000000;
  return encodingOk({
    bytes: writeU32Le(baseWord | ((bit >> 5) << 31) | ((bit & 31) << 19) | registerNumberValue),
    relocationHole: {
      family: "branch14",
      patchOffsetBytes: 0,
      bitRange: [5, 18],
      target: target.target,
    },
  });
}

function compareBranchRegisterWidth(register: string): 32 | 64 | undefined {
  if (/^w(?:[0-9]|[12][0-9]|30|zr)$/.test(register)) return 32;
  if (/^x(?:[0-9]|[12][0-9]|30|zr)$/.test(register)) return 64;
  return undefined;
}

function branchConditionCode(condition: string): number | undefined {
  const codes = new Map<string, number>([
    ["eq", 0],
    ["ne", 1],
    ["cs", 2],
    ["hs", 2],
    ["cc", 3],
    ["lo", 3],
    ["mi", 4],
    ["pl", 5],
    ["vs", 6],
    ["vc", 7],
    ["hi", 8],
    ["ls", 9],
    ["ge", 10],
    ["lt", 11],
    ["gt", 12],
    ["le", 13],
    ["al", 14],
    ["nv", 15],
  ]);
  return codes.get(condition);
}

function invertConditionCode(conditionCode: number): number {
  return conditionCode ^ 1;
}

function encodeBranch26(input: AArch64EncodeInput) {
  const [target] = input.instruction.operands;
  if (target?.kind !== "relocation-target" || input.instruction.relocation === undefined) {
    return encodingError(`encoding:missing-relocation-record:${input.instruction.opcode}`);
  }
  if (input.instruction.relocation.family !== "branch26") {
    return encodingError(
      `encoding:relocation-family-mismatch:${input.instruction.opcode}:${input.instruction.relocation.family}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(input.instruction.opcode === "bl" ? 0x94000000 : 0x14000000),
    relocationHole: {
      family: "branch26",
      patchOffsetBytes: 0,
      bitRange: [0, 25],
      target: target.target,
    },
  });
}

function encodeBranchRegister(input: AArch64EncodeInput) {
  const [target] = input.instruction.operands;
  if (target?.kind !== "register") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const targetNumber = registerNumber(input, target.register);
  if (targetNumber < 0 || targetNumber > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${target.register}`,
    );
  }
  const baseWord = input.instruction.opcode === "blr" ? 0xd63f0000 : 0xd61f0000;
  return encodingOk({ bytes: writeU32Le(baseWord | (targetNumber << 5)) });
}

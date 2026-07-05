import {
  encodingError,
  encodingOk,
  registerNumber,
  writeU32Le,
  type AArch64EncodeInput,
  type AArch64InstructionFamilyEncoder,
} from "./encoding-core";

export const aarch64MemorySimdFpEncoderFamilies = Object.freeze([
  {
    family: "memory-simd-fp",
    opcodes: Object.freeze([
      "ldr-unsigned-immediate",
      "ldr-register-offset",
      "str-unsigned-immediate",
      "ldp-signed-offset",
      "stp-signed-offset",
      "adrp",
      "add-pageoff",
      "movi",
      "mov-vector",
      "rev",
      "rev16",
      "rev32",
      "ldar",
      "stlr",
      "ldadd",
      "ldadda",
      "ldaddl",
      "ldaddal",
      "prfm",
      "ld1",
      "st1",
      "tbl",
      "tbx",
      "cmeq",
      "bsl",
      "crc32",
      "pmull",
      "aes-sha-round",
      "fmadd",
      "fmla",
      "fcvt-fp16",
      "sqrdmulh",
      "sqrdmlah",
      "sqadd-saturating",
      "dotprod",
    ]),
    encode: encodeMemorySimdFpInstruction,
  },
] satisfies readonly AArch64InstructionFamilyEncoder[]);

function encodeMemorySimdFpInstruction(input: AArch64EncodeInput) {
  if (input.instruction.opcode === "ldr-unsigned-immediate")
    return encodeLoadStoreUnsignedImmediate(input, loadUnsignedImmediateBaseWord);
  if (input.instruction.opcode === "str-unsigned-immediate")
    return encodeLoadStoreUnsignedImmediate(input, storeUnsignedImmediateBaseWord);
  if (input.instruction.opcode === "ldr-register-offset")
    return encodeThreeRegisterMemory(input, 0xf8606800);
  if (input.instruction.opcode === "ldp-signed-offset")
    return encodePairLoadStore(input, 0xa9400000);
  if (input.instruction.opcode === "stp-signed-offset")
    return encodePairLoadStore(input, 0xa9000000);
  if (input.instruction.opcode === "adrp") return encodeAdrp(input);
  if (input.instruction.opcode === "add-pageoff") return encodeAddPageOffset(input);
  if (input.instruction.opcode === "movi") return encodeMovi(input);
  if (input.instruction.opcode === "mov-vector")
    return encodeTwoRegisterInstruction(input, 0x4ea01c00);
  if (input.instruction.opcode === "rev") return encodeEndianRegister(input, 0xdac00c00);
  if (input.instruction.opcode === "rev16") return encodeEndianRegister(input, 0xdac00400);
  if (input.instruction.opcode === "rev32") return encodeEndianRegister(input, 0xdac00800);
  if (input.instruction.opcode === "ldar") return encodeAtomicLoadStore(input, 0xc8dffc00);
  if (input.instruction.opcode === "stlr") return encodeAtomicLoadStore(input, 0xc89ffc00);
  if (LDADD_BASES.has(input.instruction.opcode))
    return encodeLdadd(input, LDADD_BASES.get(input.instruction.opcode)!);
  if (input.instruction.opcode === "prfm") return encodePrefetch(input);
  if (input.instruction.opcode === "ld1") return encodeVectorMemory(input, 0x4c407000);
  if (input.instruction.opcode === "st1") return encodeVectorMemory(input, 0x4c007000);
  if (VECTOR_THREE_REGISTER_BASES.has(input.instruction.opcode))
    return encodeThreeRegisterInstruction(
      input,
      VECTOR_THREE_REGISTER_BASES.get(input.instruction.opcode)!,
    );
  if (input.instruction.opcode === "aes-sha-round")
    return encodeTwoRegisterInstruction(input, 0x4e284800);
  if (input.instruction.opcode === "fmadd") return encodeFmadd(input);
  if (input.instruction.opcode === "fcvt-fp16")
    return encodeTwoRegisterInstruction(input, 0x1e23c000);
  return encodingError(`encoding:unsupported-opcode:${input.instruction.opcode}`);
}

const LDADD_BASES = new Map<string, number>([
  ["ldadd", 0xf8200000],
  ["ldadda", 0xf8a00000],
  ["ldaddl", 0xf8600000],
  ["ldaddal", 0xf8e00000],
]);

const VECTOR_THREE_REGISTER_BASES = new Map<string, number>([
  ["tbl", 0x4e000000],
  ["tbx", 0x4e001000],
  ["cmeq", 0x6e208c00],
  ["bsl", 0x6e601c00],
  ["crc32", 0x1ac04800],
  ["pmull", 0x0ee0e000],
  ["fmla", 0x4e20cc00],
  ["sqrdmulh", 0x6ea0b400],
  ["sqrdmlah", 0x6e808400],
  ["sqadd-saturating", 0x4ea00c00],
  ["dotprod", 0x6e809400],
]);

function encodeLoadStoreUnsignedImmediate(
  input: AArch64EncodeInput,
  baseWordForWidth: (width: number, register: string) => number | undefined,
) {
  const [destination, base, offset] = input.instruction.operands;
  const width = input.instruction.accessWidthBytes ?? 8;
  if (destination?.kind !== "register" || base?.kind !== "memory-base") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const baseWord = baseWordForWidth(width, destination.register);
  if (baseWord === undefined) {
    return encodingError(`encoding:unsupported-access-width:${input.instruction.opcode}:${width}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (destinationNumber < 0 || baseNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }

  if (offset?.kind === "relocation-low12") {
    if (offset.addend % BigInt(width) !== 0n) {
      return encodingError(
        `encoding:pageoffset-12l-scale-mismatch:${input.instruction.opcode}:offset:${offset.addend.toString()}:width:${width}`,
      );
    }
    return encodingOk({
      bytes: writeU32Le(baseWord | (baseNumber << 5) | destinationNumber),
      relocationHole: {
        family: "pageoffset-12l",
        patchOffsetBytes: 0,
        bitRange: [10, 21],
        target: offset.target,
      },
    });
  }

  if (offset?.kind !== "immediate")
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  if (offset.value < 0n || offset.value % BigInt(width) !== 0n) {
    return encodingError(
      `encoding:unsigned-offset-scale-mismatch:${input.instruction.opcode}:offset:${offset.value.toString()}:width:${width}`,
    );
  }
  const scaledOffset = Number(offset.value / BigInt(width));
  if (scaledOffset > 0xfff) {
    return encodingError(
      `encoding:immediate-out-of-range:${input.instruction.opcode}:${offset.value.toString()}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(baseWord | (scaledOffset << 10) | (baseNumber << 5) | destinationNumber),
  });
}

function loadUnsignedImmediateBaseWord(width: number, register: string): number | undefined {
  if (isFpSimdRegister(register)) {
    return fpSimdLoadUnsignedImmediateBaseWord(width);
  }
  switch (width) {
    case 1:
      return 0x39400000;
    case 2:
      return 0x79400000;
    case 4:
      return 0xb9400000;
    case 8:
      return 0xf9400000;
    default:
      return undefined;
  }
}

function storeUnsignedImmediateBaseWord(width: number, register: string): number | undefined {
  if (isFpSimdRegister(register)) {
    return fpSimdStoreUnsignedImmediateBaseWord(width);
  }
  switch (width) {
    case 1:
      return 0x39000000;
    case 2:
      return 0x79000000;
    case 4:
      return 0xb9000000;
    case 8:
      return 0xf9000000;
    default:
      return undefined;
  }
}

function isFpSimdRegister(register: string): boolean {
  return /^[bhsdqv]\d+$/.test(register);
}

function fpSimdLoadUnsignedImmediateBaseWord(width: number): number | undefined {
  switch (width) {
    case 1:
      return 0x3d400000;
    case 2:
      return 0x7d400000;
    case 4:
      return 0xbd400000;
    case 8:
      return 0xfd400000;
    case 16:
      return 0x3dc00000;
    default:
      return undefined;
  }
}

function fpSimdStoreUnsignedImmediateBaseWord(width: number): number | undefined {
  switch (width) {
    case 1:
      return 0x3d000000;
    case 2:
      return 0x7d000000;
    case 4:
      return 0xbd000000;
    case 8:
      return 0xfd000000;
    case 16:
      return 0x3d800000;
    default:
      return undefined;
  }
}

function encodeEndianRegister(input: AArch64EncodeInput, baseWord: number) {
  const [destination, source] = input.instruction.operands;
  if (destination?.kind !== "register" || source?.kind !== "register") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const sourceNumber = registerNumber(input, source.register);
  if (destinationNumber < 0 || destinationNumber > 30 || sourceNumber < 0 || sourceNumber > 30) {
    return encodingError(
      `encoding:illegal-register:${input.instruction.opcode}:${destination.register}:${source.register}`,
    );
  }
  return encodingOk({ bytes: writeU32Le(baseWord | (sourceNumber << 5) | destinationNumber) });
}

function encodeThreeRegisterMemory(input: AArch64EncodeInput, baseWord: number) {
  const [destination, base, index] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    base?.kind !== "memory-base" ||
    index?.kind !== "register"
  ) {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  const indexNumber = registerNumber(input, index.register);
  if (destinationNumber < 0 || baseNumber < 0 || indexNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({
    bytes: writeU32Le(baseWord | (indexNumber << 16) | (baseNumber << 5) | destinationNumber),
  });
}

function encodePairLoadStore(input: AArch64EncodeInput, baseWord: number) {
  const [first, second, base, offset] = input.instruction.operands;
  if (first?.kind !== "register" || second?.kind !== "register" || base?.kind !== "memory-base") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const offsetValue = offset?.kind === "immediate" ? offset.value : 0n;
  if (offsetValue < -512n || offsetValue > 504n || offsetValue % 8n !== 0n) {
    return encodingError(
      `encoding:pair-offset-out-of-range:${input.instruction.opcode}:${offsetValue.toString()}`,
    );
  }
  const firstNumber = registerNumber(input, first.register);
  const secondNumber = registerNumber(input, second.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (firstNumber < 0 || secondNumber < 0 || baseNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  const scaledOffset = Number(offsetValue / 8n) & 0x7f;
  return encodingOk({
    bytes: writeU32Le(
      baseWord | (scaledOffset << 15) | (secondNumber << 10) | (baseNumber << 5) | firstNumber,
    ),
  });
}

function encodeAdrp(input: AArch64EncodeInput) {
  const [destination, target] = input.instruction.operands;
  if (destination?.kind !== "register" || target?.kind !== "relocation-target") {
    return encodingError("encoding:unresolved-operands:adrp");
  }
  const destinationNumber = registerNumber(input, destination.register);
  if (destinationNumber < 0 || destinationNumber > 30) {
    return encodingError(`encoding:illegal-register:adrp:${destination.register}`);
  }
  return encodingOk({
    bytes: writeU32Le(0x90000000 | destinationNumber),
    relocationHole: {
      family: "pagebase-rel21",
      patchOffsetBytes: 0,
      bitRange: [5, 30],
      target: target.target,
    },
  });
}

function encodeMovi(input: AArch64EncodeInput) {
  const [destination, immediate] = input.instruction.operands;
  if (destination?.kind !== "register" || immediate?.kind !== "immediate") {
    return encodingError("encoding:unresolved-operands:movi");
  }
  if (immediate.value !== 0n) {
    return encodingError(`encoding:immediate-out-of-range:movi:${immediate.value.toString()}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  if (destinationNumber < 0)
    return encodingError(`encoding:illegal-register:movi:${destination.register}`);
  return encodingOk({ bytes: writeU32Le(0x6f00e400 | destinationNumber) });
}

function encodeAddPageOffset(input: AArch64EncodeInput) {
  const [destination, source, offset] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    source?.kind !== "register" ||
    offset?.kind !== "relocation-low12"
  ) {
    return encodingError("encoding:unresolved-operands:add-pageoff");
  }
  const destinationNumber = registerNumber(input, destination.register);
  const sourceNumber = registerNumber(input, source.register);
  if (
    destinationNumber < 0 ||
    destinationNumber > 30 ||
    sourceNumber < 0 ||
    sourceNumber > 30 ||
    isZeroOrStackRegister(input, destination.register) ||
    isZeroOrStackRegister(input, source.register)
  ) {
    return encodingError(
      `encoding:illegal-register:add-pageoff:${destination.register}:${source.register}`,
    );
  }
  return encodingOk({
    bytes: writeU32Le(0x91000000 | (sourceNumber << 5) | destinationNumber),
    relocationHole: {
      family: "pageoffset-12a",
      patchOffsetBytes: 0,
      bitRange: [10, 21],
      target: offset.target,
    },
  });
}

function isZeroOrStackRegister(input: AArch64EncodeInput, register: string): boolean {
  const aliasSet = input.registerModel.aliasSetOf(register);
  return (
    aliasSet === "xzr" ||
    aliasSet === "zr" ||
    aliasSet === "sp" ||
    register === "xzr" ||
    register === "wzr" ||
    register === "sp" ||
    register === "wsp"
  );
}

function encodeAtomicLoadStore(input: AArch64EncodeInput, baseWord: number) {
  const [register, base] = input.instruction.operands;
  if (register?.kind !== "register" || base?.kind !== "memory-base") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const registerNumberValue = registerNumber(input, register.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (registerNumberValue < 0 || baseNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({ bytes: writeU32Le(baseWord | (baseNumber << 5) | registerNumberValue) });
}

function encodeLdadd(input: AArch64EncodeInput, baseWord: number) {
  const [source, destination, base] = input.instruction.operands;
  if (
    source?.kind !== "register" ||
    destination?.kind !== "register" ||
    base?.kind !== "memory-base"
  ) {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const sourceNumber = registerNumber(input, source.register);
  const destinationNumber = registerNumber(input, destination.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (sourceNumber < 0 || destinationNumber < 0 || baseNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({
    bytes: writeU32Le(baseWord | (sourceNumber << 16) | (baseNumber << 5) | destinationNumber),
  });
}

function encodePrefetch(input: AArch64EncodeInput) {
  const [base, offset] = input.instruction.operands;
  if (base?.kind !== "memory-base") return encodingError("encoding:unresolved-operands:prfm");
  const offsetValue = offset?.kind === "immediate" ? offset.value : 0n;
  if (offsetValue < 0n || offsetValue % 8n !== 0n || offsetValue / 8n > 0xfffn) {
    return encodingError(
      `encoding:unsigned-offset-scale-mismatch:prfm:offset:${offsetValue.toString()}:width:8`,
    );
  }
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (baseNumber < 0) return encodingError(`encoding:illegal-register:prfm:${base.register}`);
  return encodingOk({
    bytes: writeU32Le(0xf9800000 | (Number(offsetValue / 8n) << 10) | (baseNumber << 5)),
  });
}

function encodeVectorMemory(input: AArch64EncodeInput, baseWord: number) {
  const [register, base] = input.instruction.operands;
  if (register?.kind !== "register" || base?.kind !== "memory-base") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const registerNumberValue = registerNumber(input, register.register);
  const baseNumber = memoryBaseRegisterNumber(input, base.register);
  if (registerNumberValue < 0 || baseNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({ bytes: writeU32Le(baseWord | (baseNumber << 5) | registerNumberValue) });
}

function memoryBaseRegisterNumber(input: AArch64EncodeInput, register: string): number {
  const number = registerNumber(input, register);
  if (number < 0) return -1;
  if (register === "sp" || register === "wsp") {
    return input.registerModel.permitsOperand({
      registerKey: register,
      context: "stack-access",
      operationKind: input.instruction.opcode,
    })
      ? number
      : -1;
  }
  if (register === "xzr" || register === "wzr") return -1;
  return isAddressGeneralRegister(register) && number <= 30 ? number : -1;
}

function isAddressGeneralRegister(register: string): boolean {
  if (!register.startsWith("x")) return false;
  const index = Number(register.slice(1));
  return Number.isInteger(index) && index >= 0 && index <= 30;
}

function encodeTwoRegisterInstruction(input: AArch64EncodeInput, baseWord: number) {
  const [destination, source] = input.instruction.operands;
  if (destination?.kind !== "register" || source?.kind !== "register") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const sourceNumber = registerNumber(input, source.register);
  if (destinationNumber < 0 || sourceNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({ bytes: writeU32Le(baseWord | (sourceNumber << 5) | destinationNumber) });
}

function encodeThreeRegisterInstruction(input: AArch64EncodeInput, baseWord: number) {
  const [destination, left, right] = input.instruction.operands;
  if (destination?.kind !== "register" || left?.kind !== "register" || right?.kind !== "register") {
    return encodingError(`encoding:unresolved-operands:${input.instruction.opcode}`);
  }
  const destinationNumber = registerNumber(input, destination.register);
  const leftNumber = registerNumber(input, left.register);
  const rightNumber = registerNumber(input, right.register);
  if (destinationNumber < 0 || leftNumber < 0 || rightNumber < 0) {
    return encodingError(`encoding:illegal-register:${input.instruction.opcode}`);
  }
  return encodingOk({
    bytes: writeU32Le(baseWord | (rightNumber << 16) | (leftNumber << 5) | destinationNumber),
  });
}

function encodeFmadd(input: AArch64EncodeInput) {
  const [destination, multiplier, multiplicand, addend] = input.instruction.operands;
  if (
    destination?.kind !== "register" ||
    multiplier?.kind !== "register" ||
    multiplicand?.kind !== "register" ||
    addend?.kind !== "register"
  ) {
    return encodingError("encoding:unresolved-operands:fmadd");
  }
  const destinationNumber = registerNumber(input, destination.register);
  const multiplierNumber = registerNumber(input, multiplier.register);
  const multiplicandNumber = registerNumber(input, multiplicand.register);
  const addendNumber = registerNumber(input, addend.register);
  if (destinationNumber < 0 || multiplierNumber < 0 || multiplicandNumber < 0 || addendNumber < 0) {
    return encodingError("encoding:illegal-register:fmadd");
  }
  return encodingOk({
    bytes: writeU32Le(
      0x1f400000 |
        (multiplicandNumber << 16) |
        (addendNumber << 10) |
        (multiplierNumber << 5) |
        destinationNumber,
    ),
  });
}

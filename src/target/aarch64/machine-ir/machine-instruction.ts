import type { AArch64MachineInstructionId } from "./ids";
import {
  aarch64MachineTypeStableKey,
  aarch64RegisterClassAcceptsType,
  type AArch64MachineType,
  type AArch64RegisterClass,
} from "./machine-types";
import {
  aarch64ImmediateValueMatchesKind,
  aarch64OpcodeFormById,
  type AArch64OpcodeForm,
  type AArch64OpcodeFormId,
  type AArch64OpcodeOperandSchema,
} from "./opcode-catalog";
import { type AArch64InstructionOperand, type AArch64InstructionOperandRole } from "./operands";
import { aarch64ResourceStableKey } from "./resources";
import type { AArch64ProvenanceOrigin } from "./provenance";
import { defaultAArch64ScheduleMetadata, type AArch64ScheduleMetadata } from "./schedule";
import type { AArch64MemoryOrderingMetadata } from "./memory-order";
import type { AArch64SecurityMetadata } from "./security";

export interface AArch64InstructionFlags {
  readonly mayTrap: boolean;
  readonly mayLoad?: boolean;
  readonly mayStore?: boolean;
  readonly isTerminator?: boolean;
}

export interface AArch64MachineInstruction {
  readonly instructionId: AArch64MachineInstructionId;
  readonly opcode: AArch64OpcodeFormId;
  readonly operands: readonly AArch64InstructionOperand[];
  readonly flags: AArch64InstructionFlags;
  readonly origin: AArch64ProvenanceOrigin;
  readonly schedule: AArch64ScheduleMetadata;
  readonly memoryOrdering?: AArch64MemoryOrderingMetadata;
  readonly security?: AArch64SecurityMetadata;
}

export function aarch64InstructionFlags(flags: AArch64InstructionFlags): AArch64InstructionFlags {
  return Object.freeze({ ...flags });
}

export function aarch64MachineInstruction(input: {
  readonly instructionId: AArch64MachineInstructionId;
  readonly opcode: AArch64OpcodeFormId;
  readonly operands: readonly AArch64InstructionOperand[];
  readonly flags: AArch64InstructionFlags;
  readonly origin: AArch64ProvenanceOrigin;
  readonly schedule?: AArch64ScheduleMetadata;
  readonly memoryOrdering?: AArch64MemoryOrderingMetadata;
  readonly security?: AArch64SecurityMetadata;
}): AArch64MachineInstruction {
  const formRecord = aarch64OpcodeFormById(input.opcode);
  validateOperandRoles(input.operands, formRecord.operandSchema);
  validateOperandValues(input.operands, formRecord);
  validateImplicitResources(input.operands, formRecord.implicitResources);
  return Object.freeze({
    instructionId: input.instructionId,
    opcode: input.opcode,
    operands: Object.freeze([...input.operands]),
    flags: aarch64InstructionFlags(input.flags),
    origin: Object.freeze({ ...input.origin }) as AArch64ProvenanceOrigin,
    schedule: input.schedule ?? defaultAArch64ScheduleMetadata("integer"),
    ...(input.memoryOrdering === undefined ? {} : { memoryOrdering: input.memoryOrdering }),
    ...(input.security === undefined ? {} : { security: input.security }),
  });
}

function validateOperandRoles(
  operands: readonly AArch64InstructionOperand[],
  expectedSchema: readonly AArch64OpcodeOperandSchema[],
): void {
  const actualRoles = operands.map((operand) => operand.role);
  const requiredCount = expectedSchema.filter((entry) => entry.optional !== true).length;
  if (actualRoles.length < requiredCount || actualRoles.length > expectedSchema.length) {
    throw new RangeError(
      `Instruction expects ${requiredCount}..${expectedSchema.length} operands, got ${actualRoles.length}.`,
    );
  }
  actualRoles.forEach((role, index) => {
    const expected = expectedSchema[index];
    if (expected === undefined || expected.role !== role) {
      throw new RangeError(
        `Instruction operand ${index} role mismatch: expected ${expected?.role ?? "<none>"}, got ${role}.`,
      );
    }
  });
}

function validateOperandValues(
  operands: readonly AArch64InstructionOperand[],
  formRecord: AArch64OpcodeForm,
): void {
  operands.forEach((operand, index) => {
    const schema = formRecord.operandSchema[index];
    if (schema === undefined) {
      throw new RangeError(`Instruction operand ${index} has no schema entry.`);
    }
    validateOperandKind(operand, index);
    validateSchemaOperandKind(operand, schema, index);
    validateRegisterOperand(operand, schema);
    validateImmediateOperand(operands, operand, schema, formRecord);
  });
  validateMemoryShape(operands, formRecord);
}

function validateOperandKind(operand: AArch64InstructionOperand, index: number): void {
  const kind = operand.operand.kind;
  switch (operand.role) {
    case "def":
    case "tiedDefUse":
      if (kind !== "vreg") {
        throw new RangeError(`Instruction operand ${index} role ${operand.role} requires vreg.`);
      }
      return;
    case "memoryBase":
    case "memoryIndex":
      if (kind !== "vreg" && kind !== "frameObject") {
        throw new RangeError(`Instruction operand ${index} role ${operand.role} requires address.`);
      }
      return;
    case "branchTarget":
      if (kind !== "block") {
        throw new RangeError(`Instruction operand ${index} branch target requires block.`);
      }
      return;
    case "implicitDef":
    case "implicitUse":
      if (kind !== "resource") {
        throw new RangeError(
          `Instruction operand ${index} role ${operand.role} requires resource.`,
        );
      }
      return;
    case "use":
      if (kind === "resource" || kind === "block" || kind === "frameObject") {
        throw new RangeError(`Instruction operand ${index} use role cannot use ${kind}.`);
      }
      return;
  }
}

function validateSchemaOperandKind(
  operand: AArch64InstructionOperand,
  schema: AArch64OpcodeOperandSchema,
  index: number,
): void {
  if (schema.operandKind === undefined || operand.operand.kind === schema.operandKind) {
    return;
  }
  throw new RangeError(
    `Instruction operand ${index} kind mismatch: expected ${schema.operandKind}, got ${operand.operand.kind}.`,
  );
}

function validateRegisterOperand(
  operand: AArch64InstructionOperand,
  schema: AArch64OpcodeOperandSchema,
): void {
  if (operand.operand.kind !== "vreg") {
    return;
  }
  const register = operand.operand.register;
  if (schema.registerClass !== undefined && register.registerClass !== schema.registerClass) {
    throw new RangeError(
      `Instruction register class mismatch: expected ${schema.registerClass}, got ${register.registerClass}.`,
    );
  }
  if (
    schema.registerClasses !== undefined &&
    !schema.registerClasses.includes(register.registerClass)
  ) {
    throw new RangeError(
      `Instruction register class mismatch: expected one of ${schema.registerClasses.join(", ")}, got ${register.registerClass}.`,
    );
  }
  validateRegisterType(register.registerClass, operand.type);
  if (aarch64MachineTypeStableKey(register.type) !== aarch64MachineTypeStableKey(operand.type)) {
    throw new RangeError(
      `Instruction operand type ${aarch64MachineTypeStableKey(operand.type)} does not match register ${aarch64MachineTypeStableKey(register.type)}.`,
    );
  }
}

function validateRegisterType(registerClass: AArch64RegisterClass, type: AArch64MachineType): void {
  if (!aarch64RegisterClassAcceptsType(registerClass, type)) {
    throw new RangeError(
      `Instruction register class ${registerClass} cannot hold ${aarch64MachineTypeStableKey(type)}.`,
    );
  }
}

function validateImmediateOperand(
  operands: readonly AArch64InstructionOperand[],
  operand: AArch64InstructionOperand,
  schema: AArch64OpcodeOperandSchema,
  formRecord: AArch64OpcodeForm,
): void {
  if (operand.operand.kind === "immediate" && isAArch64LogicalImmediateOpcode(formRecord.id)) {
    const width = aarch64LogicalImmediateWidth(operand.type);
    if (!isAArch64LogicalImmediate(operand.operand.value, width)) {
      throw new RangeError(
        `Instruction logical immediate ${operand.operand.value} is not encodable in ${width} bits.`,
      );
    }
  }
  if (
    operand.operand.kind === "immediate" &&
    schema.immediateKind !== undefined &&
    !aarch64InstructionImmediateValueMatchesKind({
      kind: schema.immediateKind,
      value: operand.operand.value,
      operands,
      form: formRecord,
    })
  ) {
    throw new RangeError(
      `Instruction immediate ${operand.operand.value} is invalid for ${schema.immediateKind}.`,
    );
  }
  if (operand.operand.kind !== "immediate" || formRecord.immediateBits === undefined) {
    return;
  }
  const maxExclusive = 1n << BigInt(formRecord.immediateBits);
  if (operand.operand.value < 0n || operand.operand.value >= maxExclusive) {
    throw new RangeError(
      `Instruction immediate ${operand.operand.value} does not fit ${formRecord.immediateBits} bits.`,
    );
  }
}

export function isAArch64LogicalImmediateOpcode(opcode: AArch64OpcodeFormId): boolean {
  return (
    opcode === "and-logical-immediate" ||
    opcode === "orr-logical-immediate" ||
    opcode === "eor-logical-immediate"
  );
}

export function aarch64LogicalImmediateWidth(type: AArch64MachineType): 32 | 64 {
  return type.kind === "integer" && type.width <= 32 ? 32 : 64;
}

export function isAArch64LogicalImmediate(value: bigint, width: 32 | 64): boolean {
  const normalized = BigInt.asUintN(width, value);
  const widthMask = (1n << BigInt(width)) - 1n;
  if (normalized === 0n || normalized === widthMask) {
    return false;
  }
  for (const elementSize of [2, 4, 8, 16, 32, 64] as const) {
    if (elementSize > width || width % elementSize !== 0) {
      continue;
    }
    const elementMask = (1n << BigInt(elementSize)) - 1n;
    const element = normalized & elementMask;
    if (element === 0n || element === elementMask) {
      continue;
    }
    if (repeatBitPattern(element, elementSize, width) !== normalized) {
      continue;
    }
    if (isRotatedRunOfOnes(element, elementSize)) {
      return true;
    }
  }
  return false;
}

export function aarch64InstructionImmediateValueMatchesKind(input: {
  readonly kind: AArch64OpcodeOperandSchema["immediateKind"];
  readonly value: bigint;
  readonly operands: readonly AArch64InstructionOperand[];
  readonly form: AArch64OpcodeForm;
}): boolean {
  if (input.kind === undefined) {
    return true;
  }
  if (input.kind === "unsignedMemoryOffset12") {
    const scale = unsignedMemoryOffsetScaleForInstruction(input.form, input.operands);
    if (scale === undefined) {
      return aarch64ImmediateValueMatchesKind(input.kind, input.value);
    }
    const scaleBigInt = BigInt(scale);
    return (
      input.value >= 0n && input.value <= 4095n * scaleBigInt && input.value % scaleBigInt === 0n
    );
  }
  if (input.kind === "moveWideShift") {
    if (!aarch64ImmediateValueMatchesKind(input.kind, input.value)) {
      return false;
    }
    const width = moveWideWidthForInstruction(input.form, input.operands);
    return width === 32 ? input.value <= 16n : true;
  }
  return aarch64ImmediateValueMatchesKind(input.kind, input.value);
}

function moveWideWidthForInstruction(
  form: AArch64OpcodeForm,
  operands: readonly AArch64InstructionOperand[],
): 32 | 64 {
  switch (String(form.id)) {
    case "movz":
    case "movn":
    case "movk":
      return aarch64LogicalImmediateWidth(operands[0]?.type ?? { kind: "integer", width: 64 });
    default:
      return 64;
  }
}

function unsignedMemoryOffsetScaleForInstruction(
  form: AArch64OpcodeForm,
  operands: readonly AArch64InstructionOperand[],
): number | undefined {
  switch (String(form.id)) {
    case "ldr-unsigned-immediate":
    case "str-unsigned-immediate":
    case "ld1":
    case "st1":
      return memoryAccessBytesForType(operands[0]?.type);
    case "prfm":
      return 8;
    default:
      return undefined;
  }
}

function memoryAccessBytesForType(type: AArch64MachineType | undefined): number | undefined {
  if (type === undefined) {
    return undefined;
  }
  switch (type.kind) {
    case "integer":
    case "float":
      return Math.max(1, Math.ceil(type.width / 8));
    case "pointer":
      return 8;
    case "vector":
      return Math.max(
        1,
        Math.ceil((machineScalarTypeBitWidth(type.laneType) * type.laneCount) / 8),
      );
    case "token":
    case "resourceToken":
      return undefined;
  }
}

function machineScalarTypeBitWidth(
  type: Extract<AArch64MachineType, { readonly kind: "vector" }>["laneType"],
): number {
  switch (type.kind) {
    case "integer":
    case "float":
      return type.width;
    case "pointer":
      return 64;
    case "token":
    case "resourceToken":
      return 0;
  }
}

function repeatBitPattern(pattern: bigint, patternWidth: number, targetWidth: number): bigint {
  let result = 0n;
  for (let shift = 0; shift < targetWidth; shift += patternWidth) {
    result |= pattern << BigInt(shift);
  }
  return result;
}

function isRotatedRunOfOnes(pattern: bigint, width: number): boolean {
  for (let rotation = 0; rotation < width; rotation += 1) {
    const rotated = rotateRight(pattern, rotation, width);
    if (isRunOfLowOnes(rotated, width)) {
      return true;
    }
  }
  return false;
}

function rotateRight(value: bigint, rotation: number, width: number): bigint {
  const mask = (1n << BigInt(width)) - 1n;
  const amount = BigInt(rotation % width);
  return ((value >> amount) | (value << (BigInt(width) - amount))) & mask;
}

function isRunOfLowOnes(value: bigint, width: number): boolean {
  for (let runLength = 1; runLength < width; runLength += 1) {
    if (value === (1n << BigInt(runLength)) - 1n) {
      return true;
    }
  }
  return false;
}

function validateMemoryShape(
  operands: readonly AArch64InstructionOperand[],
  formRecord: AArch64OpcodeForm,
): void {
  if (formRecord.memoryShape === undefined || formRecord.memoryShape === "none") {
    return;
  }
  const hasMemoryBase = operands.some((operand) => operand.role === "memoryBase");
  if (formRecord.memoryShape === "barrier") {
    if (hasMemoryBase || operands.length > 0) {
      throw new RangeError("Barrier instructions cannot carry memory operands.");
    }
    return;
  }
  if (!hasMemoryBase) {
    throw new RangeError(`Memory instruction ${formRecord.id} requires a memory base operand.`);
  }
}

function validateImplicitResources(
  operands: readonly AArch64InstructionOperand[],
  expectedResources: readonly {
    readonly role: Extract<AArch64InstructionOperandRole, "implicitDef" | "implicitUse">;
    readonly resource: { readonly kind: string };
  }[],
): void {
  const present = new Set(
    operands
      .filter(resourceOperand)
      .map((operand) => `${operand.role}:${aarch64ResourceStableKey(operand.operand.resource)}`),
  );
  for (const expected of expectedResources) {
    const key = `${expected.role}:${aarch64ResourceStableKey(expected.resource as never)}`;
    if (!present.has(key)) {
      throw new RangeError(`Instruction is missing implicit resource ${key}.`);
    }
  }
}

function resourceOperand(
  operand: AArch64InstructionOperand,
): operand is AArch64InstructionOperand & {
  readonly operand: {
    readonly kind: "resource";
    readonly resource: Parameters<typeof aarch64ResourceStableKey>[0];
  };
} {
  return operand.operand.kind === "resource";
}

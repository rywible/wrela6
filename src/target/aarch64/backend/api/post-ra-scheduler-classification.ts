import type {
  AArch64PhysicalInstruction,
  AArch64PhysicalOperand,
} from "../finalization/physical-instruction-ir";

export function schedulerDefinedRegisters(
  instruction: AArch64PhysicalInstruction,
): readonly string[] {
  const registerOperands = instruction.operands.filter(isPhysicalRegisterOperand);
  const fixedRegisterDefs = instruction.fixedRegisterDefs ?? [];
  if (registerOperands.length === 0) return Object.freeze([...fixedRegisterDefs]);
  if (instructionDefinesFirstRegister(instruction.opcode)) {
    return Object.freeze([registerOperands[0]!.register, ...fixedRegisterDefs]);
  }
  if (instruction.opcode === "ldp-signed-offset") {
    return Object.freeze([
      ...registerOperands.slice(0, 2).map((operand) => operand.register),
      ...fixedRegisterDefs,
    ]);
  }
  return Object.freeze([...fixedRegisterDefs]);
}

export function schedulerUsedRegisters(instruction: AArch64PhysicalInstruction): readonly string[] {
  const registerOperands = instruction.operands.filter(isPhysicalRegisterOperand);
  const memoryBaseRegisters = instruction.operands
    .filter(
      (operand): operand is Extract<AArch64PhysicalOperand, { readonly kind: "memory" }> =>
        operand.kind === "memory",
    )
    .map((operand) => operand.base);
  const explicitRegisters = instructionDefinesFirstRegister(instruction.opcode)
    ? registerOperands.slice(1)
    : instruction.opcode === "ldp-signed-offset"
      ? registerOperands.slice(2)
      : registerOperands;
  return Object.freeze([
    ...explicitRegisters.map((operand) => operand.register),
    ...memoryBaseRegisters,
    ...(instruction.fixedRegisterUses ?? []),
  ]);
}

export function instructionDefinesNzcv(opcode: string): boolean {
  return opcode === "cmp-shifted-register" || opcode === "ccmp";
}

export function instructionUsesNzcv(opcode: string): boolean {
  return opcode === "b-cond" || opcode === "cset" || opcode === "csel" || opcode === "ccmp";
}

export function isSchedulerBoundaryOpcode(opcode: string): boolean {
  return (
    opcode === "label" ||
    opcode === "ret" ||
    opcode === "trap" ||
    opcode === "br" ||
    opcode === "blr" ||
    opcode === "b" ||
    opcode === "bl" ||
    opcode === "b-cond" ||
    opcode === "cbz" ||
    opcode === "cbnz" ||
    opcode === "tbz" ||
    opcode === "tbnz" ||
    opcode === "dmb" ||
    opcode === "dsb"
  );
}

export function isSchedulerCallBoundaryOpcode(opcode: string): boolean {
  return opcode === "bl" || opcode === "blr";
}

export function isSchedulerObservableExitOpcode(opcode: string): boolean {
  return opcode === "ret" || opcode === "trap" || opcode === "br";
}

function isPhysicalRegisterOperand(
  operand: AArch64PhysicalOperand,
): operand is Extract<AArch64PhysicalOperand, { readonly kind: "register" }> {
  return operand.kind === "register";
}

function instructionDefinesFirstRegister(opcode: string): boolean {
  return (
    opcode === "movz" ||
    opcode === "movk" ||
    opcode === "movn" ||
    opcode === "movi" ||
    opcode === "mov-vector" ||
    opcode === "add-immediate" ||
    opcode === "sub-immediate" ||
    opcode === "frame-address" ||
    opcode === "add-pageoff" ||
    opcode === "add-shifted-register" ||
    opcode === "sub-shifted-register" ||
    opcode === "and-logical-immediate" ||
    opcode === "and-shifted-register" ||
    opcode === "orr-logical-immediate" ||
    opcode === "orr-shifted-register" ||
    opcode === "eor-logical-immediate" ||
    opcode === "eor-shifted-register" ||
    opcode === "mul" ||
    opcode === "udiv" ||
    opcode === "sdiv" ||
    opcode === "lsl" ||
    opcode === "lsl-immediate" ||
    opcode === "lsr" ||
    opcode === "cset" ||
    opcode === "csel" ||
    opcode === "ldr-unsigned-immediate" ||
    opcode === "ldr-register-offset" ||
    opcode === "rev" ||
    opcode === "rev16" ||
    opcode === "rev32"
  );
}

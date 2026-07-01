import type { AArch64MachineBlockId, AArch64FrameObjectId, AArch64SymbolId } from "./ids";
import { aarch64TokenMachineType, type AArch64MachineType } from "./machine-types";
import {
  aarch64Resource,
  aarch64ResourceStableKey,
  type AArch64MachineResource,
} from "./resources";
import type { AArch64VirtualRegister } from "./virtual-register";

export type AArch64InstructionOperandRole =
  | "def"
  | "use"
  | "tiedDefUse"
  | "implicitDef"
  | "implicitUse"
  | "memoryBase"
  | "memoryIndex"
  | "branchTarget";

export type AArch64OperandValue =
  | { readonly kind: "vreg"; readonly register: AArch64VirtualRegister }
  | { readonly kind: "resource"; readonly resource: AArch64MachineResource }
  | { readonly kind: "immediate"; readonly value: bigint }
  | { readonly kind: "frameObject"; readonly frameObject: AArch64FrameObjectId }
  | { readonly kind: "symbol"; readonly symbol: AArch64SymbolId }
  | { readonly kind: "block"; readonly block: AArch64MachineBlockId };

export interface AArch64InstructionOperand {
  readonly role: AArch64InstructionOperandRole;
  readonly operand: AArch64OperandValue;
  readonly type: AArch64MachineType;
  readonly stableKey: string;
}

export function aarch64InstructionOperand(input: {
  readonly role: AArch64InstructionOperandRole;
  readonly operand: AArch64OperandValue;
  readonly type: AArch64MachineType;
}): AArch64InstructionOperand {
  return Object.freeze({
    role: input.role,
    operand: freezeOperand(input.operand),
    type: Object.freeze({ ...input.type }) as AArch64MachineType,
    stableKey: `${input.role}:${operandStableKey(input.operand)}`,
  });
}

export function defVreg(
  register: AArch64VirtualRegister,
  type: AArch64MachineType,
): AArch64InstructionOperand {
  return aarch64InstructionOperand({ role: "def", operand: { kind: "vreg", register }, type });
}

export function useVreg(
  register: AArch64VirtualRegister,
  type: AArch64MachineType,
): AArch64InstructionOperand {
  return aarch64InstructionOperand({ role: "use", operand: { kind: "vreg", register }, type });
}

export function immediateOperand(
  value: bigint,
  type: AArch64MachineType,
): AArch64InstructionOperand {
  return aarch64InstructionOperand({ role: "use", operand: { kind: "immediate", value }, type });
}

export function implicitDefResource(resource: AArch64MachineResource): AArch64InstructionOperand {
  const normalizedResource = aarch64Resource(resource);
  return aarch64InstructionOperand({
    role: "implicitDef",
    operand: { kind: "resource", resource: normalizedResource },
    type: aarch64TokenMachineType(resource.kind === "NZCV" ? "nzcv" : normalizedResource.kind),
  });
}

export function implicitUseResource(resource: AArch64MachineResource): AArch64InstructionOperand {
  const normalizedResource = aarch64Resource(resource);
  return aarch64InstructionOperand({
    role: "implicitUse",
    operand: { kind: "resource", resource: normalizedResource },
    type: aarch64TokenMachineType(resource.kind === "NZCV" ? "nzcv" : normalizedResource.kind),
  });
}

export function branchTarget(block: AArch64MachineBlockId): AArch64InstructionOperand {
  return aarch64InstructionOperand({
    role: "branchTarget",
    operand: { kind: "block", block },
    type: aarch64TokenMachineType("branch-target"),
  });
}

export function symbolOperand(symbol: AArch64SymbolId): AArch64InstructionOperand {
  return aarch64InstructionOperand({
    role: "use",
    operand: { kind: "symbol", symbol },
    type: aarch64TokenMachineType("symbol-reference"),
  });
}

function freezeOperand(operand: AArch64OperandValue): AArch64OperandValue {
  switch (operand.kind) {
    case "vreg":
      return Object.freeze({ kind: "vreg", register: operand.register });
    case "resource":
      return Object.freeze({ kind: "resource", resource: aarch64Resource(operand.resource) });
    case "immediate":
      return Object.freeze({ kind: "immediate", value: operand.value });
    case "frameObject":
      return Object.freeze({ kind: "frameObject", frameObject: operand.frameObject });
    case "symbol":
      return Object.freeze({ kind: "symbol", symbol: operand.symbol });
    case "block":
      return Object.freeze({ kind: "block", block: operand.block });
  }
}

function operandStableKey(operand: AArch64OperandValue): string {
  switch (operand.kind) {
    case "vreg":
      return `vreg:${operand.register.vreg}`;
    case "resource":
      return `resource:${aarch64ResourceStableKey(operand.resource)}`;
    case "immediate":
      return `imm:${operand.value}`;
    case "frameObject":
      return `frame:${operand.frameObject}`;
    case "symbol":
      return `symbol:${operand.symbol}`;
    case "block":
      return `block:${operand.block}`;
  }
}

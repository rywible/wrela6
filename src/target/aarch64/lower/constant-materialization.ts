import {
  aarch64MachineInstructionId,
  aarch64RelocationReferenceId,
  aarch64SymbolId,
} from "../machine-ir/ids";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import { defVreg, immediateOperand, useVreg } from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import {
  aarch64RematerializationRecord,
  type AArch64RematerializationRecord,
} from "../machine-ir/rematerialization";
import { aarch64VirtualRegister } from "../machine-ir/virtual-register";
import { aarch64RelocationReference } from "../machine-ir/relocation-reference";
import type { AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export interface AArch64ConstantMaterializationResult {
  readonly instructions: readonly AArch64MachineInstruction[];
  readonly rematerialization: AArch64RematerializationRecord;
}

export interface AArch64MoveWideConstantStep {
  readonly opcode: "movz" | "movn" | "movk";
  readonly value: bigint;
  readonly shift: number;
}

export function materializeAArch64Constant(input: {
  readonly value: bigint;
  readonly widthBits?: 32 | 64;
}): AArch64ConstantMaterializationResult {
  const widthBits = input.widthBits ?? 64;
  const machineType = aarch64IntMachineType(widthBits);
  const register = aarch64VirtualRegister({
    vreg: 0 as never,
    registerClass: widthBits === 32 ? "gpr32" : "gpr64",
    type: machineType,
    origin: { kind: "synthetic", stableKey: "constant.materialization" },
  });
  const steps = planAArch64MoveWideConstant(input.value, widthBits);
  const instructions = steps.map((step, index) =>
    aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(index),
      opcode: aarch64OpcodeFormId(step.opcode),
      operands: [
        index === 0
          ? defVreg(register, machineType)
          : { ...useVreg(register, machineType), role: "tiedDefUse" as const },
        immediateOperand(step.value, machineType),
        immediateOperand(BigInt(step.shift), machineType),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin(`constant:${input.value}:${step.opcode}:${step.shift}`),
    }),
  );
  return Object.freeze({
    instructions: Object.freeze(instructions),
    rematerialization: aarch64RematerializationRecord({
      producer: instructions[0]?.instructionId ?? aarch64MachineInstructionId(0),
      kind: "constant",
      cost: instructions.length,
      requiredFacts: [],
      requiredSymbols: [],
      relocationReferences: [],
      implicitResources: [],
    }),
  });
}

export function planAArch64MoveWideConstant(
  value: bigint,
  widthBits: 32 | 64,
): readonly AArch64MoveWideConstantStep[] {
  const normalized = BigInt.asUintN(widthBits, value);
  const zeroPlan = planFromZero(normalized, widthBits);
  const onesPlan = planFromOnes(normalized, widthBits);
  return Object.freeze(onesPlan.length < zeroPlan.length ? [...onesPlan] : [...zeroPlan]);
}

export function materializeAArch64SymbolAddress(input: { readonly symbol: string }) {
  return Object.freeze({
    instructions: Object.freeze(["adrp", "add-pageoff"]),
    relocations: Object.freeze([
      aarch64RelocationReference({
        relocationId: aarch64RelocationReferenceId(0),
        kind: "PAGE",
        symbol: aarch64SymbolId(input.symbol),
        addend: 0n,
        targetFingerprint: "aarch64-relocation:page",
      }),
      aarch64RelocationReference({
        relocationId: aarch64RelocationReferenceId(1),
        kind: "PAGEOFF12",
        symbol: aarch64SymbolId(input.symbol),
        addend: 0n,
        targetFingerprint: "aarch64-relocation:pageoff",
      }),
    ]),
  });
}

export function literalPoolKeyForAArch64Constant(input: {
  readonly typeKey: string;
  readonly bytes: readonly number[];
  readonly section: string;
}): string {
  return `literal:${input.section}:${input.typeKey}:${input.bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function materializeAArch64ConstantsStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  return recordAArch64StagePlanning(
    state,
    "materialize-constants",
    "constants-materialized-deterministically",
  );
}

function planFromZero(
  normalized: bigint,
  widthBits: 32 | 64,
): readonly AArch64MoveWideConstantStep[] {
  const nonZeroChunks: { readonly shift: number; readonly value: bigint }[] = [];
  for (let shift = 0; shift < widthBits; shift += 16) {
    const chunk = (normalized >> BigInt(shift)) & 0xffffn;
    if (chunk !== 0n) {
      nonZeroChunks.push({ shift, value: chunk });
    }
  }
  const first = nonZeroChunks[0];
  if (first === undefined) {
    return Object.freeze([{ opcode: "movz", shift: 0, value: 0n }]);
  }
  return Object.freeze([
    { opcode: "movz", shift: first.shift, value: first.value },
    ...nonZeroChunks.slice(1).map((chunk) => ({
      opcode: "movk" as const,
      shift: chunk.shift,
      value: chunk.value,
    })),
  ]);
}

function planFromOnes(
  normalized: bigint,
  widthBits: 32 | 64,
): readonly AArch64MoveWideConstantStep[] {
  const nonOneChunks: { readonly shift: number; readonly value: bigint }[] = [];
  for (let shift = 0; shift < widthBits; shift += 16) {
    const chunk = (normalized >> BigInt(shift)) & 0xffffn;
    if (chunk !== 0xffffn) {
      nonOneChunks.push({ shift, value: chunk });
    }
  }
  const first = nonOneChunks[0];
  if (first === undefined) {
    return Object.freeze([{ opcode: "movn", shift: 0, value: 0n }]);
  }
  return Object.freeze([
    { opcode: "movn", shift: first.shift, value: ~first.value & 0xffffn },
    ...nonOneChunks.slice(1).map((chunk) => ({
      opcode: "movk" as const,
      shift: chunk.shift,
      value: chunk.value,
    })),
  ]);
}

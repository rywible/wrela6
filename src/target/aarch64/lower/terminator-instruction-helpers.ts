import type { OptIrOperationId } from "../../../opt-ir/ids";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import { aarch64MachineInstructionId, aarch64VirtualRegisterId } from "../machine-ir/ids";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  useVreg,
} from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import { defaultAArch64ScheduleMetadata, type AArch64IssueClass } from "../machine-ir/schedule";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import { aarch64IntMachineType } from "../machine-ir/machine-types";
import { planAArch64MoveWideConstant } from "./constant-materialization";
import { AARCH64_LOWERING_ID_STRIDE } from "./lowering-id-stride";
import { abiLocationKey } from "./materialization-contracts";
import { registerClassForMachineType } from "./operation-materialization-helpers";

export type AArch64TerminatorOpcode =
  | "adrp"
  | "add-pageoff"
  | "b"
  | "b-cond"
  | "cbz"
  | "cbnz"
  | "cmp-shifted-register"
  | "ldr-register-offset"
  | "lsl"
  | "lsl-immediate"
  | "mov-vector"
  | "movk"
  | "movn"
  | "movz"
  | "ret"
  | "br"
  | "sub-shifted-register"
  | "trap";

export function returnAbiRegister(input: {
  readonly operationId: OptIrOperationId;
  readonly index: number;
  readonly location: AArch64AbiLocation;
  readonly sourceRegister: AArch64VirtualRegister;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(
      3_000_000_000 + Number(input.operationId) * AARCH64_LOWERING_ID_STRIDE + input.index,
    ),
    registerClass:
      input.location.kind === "vectorReg"
        ? input.sourceRegister.registerClass
        : registerClassForMachineType(input.sourceRegister.type),
    type: input.sourceRegister.type,
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir-terminator:${String(input.operationId)}:abi-return:${abiLocationKey(input.location)}:${input.index}`,
    },
  });
}

export function unitSuccessReturnAbiRegister(input: {
  readonly operationId: OptIrOperationId;
  readonly location: AArch64AbiLocation;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(
      3_000_000_000 + Number(input.operationId) * AARCH64_LOWERING_ID_STRIDE,
    ),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir-terminator:${String(input.operationId)}:abi-return:${abiLocationKey(
        input.location,
      )}:unit-success`,
    },
  });
}

export function terminatorCopyInstruction(input: {
  readonly operationId: OptIrOperationId;
  readonly sequenceIndex: number;
  readonly output: AArch64VirtualRegister;
  readonly input: AArch64VirtualRegister;
  readonly label: string;
}): AArch64MachineInstruction {
  return copyInstruction({
    instructionId: aarch64MachineInstructionId(
      1_000_000_000 + Number(input.operationId) * AARCH64_LOWERING_ID_STRIDE + input.sequenceIndex,
    ),
    output: input.output,
    input: input.input,
    originKey: `opt-ir-terminator:${String(input.operationId)}:${input.label}:${input.sequenceIndex}`,
    issueClass:
      input.output.registerClass === "vector64" || input.output.registerClass === "vector128"
        ? "vector"
        : "integer",
  });
}

export function copyInstruction(input: {
  readonly instructionId: ReturnType<typeof aarch64MachineInstructionId>;
  readonly output: AArch64VirtualRegister;
  readonly input: AArch64VirtualRegister;
  readonly originKey: string;
  readonly issueClass: AArch64IssueClass;
}): AArch64MachineInstruction {
  const isVectorCopy =
    input.output.registerClass === "vector64" || input.output.registerClass === "vector128";
  const operands = isVectorCopy
    ? [defVreg(input.output, input.output.type), useVreg(input.input, input.input.type)]
    : [
        defVreg(input.output, input.output.type),
        useVreg(input.input, input.input.type),
        immediateOperand(0n, input.output.type),
      ];
  return aarch64MachineInstruction({
    instructionId: input.instructionId,
    opcode: aarch64OpcodeFormId(isVectorCopy ? "mov-vector" : "add-immediate"),
    operands,
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(input.originKey),
    schedule: defaultAArch64ScheduleMetadata(input.issueClass),
  });
}

export function terminatorConstantInstructions(input: {
  readonly operationId: OptIrOperationId;
  readonly register: AArch64VirtualRegister;
  readonly value: bigint;
  readonly sequenceIndex: number;
  readonly label: string;
}): readonly AArch64MachineInstruction[] {
  const steps = planAArch64MoveWideConstant(input.value, 64);
  return steps.map((step, index) =>
    terminatorInstruction(
      input.operationId,
      step.opcode,
      [
        index === 0
          ? defVreg(input.register, input.register.type)
          : aarch64InstructionOperand({
              role: "tiedDefUse",
              operand: { kind: "vreg", register: input.register },
              type: input.register.type,
            }),
        immediateOperand(step.value, input.register.type),
        immediateOperand(BigInt(step.shift), input.register.type),
      ],
      input.sequenceIndex + index,
      `${input.label}:constant:${step.opcode}:${step.shift}`,
    ),
  );
}

export function terminatorInstruction(
  operationId: OptIrOperationId,
  opcode: AArch64TerminatorOpcode,
  operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"],
  sequenceIndex = 0,
  label: string = opcode,
  isTerminator = isTerminatorOpcode(opcode),
): AArch64MachineInstruction {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(
      1_000_000_000 + Number(operationId) * AARCH64_LOWERING_ID_STRIDE + sequenceIndex,
    ),
    opcode: aarch64OpcodeFormId(opcode),
    operands,
    flags: { mayTrap: opcode === "trap", ...(isTerminator ? { isTerminator: true } : {}) },
    origin: syntheticAArch64Origin(
      `opt-ir-terminator:${String(operationId)}:${label}:${sequenceIndex}`,
    ),
    schedule: isTerminatorOpcode(opcode)
      ? { ...defaultAArch64ScheduleMetadata("branch"), motion: { kind: "pinned" } }
      : defaultAArch64ScheduleMetadata("integer"),
  });
}

export function isTerminatorOpcode(opcode: string): boolean {
  return (
    opcode === "b" ||
    opcode === "b-cond" ||
    opcode === "cbz" ||
    opcode === "cbnz" ||
    opcode === "br" ||
    opcode === "ret" ||
    opcode === "trap"
  );
}

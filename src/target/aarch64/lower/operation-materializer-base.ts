import type { OptIrFactId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import {
  aarch64MachineInstructionId,
  aarch64RelocationReferenceId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../machine-ir/ids";
import {
  aarch64MachineInstruction,
  type AArch64InstructionFlags,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import type { AArch64MachineType } from "../machine-ir/machine-types";
import type { AArch64MemoryOrderingMetadata } from "../machine-ir/memory-order";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  useVreg,
} from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import {
  aarch64RelocationReference,
  type AArch64RelocationReference,
} from "../machine-ir/relocation-reference";
import type { AArch64IssueClass, AArch64ScheduleMetadata } from "../machine-ir/schedule";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import { planAArch64MoveWideConstant } from "./constant-materialization";
import { AARCH64_LOWERING_ID_STRIDE } from "./lowering-id-stride";
import { scheduleMetadataForInstruction } from "./materialization-contracts";
import {
  GPR64,
  issueClassForOpcode,
  registerClassForMachineType,
  virtualRegisterForOptIrValue,
} from "./operation-materialization-helpers";
import type { AArch64OperationMaterializationContext } from "./operation-materialization";

export abstract class AArch64OperationMaterializerBase {
  protected readonly operation: OptIrOperation;
  protected readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  protected readonly context: AArch64OperationMaterializationContext;
  protected readonly virtualRegisters: AArch64VirtualRegister[] = [];
  protected readonly instructions: AArch64MachineInstruction[] = [];
  protected readonly relocationReferences: AArch64RelocationReference[] = [];
  protected readonly factsUsed = new Set<OptIrFactId>();
  protected readonly explanation: string[] = [];
  private nextSyntheticRegisterOffset = 0;
  private nextInstructionOffset = 0;
  private nextRelocationReferenceOffset = 0;

  protected constructor(
    operation: OptIrOperation,
    valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>,
    context: AArch64OperationMaterializationContext | undefined,
  ) {
    this.operation = operation;
    this.valueRegisters = valueRegisters;
    this.context = context ?? {};
  }

  protected materializationResult(): {
    readonly instructions: readonly AArch64MachineInstruction[];
    readonly virtualRegisters: readonly AArch64VirtualRegister[];
    readonly relocationReferences: readonly AArch64RelocationReference[];
    readonly factsUsed: readonly OptIrFactId[];
    readonly explanation: readonly string[];
  } {
    return {
      instructions: Object.freeze(this.instructions),
      virtualRegisters: Object.freeze(this.virtualRegisters),
      relocationReferences: Object.freeze(this.relocationReferences),
      factsUsed: Object.freeze(
        [...this.factsUsed].sort((left, right) => Number(left) - Number(right)),
      ),
      explanation: Object.freeze([...this.explanation]),
    };
  }

  protected recordFactAnswer(answer: {
    readonly factsUsed: readonly OptIrFactId[];
    readonly explanation?: readonly string[];
  }): void {
    answer.factsUsed.forEach((factId) => {
      this.factsUsed.add(factId);
    });
    this.explanation.push(...(answer.explanation ?? []));
  }

  protected recordDecision(decision: {
    readonly factsUsed: readonly (OptIrFactId | number)[];
    readonly explanation: readonly string[];
  }): void {
    decision.factsUsed.forEach((factId) => {
      this.factsUsed.add(factId as OptIrFactId);
    });
    this.explanation.push(...decision.explanation);
  }

  protected nextRelocationReferenceId(): ReturnType<typeof aarch64RelocationReferenceId> {
    const relocationId = aarch64RelocationReferenceId(
      Number(this.operation.operationId) * AARCH64_LOWERING_ID_STRIDE +
        this.nextRelocationReferenceOffset,
    );
    this.nextRelocationReferenceOffset += 1;
    return relocationId;
  }

  protected recordSymbolAddressRelocations(
    symbol: ReturnType<typeof aarch64SymbolId>,
    fingerprintPrefix: string,
  ): void {
    for (const kind of ["PAGE", "PAGEOFF12"] as const) {
      this.relocationReferences.push(
        aarch64RelocationReference({
          relocationId: this.nextRelocationReferenceId(),
          kind,
          symbol,
          addend: 0n,
          targetFingerprint: `${fingerprintPrefix}:${kind.toLowerCase()}`,
        }),
      );
    }
  }

  protected emit(
    opcode: string,
    operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"],
    flags: AArch64InstructionFlags,
    label: string = this.operation.kind,
    issueClass: AArch64IssueClass = issueClassForOpcode(opcode),
    memoryOrdering?: AArch64MemoryOrderingMetadata,
    schedule?: AArch64ScheduleMetadata,
  ): void {
    this.instructions.push(
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(
          Number(this.operation.operationId) * AARCH64_LOWERING_ID_STRIDE +
            this.nextInstructionOffset,
        ),
        opcode: aarch64OpcodeFormId(opcode),
        operands,
        flags,
        origin: syntheticAArch64Origin(
          `opt-ir:${String(this.operation.operationId)}:${label}:${this.nextInstructionOffset}`,
        ),
        schedule: schedule ?? scheduleMetadataForInstruction(opcode, issueClass),
        ...(memoryOrdering === undefined ? {} : { memoryOrdering }),
      }),
    );
    this.nextInstructionOffset += 1;
  }

  protected resultRegister(operation: OptIrOperation, index: number): AArch64VirtualRegister {
    const valueId = operation.resultIds[index];
    if (valueId === undefined) {
      return this.syntheticRegister(`missing-result:${index}`, GPR64);
    }
    return this.valueRegister(valueId);
  }

  protected valueRegister(valueId: OptIrValueId): AArch64VirtualRegister {
    const register = this.valueRegisters.get(valueId);
    if (register !== undefined) {
      return register;
    }
    const fallback = virtualRegisterForOptIrValue({ valueId, type: GPR64 });
    this.virtualRegisters.push(fallback);
    return fallback;
  }

  protected sourceRegisterAt(
    sourceValueIds: readonly OptIrValueId[],
    index: number,
  ):
    | { readonly kind: "ok"; readonly register: AArch64VirtualRegister }
    | { readonly kind: "error"; readonly stableDetail: string } {
    const valueId = sourceValueIds[index];
    if (valueId === undefined) {
      return {
        kind: "error",
        stableDetail: `materialize-operation:missing-source:${String(this.operation.operationId)}:${index}`,
      };
    }
    return { kind: "ok", register: this.valueRegister(valueId) };
  }

  protected syntheticRegister(label: string, type: AArch64MachineType): AArch64VirtualRegister {
    return this.syntheticRegisterWithOrigin(
      label,
      type,
      `opt-ir:${String(this.operation.operationId)}:${label}:${this.nextSyntheticRegisterOffset}`,
    );
  }

  protected syntheticRegisterWithOrigin(
    label: string,
    type: AArch64MachineType,
    stableOriginKey: string,
  ): AArch64VirtualRegister {
    const register = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(
        1_000_000 +
          Number(this.operation.operationId) * AARCH64_LOWERING_ID_STRIDE +
          this.nextSyntheticRegisterOffset,
      ),
      registerClass: registerClassForMachineType(type),
      type,
      origin: {
        kind: "synthetic",
        stableKey: stableOriginKey,
      },
    });
    this.nextSyntheticRegisterOffset += 1;
    this.virtualRegisters.push(register);
    return register;
  }

  protected emitValueConstant(register: AArch64VirtualRegister, value: bigint): void {
    if (register.type.kind === "vector") {
      this.emit(
        "movi",
        [
          defVreg(register, register.type),
          immediateOperand(BigInt.asUintN(64, value), register.type),
        ],
        { mayTrap: false },
        "constant.vector",
        "vector",
      );
      return;
    }
    const steps = planAArch64MoveWideConstant(value, moveWideConstantWidth(register.type));
    steps.forEach((step, index) => {
      this.emit(
        step.opcode,
        [
          index === 0
            ? defVreg(register, register.type)
            : aarch64InstructionOperand({
                role: "tiedDefUse",
                operand: { kind: "vreg", register },
                type: register.type,
              }),
          immediateOperand(step.value, register.type),
          immediateOperand(BigInt(step.shift), register.type),
        ],
        { mayTrap: false },
        `constant.${step.opcode}.${step.shift}`,
      );
    });
  }

  protected emitCopy(
    output: AArch64VirtualRegister,
    input: AArch64VirtualRegister,
    label: string,
  ): { readonly kind: "ok" } | { readonly kind: "error" } {
    const isVectorCopy =
      output.registerClass === "vector64" || output.registerClass === "vector128";
    if (isVectorCopy) {
      this.emit(
        "mov-vector",
        [defVreg(output, output.type), useVreg(input, input.type)],
        { mayTrap: false },
        label,
        "vector",
      );
      return { kind: "ok" };
    }
    if (output.registerClass === "fpScalar" || input.registerClass === "fpScalar") {
      return { kind: "error" };
    }
    this.emit(
      "add-immediate",
      [defVreg(output, output.type), useVreg(input, input.type), immediateOperand(0n, output.type)],
      { mayTrap: false },
      label,
    );
    return { kind: "ok" };
  }
}

function moveWideConstantWidth(type: AArch64MachineType): 32 | 64 {
  return type.kind === "integer" && type.width <= 32 ? 32 : 64;
}

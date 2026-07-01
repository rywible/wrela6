import type { AArch64FrameObject } from "./frame-object";
import type { AArch64AbiBinding, AArch64AbiLocation } from "./abi-location";
import type { AArch64MachineFunctionId, AArch64SymbolId } from "./ids";
import type { AArch64MachineBlock } from "./machine-block";
import type { AArch64RematerializationRecord } from "./rematerialization";
import type { AArch64RelocationReference } from "./relocation-reference";
import type { AArch64VirtualRegister } from "./virtual-register";

export interface AArch64CallClobberRecord {
  readonly callKey: string;
  readonly registers: {
    readonly convention: "aapcs64" | "custom";
    readonly gpr: readonly string[];
    readonly vector: readonly string[];
  };
  readonly memoryEffects: readonly string[];
}

export interface AArch64JumpTableEntry {
  readonly value: bigint;
  readonly targetBlock: number;
}

export interface AArch64JumpTableRecord {
  readonly tableKey: string;
  readonly operationKey: string;
  readonly entries: readonly AArch64JumpTableEntry[];
  readonly defaultTargetBlock: number;
  readonly picSafe: true;
}

export interface AArch64MachineFunction {
  readonly functionId: AArch64MachineFunctionId;
  readonly symbol: AArch64SymbolId;
  readonly virtualRegisters: readonly AArch64VirtualRegister[];
  readonly parameters: readonly AArch64AbiBinding[];
  readonly returns: readonly AArch64AbiLocation[];
  readonly frameObjects: readonly AArch64FrameObject[];
  readonly blocks: readonly AArch64MachineBlock[];
  readonly callClobbers: readonly AArch64CallClobberRecord[];
  readonly relocationReferences: readonly AArch64RelocationReference[];
  readonly literalPoolPlan: readonly string[];
  readonly rematerializationPlan: readonly AArch64RematerializationRecord[];
  readonly jumpTablePlan: readonly AArch64JumpTableRecord[];
  readonly schedulePlan: readonly string[];
  readonly provenance: readonly string[];
}

export function aarch64MachineFunction(input: {
  readonly functionId: AArch64MachineFunctionId;
  readonly symbol: AArch64SymbolId;
  readonly virtualRegisters: readonly AArch64VirtualRegister[];
  readonly parameters: readonly AArch64AbiBinding[];
  readonly returns: readonly AArch64AbiLocation[];
  readonly frameObjects: readonly AArch64FrameObject[];
  readonly blocks: readonly AArch64MachineBlock[];
  readonly callClobbers?: readonly AArch64CallClobberRecord[];
  readonly relocationReferences?: readonly AArch64RelocationReference[];
  readonly literalPoolPlan?: readonly string[];
  readonly rematerializationPlan?: readonly AArch64RematerializationRecord[];
  readonly jumpTablePlan?: readonly AArch64JumpTableRecord[];
  readonly schedulePlan?: readonly string[];
  readonly provenance?: readonly string[];
}): AArch64MachineFunction {
  return Object.freeze({
    functionId: input.functionId,
    symbol: input.symbol,
    virtualRegisters: Object.freeze(
      [...input.virtualRegisters].sort((left, right) => left.vreg - right.vreg),
    ),
    parameters: Object.freeze([...input.parameters]),
    returns: Object.freeze([...input.returns]),
    frameObjects: Object.freeze(
      [...input.frameObjects].sort((left, right) => left.frameObjectId - right.frameObjectId),
    ),
    blocks: Object.freeze([...input.blocks].sort((left, right) => left.blockId - right.blockId)),
    callClobbers: Object.freeze((input.callClobbers ?? []).map(freezeCallClobberRecord)),
    relocationReferences: Object.freeze(
      [...(input.relocationReferences ?? [])].sort(
        (left, right) => left.relocationId - right.relocationId,
      ),
    ),
    literalPoolPlan: Object.freeze([...(input.literalPoolPlan ?? [])]),
    rematerializationPlan: Object.freeze([...(input.rematerializationPlan ?? [])]),
    jumpTablePlan: Object.freeze(
      [...(input.jumpTablePlan ?? [])].map((record) =>
        Object.freeze({
          ...record,
          entries: Object.freeze(
            [...record.entries]
              .sort((left, right) =>
                left.value < right.value ? -1 : left.value > right.value ? 1 : 0,
              )
              .map((entry) => Object.freeze({ ...entry })),
          ),
        }),
      ),
    ),
    schedulePlan: Object.freeze([...(input.schedulePlan ?? [])]),
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

function freezeCallClobberRecord(record: AArch64CallClobberRecord): AArch64CallClobberRecord {
  return Object.freeze({
    callKey: record.callKey,
    registers: Object.freeze({
      convention: record.registers.convention,
      gpr: Object.freeze([...record.registers.gpr]),
      vector: Object.freeze([...record.registers.vector]),
    }),
    memoryEffects: Object.freeze([...record.memoryEffects]),
  });
}

import type { OptIrBlock, OptIrCfgEdgeTable } from "../../../opt-ir/cfg";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import type { OptIrBlockParameter } from "../../../opt-ir/values";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import { aarch64MachineBlockId } from "../machine-ir/ids";
import { aarch64MachineBlock, type AArch64MachineBlock } from "../machine-ir/machine-block";
import type { AArch64JumpTableRecord } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import type { AArch64RelocationReference } from "../machine-ir/relocation-reference";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import {
  materializeAArch64OptIrOperation,
  type AArch64OperationMaterializationContext,
} from "./operation-materialization";
import type { AArch64LoweringSelectionRecord } from "./pipeline-stages";
import { lowerTerminator } from "./terminator-lowering";

export type LowerAArch64BlockShellResult =
  | {
      readonly kind: "ok";
      readonly block: AArch64MachineBlock;
      readonly edgeBlocks: readonly AArch64MachineBlock[];
      readonly virtualRegisters: readonly AArch64VirtualRegister[];
      readonly relocationReferences: readonly AArch64RelocationReference[];
      readonly jumpTables: readonly AArch64JumpTableRecord[];
      readonly selectionRecords: readonly AArch64LoweringSelectionRecord[];
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId?: OptIrOperationId;
    };

export function lowerAArch64BlockShell(input: {
  readonly block: OptIrBlock;
  readonly edges: OptIrCfgEdgeTable;
  readonly isEntry: boolean;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>;
  readonly blockParametersByBlock?: ReadonlyMap<OptIrBlockId, readonly OptIrBlockParameter[]>;
  readonly returnLocations: readonly AArch64AbiLocation[];
  readonly unitSuccessReturn?: {
    readonly location: AArch64AbiLocation;
    readonly value: bigint;
  };
  readonly materializationContext?: AArch64OperationMaterializationContext;
}): LowerAArch64BlockShellResult {
  const instructions: AArch64MachineInstruction[] = [];
  const virtualRegisters: AArch64VirtualRegister[] = [];
  const relocationReferences: AArch64RelocationReference[] = [];
  const selectionRecords: AArch64LoweringSelectionRecord[] = [];
  for (const operationId of input.block.operations) {
    const operation = input.operations.get(operationId);
    if (operation === undefined) {
      return {
        kind: "error",
        operationId,
        stableDetail: `lower-function-shells:missing-operation:${String(operationId)}`,
      };
    }
    const materialized = materializeAArch64OptIrOperation({
      operation,
      valueRegisters: input.valueRegisters,
      context: input.materializationContext,
    });
    if (materialized.kind === "error") {
      return { kind: "error", operationId, stableDetail: materialized.stableDetail };
    }
    instructions.push(...materialized.instructions);
    virtualRegisters.push(...materialized.virtualRegisters);
    relocationReferences.push(...materialized.relocationReferences);
    selectionRecords.push(materialized.selectionRecord);
  }

  const terminator = lowerTerminator({
    terminator: input.block.terminator,
    edges: input.edges,
    valueRegisters: input.valueRegisters,
    blockParametersByBlock: input.blockParametersByBlock ?? new Map(),
    returnLocations: input.returnLocations,
    ...(input.unitSuccessReturn === undefined
      ? {}
      : { unitSuccessReturn: input.unitSuccessReturn }),
  });
  if (terminator.kind === "error") {
    return terminator;
  }
  const blockParameters = blockParameterRegisters(input.block, input.valueRegisters);
  if (blockParameters.kind === "error") {
    return blockParameters;
  }

  return {
    kind: "ok",
    block: aarch64MachineBlock({
      blockId: aarch64MachineBlockId(Number(input.block.blockId)),
      frequency: input.isEntry ? { kind: "entry" } : { kind: "warm" },
      parameters: blockParameters.registers,
      instructions: [...instructions, ...terminator.instructions],
      ...(terminator.instruction === undefined ? {} : { terminator: terminator.instruction }),
    }),
    edgeBlocks: terminator.edgeBlocks,
    virtualRegisters: [...virtualRegisters, ...terminator.virtualRegisters],
    relocationReferences: [...relocationReferences, ...(terminator.relocationReferences ?? [])],
    jumpTables: terminator.jumpTables,
    selectionRecords: [...selectionRecords, ...terminator.selectionRecords],
  };
}

function blockParameterRegisters(
  block: OptIrBlock,
  valueRegisters: ReadonlyMap<OptIrValueId, AArch64VirtualRegister>,
):
  | { readonly kind: "ok"; readonly registers: readonly AArch64VirtualRegister[] }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
      readonly operationId?: OptIrOperationId;
    } {
  const registers = [];
  for (const parameter of block.parameters) {
    const register = valueRegisters.get(parameter.valueId);
    if (register === undefined) {
      return {
        kind: "error",
        stableDetail: `lower-block:missing-parameter-vreg:${String(block.blockId)}:${String(parameter.valueId)}`,
      };
    }
    registers.push(register);
  }
  return { kind: "ok", registers };
}
